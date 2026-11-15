'use strict';

const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const { createJidMapper, decodeJid } = require('kango-wa');

const { patchSocket } = require('./messageQueue');
const {
    getAuthState,
    listSupabaseSessionIds,
    pullSupabaseSessionToLocal,
    syncLocalSessionToSupabase,
    deleteSessionFromSupabase,
    clearAllSupabaseSessions
} = require('./authState');
const { SESSIONS_DIR, LEGACY_SESSIONS_DIR } = require('./storagePaths');
const database = require('./database');
const whatsappService = require('./whatsappService');

const activeSessions = {};
const messageStores = {};
const MAX_STORE_PER_SESSION = 1000;

function getMessageStore(cleanNumber) {
    if (!messageStores[cleanNumber]) messageStores[cleanNumber] = new Map();
    return messageStores[cleanNumber];
}

function storeMessage(cleanNumber, jid, id, message) {
    if (!jid || !id || !message) return;
    const store = getMessageStore(cleanNumber);
    const normJid = decodeJid(jid) || jid;
    store.set(`${normJid}:${id}`, message);
    if (normJid !== jid) {
        store.set(`${jid}:${id}`, message);
    }
    while (store.size > MAX_STORE_PER_SESSION) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
    }
}

function retrieveMessage(cleanNumber, jid, id) {
    const store = messageStores[cleanNumber];
    if (!store || !jid || !id) return undefined;
    const normJid = decodeJid(jid) || jid;
    return store.get(`${normJid}:${id}`) || store.get(`${jid}:${id}`);
}

function attachSendCache(sock, cleanNumber) {
    if (typeof sock.sendMessage === 'function') {
        const origSend = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, opts) => {
            if (activeSessions[cleanNumber]) {
                activeSessions[cleanNumber].lastEventAt = Date.now();
            }
            const result = await origSend(jid, content, opts);
            if (result?.key?.id && result?.message) {
                storeMessage(cleanNumber, jid, result.key.id, result.message);
            }
            return result;
        };
    }

    if (typeof sock.relayMessage === 'function') {
        const origRelay = sock.relayMessage.bind(sock);
        sock.relayMessage = async (jid, message, opts = {}) => {
            if (activeSessions[cleanNumber]) {
                activeSessions[cleanNumber].lastEventAt = Date.now();
            }
            if (opts?.messageId && message) {
                storeMessage(cleanNumber, jid, opts.messageId, message);
            }
            return await origRelay(jid, message, opts);
        };
    }
}

function createSocket(version, state, cleanNumber, isPairing = false) {
    return makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 350,
        maxMsgRetryCount: 5,
        fireInitQueries: !isPairing,
        syncFullHistory: false,
        shouldIgnoreJid: () => false,
        generateHighQualityLinkPreview: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        getMessage: async (key) => {
            return retrieveMessage(cleanNumber, key.remoteJid, key.id) || undefined;
        }
    });
}

function attachMessageHandler(sock, cleanNumber) {
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        if (activeSessions[cleanNumber]) {
            activeSessions[cleanNumber].lastEventAt = Date.now();
        }
        if (Array.isArray(chatUpdate?.messages)) {
            for (const msg of chatUpdate.messages) {
                if (msg?.key?.remoteJid && msg?.key?.id && msg?.message) {
                    storeMessage(cleanNumber, msg.key.remoteJid, msg.key.id, msg.message);
                }
            }
        }
        await whatsappService.handleIncomingBaileysUpsert(sock, chatUpdate);
    });
}

async function runSession(cleanNumber, sessionDir) {
    const entry = activeSessions[cleanNumber];
    if (entry && (entry.manualDeleted || entry.unlinkedFromPhone)) return;
    if (entry && entry.reconnecting) return;

    if (!activeSessions[cleanNumber]) {
        activeSessions[cleanNumber] = {
            sock: null,
            connected: false,
            reconnecting: true,
            sessionDir,
            lastEventAt: Date.now(),
            unlinkedConfirmCount: 0,
            manualDeleted: false,
            unlinkedFromPhone: false
        };
    } else {
        activeSessions[cleanNumber].reconnecting = true;
        activeSessions[cleanNumber].sessionDir = sessionDir;
    }

    if (activeSessions[cleanNumber]?.sock) {
        try {
            activeSessions[cleanNumber].sock.ev?.removeAllListeners?.();
            activeSessions[cleanNumber].sock.end?.();
        } catch (_) {}
    }

    let state, saveCreds, version;
    try {
        ({ state, saveCreds } = await getAuthState(sessionDir, cleanNumber));
        ({ version } = await fetchLatestBaileysVersion());
    } catch (err) {
        console.error(`[whatsapp] ${cleanNumber} init error:`, err.message);
        if (activeSessions[cleanNumber]) activeSessions[cleanNumber].reconnecting = false;
        setTimeout(() => runSession(cleanNumber, sessionDir), 5000);
        return;
    }

    const sock = createSocket(version, state, cleanNumber, false);
    sock._sessionNumber = cleanNumber;
    const jidMapper = createJidMapper();
    jidMapper.bind(sock.ev);
    jidMapper.patchSocket(sock);
    attachSendCache(sock, cleanNumber);
    patchSocket(sock, cleanNumber);
    attachMessageHandler(sock, cleanNumber);

    sock.ev.on('creds.update', async () => {
        if (activeSessions[cleanNumber]) activeSessions[cleanNumber].lastEventAt = Date.now();
        try { await saveCreds(); } catch (_) {}
    });

    if (activeSessions[cleanNumber]) {
        activeSessions[cleanNumber].sock = sock;
        activeSessions[cleanNumber].reconnecting = false;
        activeSessions[cleanNumber].connected = false;
        activeSessions[cleanNumber].saveCreds = saveCreds;
        activeSessions[cleanNumber].lastEventAt = Date.now();
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (activeSessions[cleanNumber]) activeSessions[cleanNumber].lastEventAt = Date.now();

        if (connection === 'open') {
            console.log(`[whatsapp] ✅ Store WhatsApp Bot +${cleanNumber} connected`);
            try { jidMapper.primeSelf(sock.user); } catch (_) {}
            if (activeSessions[cleanNumber]) {
                activeSessions[cleanNumber].connected = true;
                activeSessions[cleanNumber].reconnecting = false;
                activeSessions[cleanNumber].unlinkedConfirmCount = 0;
            }
            try { await saveCreds(); } catch (_) {}

            const token = `AlMumtaz~${cleanNumber}~${Date.now().toString(36)}`;
            try {
                fs.writeFileSync(path.join(sessionDir, 'session_id.txt'), token, 'utf8');
            } catch (_) {}
            database.upsertWhatsAppSession(cleanNumber, token, 'connected');
            syncLocalSessionToSupabase(cleanNumber, sessionDir, token).catch(() => {});
        }

        if (connection === 'close') {
            const currentEntry = activeSessions[cleanNumber];
            if (!currentEntry || currentEntry.manualDeleted) return;

            const code = lastDisconnect?.error?.output?.statusCode;
            const errMessage = String(lastDisconnect?.error?.message || '');
            currentEntry.connected = false;
            currentEntry.reconnecting = false;

            const isExplicitDeviceRemoved =
                (code === DisconnectReason.loggedOut || code === 401) &&
                (errMessage.toLowerCase().includes('device_removed') ||
                 errMessage.toLowerCase().includes('logged out') ||
                 errMessage.toLowerCase().includes('conflict'));

            if (isExplicitDeviceRemoved) {
                currentEntry.unlinkedConfirmCount = (currentEntry.unlinkedConfirmCount || 0) + 1;
                if (currentEntry.unlinkedConfirmCount >= 2) {
                    currentEntry.unlinkedFromPhone = true;
                    database.upsertWhatsAppSession(cleanNumber, '', 'unlinked');
                    return;
                }
            }

            const fastCodes = [
                DisconnectReason.restartRequired,
                DisconnectReason.connectionClosed,
                DisconnectReason.connectionLost,
                DisconnectReason.timedOut,
                515, 428, 408
            ];
            const retryMs = fastCodes.includes(code) ? 2000 : 4000;
            setTimeout(async () => {
                if (!activeSessions[cleanNumber] || activeSessions[cleanNumber].manualDeleted || activeSessions[cleanNumber].unlinkedFromPhone) {
                    return;
                }
                const credsFile = path.join(sessionDir, 'creds.json');
                if (!fs.existsSync(credsFile)) {
                    await pullSupabaseSessionToLocal(cleanNumber, sessionDir).catch(() => {});
                }
                runSession(cleanNumber, sessionDir);
            }, retryMs);
        }
    });
}

setInterval(async () => {
    for (const [cleanNumber, entry] of Object.entries(activeSessions)) {
        if (!entry || entry.manualDeleted || entry.unlinkedFromPhone) continue;
        if (entry.pending) {
            if (Date.now() < (entry.pairingExpiresAt || 0)) continue;
            entry.pending = false;
        }
        const sessionDir = entry.sessionDir || path.join(SESSIONS_DIR, cleanNumber);
        const sock = entry.sock;

        if (!entry.connected && !entry.reconnecting) {
            const credsFile = path.join(sessionDir, 'creds.json');
            if (!fs.existsSync(credsFile)) continue;
            try {
                const rawCreds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
                if (!rawCreds?.registered) continue;
            } catch (_) {
                continue;
            }
            if (Date.now() - (entry.lastEventAt || 0) > 15000) {
                entry.lastEventAt = Date.now();
                runSession(cleanNumber, sessionDir);
                continue;
            }
        }

        if (entry.connected && sock) {
            const wsReadyState = sock.ws?.readyState ?? sock.ws?.socket?.readyState;
            if (wsReadyState === 2 || wsReadyState === 3) {
                entry.connected = false;
                entry.reconnecting = false;
                entry.lastEventAt = Date.now();
                runSession(cleanNumber, sessionDir);
            }
        }
    }
}, 25000).unref();

async function generatePairingCode(phoneNumber) {
    let cleanNumber = String(phoneNumber || '').replace(/\D/g, '');
    if (cleanNumber.startsWith('00')) cleanNumber = cleanNumber.slice(2);
    if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
        cleanNumber = '92' + cleanNumber.slice(1);
    }
    if (!cleanNumber || cleanNumber.length < 7) {
        throw new Error('Enter a valid WhatsApp phone number with country code (e.g. 923299931199).');
    }

    if (activeSessions[cleanNumber] && !activeSessions[cleanNumber].connected) {
        try {
            activeSessions[cleanNumber].sock?.ev?.removeAllListeners?.();
            activeSessions[cleanNumber].sock?.end?.();
        } catch (_) {}
        delete activeSessions[cleanNumber];
        await delay(600);
    }

    const sessionDir = path.join(SESSIONS_DIR, cleanNumber);
    fs.mkdirSync(sessionDir, { recursive: true });

    let { state, saveCreds } = await getAuthState(sessionDir, cleanNumber);
    if (state.creds?.registered) {
        if (activeSessions[cleanNumber]?.connected) {
            return { alreadyConnected: true, message: `WhatsApp +${cleanNumber} is already connected.` };
        }
        activeSessions[cleanNumber] = { pending: false, connected: false, sessionDir, lastEventAt: Date.now() };
        runSession(cleanNumber, sessionDir);
        return { alreadyConnected: true, message: `WhatsApp +${cleanNumber} session restored and reconnecting.` };
    }

    try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        fs.mkdirSync(sessionDir, { recursive: true });
    } catch (_) {}
    ({ state, saveCreds } = await getAuthState(sessionDir, cleanNumber));

    const { version } = await fetchLatestBaileysVersion();
    const currentSock = createSocket(version, state, cleanNumber, true);

    activeSessions[cleanNumber] = {
        sock: currentSock,
        pending: true,
        pairingExpiresAt: Date.now() + 180000,
        connected: false,
        sessionDir,
        saveCreds,
        lastEventAt: Date.now()
    };

    let handedOff = false;
    currentSock.ev.on('creds.update', async () => {
        if (activeSessions[cleanNumber]) activeSessions[cleanNumber].lastEventAt = Date.now();
        try { await saveCreds(); } catch (_) {}
    });

    currentSock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open' && !handedOff) {
            handedOff = true;
            try { await saveCreds(); } catch (_) {}
            try {
                currentSock.ev?.removeAllListeners?.();
                currentSock.end?.();
            } catch (_) {}
            activeSessions[cleanNumber] = { pending: false, connected: false, sessionDir, lastEventAt: Date.now() };
            setTimeout(() => runSession(cleanNumber, sessionDir), 500);
        } else if (connection === 'close' && !handedOff) {
            const code = lastDisconnect?.error?.output?.statusCode;
            if (currentSock.authState?.creds?.registered || code === DisconnectReason.restartRequired || code === 515) {
                handedOff = true;
                try { await saveCreds(); } catch (_) {}
                activeSessions[cleanNumber] = { pending: false, connected: false, sessionDir, lastEventAt: Date.now() };
                setTimeout(() => runSession(cleanNumber, sessionDir), 600);
            }
        }
    });

    try {
        if (typeof currentSock.waitForSocketOpen === 'function') {
            await Promise.race([currentSock.waitForSocketOpen(), delay(6000)]);
        }
    } catch (_) {}
    await delay(1500);

    const rawCode = await Promise.race([
        currentSock.requestPairingCode(cleanNumber),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Pairing code request timed out')), 20000))
    ]);
    try { await saveCreds(); } catch (_) {}

    const cleanCode = String(rawCode || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (!cleanCode || cleanCode.length !== 8) {
        throw new Error('Invalid pairing code returned by WhatsApp.');
    }
    return `${cleanCode.slice(0, 4)}-${cleanCode.slice(4, 8)}`;
}

function getActiveSessions() {
    return Object.keys(activeSessions).filter((k) => activeSessions[k]?.sock);
}

function getConnectedSessions() {
    return Object.keys(activeSessions).filter((k) => activeSessions[k]?.connected);
}

function getActiveSocket(preferredNumber) {
    if (preferredNumber && activeSessions[preferredNumber]?.connected && activeSessions[preferredNumber]?.sock) {
        return activeSessions[preferredNumber].sock;
    }
    for (const num of getActiveSessions()) {
        if (activeSessions[num]?.connected && activeSessions[num]?.sock) {
            return activeSessions[num].sock;
        }
    }
    return null;
}

async function deleteSessionByNumber(phoneNumber) {
    let cleanNumber = String(phoneNumber || '').replace(/\D/g, '');
    if (cleanNumber.startsWith('00')) cleanNumber = cleanNumber.slice(2);
    if (cleanNumber.startsWith('0') && cleanNumber.length === 11) {
        cleanNumber = '92' + cleanNumber.slice(1);
    }
    if (!cleanNumber) throw new Error('Phone number is required.');

    if (activeSessions[cleanNumber]) {
        activeSessions[cleanNumber].manualDeleted = true;
        try {
            activeSessions[cleanNumber].sock?.ev?.removeAllListeners?.();
            activeSessions[cleanNumber].sock?.end?.();
        } catch (_) {}
        delete activeSessions[cleanNumber];
    }
    messageStores[cleanNumber]?.clear();

    for (const base of [SESSIONS_DIR, LEGACY_SESSIONS_DIR]) {
        const dir = path.join(base, cleanNumber);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    database.deleteWhatsAppSessionRow(cleanNumber);
    await deleteSessionFromSupabase(cleanNumber).catch(() => {});
    return { success: true, cleanNumber };
}

async function clearAllSessions() {
    for (const num of Object.keys(activeSessions)) {
        activeSessions[num].manualDeleted = true;
        try { activeSessions[num].sock?.end?.(); } catch (_) {}
        delete activeSessions[num];
    }
    for (const base of [SESSIONS_DIR, LEGACY_SESSIONS_DIR]) {
        if (fs.existsSync(base)) {
            for (const item of fs.readdirSync(base)) {
                fs.rmSync(path.join(base, item), { recursive: true, force: true });
            }
        }
    }
    database.clearAllWhatsAppSessionRows();
    await clearAllSupabaseSessions().catch(() => {});
    return { success: true };
}

async function rehydrateSessions() {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const candidateNumbers = new Set();

    try {
        const cloudIds = await listSupabaseSessionIds();
        for (const id of cloudIds) {
            const clean = String(id).replace(/\D/g, '');
            if (clean && clean.length >= 7) {
                candidateNumbers.add(clean);
                const dir = path.join(SESSIONS_DIR, clean);
                if (!fs.existsSync(path.join(dir, 'creds.json'))) {
                    await pullSupabaseSessionToLocal(clean, dir).catch(() => {});
                }
            }
        }
    } catch (_) {}

    try {
        if (fs.existsSync(SESSIONS_DIR)) {
            for (const entry of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
                if (entry.isDirectory() && /^\d{7,}$/.test(entry.name)) {
                    candidateNumbers.add(entry.name);
                }
            }
        }
    } catch (_) {}

    let count = 0;
    for (const cleanNumber of candidateNumbers) {
        const sessionDir = path.join(SESSIONS_DIR, cleanNumber);
        if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) continue;
        if (activeSessions[cleanNumber]?.connected || activeSessions[cleanNumber]?.reconnecting) continue;
        activeSessions[cleanNumber] = { pending: false, connected: false, sessionDir, lastEventAt: Date.now() };
        runSession(cleanNumber, sessionDir);
        count++;
        await delay(1000);
    }
    return count;
}

module.exports = {
    generatePairingCode,
    getActiveSessions,
    getConnectedSessions,
    getActiveSocket,
    deleteSessionByNumber,
    clearAllSessions,
    rehydrateSessions
};
