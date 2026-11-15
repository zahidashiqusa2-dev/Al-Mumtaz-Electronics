'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { Pool } = require('pg');
const { SESSIONS_DIR, CONFIG_PATH } = require('./storagePaths');
const database = require('./database');
const { buildSiteApiUrl } = require('./storeLogic');
const { useMultiFileAuthState, BufferJSON } = require('@whiskeysockets/baileys');

const serialize = (v) => JSON.stringify(v, BufferJSON.replacer);
const deserialize = (s) => JSON.parse(s, BufferJSON.reviver);

let _pgPool = null;
let _pgPoolUrl = null;
const _siteSyncTimers = new Map();

function readSavedCloudConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function getSiteBridgeAuthConfig() {
    const { config } = database.getAllVariables();
    const creds = database.getAdminCredentials();
    const apiBase = buildSiteApiUrl(config);
    if (!apiBase) return null;
    return {
        apiBase,
        headers: {
            'Content-Type': 'application/json',
            ...(config.apiSecretKey ? { Authorization: `Bearer ${config.apiSecretKey}`, 'x-api-secret': config.apiSecretKey } : {}),
            'x-admin-username': creds.username,
            'x-admin-password': creds.password
        }
    };
}

function collectKeyFilesMap(sessionDir) {
    const map = {};
    try {
        if (!fs.existsSync(sessionDir)) return map;
        const files = fs.readdirSync(sessionDir)
            .filter((name) => name.endsWith('.json') && name !== 'creds.json');

        // Keep app-state-sync, sessions & pre-keys within a safe payload budget (~2MB)
        let totalBytes = 0;
        for (const name of files.slice(0, 500)) {
            const fullPath = path.join(sessionDir, name);
            try {
                const raw = fs.readFileSync(fullPath, 'utf8');
                totalBytes += raw.length;
                if (totalBytes > 2 * 1024 * 1024) break;
                map[name] = raw;
            } catch (_) {}
        }
    } catch (_) {}
    return map;
}

async function syncSessionToMainSite(sessionId, sessionDir, explicitToken = null, credsOverride = null) {
    const bridge = getSiteBridgeAuthConfig();
    if (!bridge || !sessionId) return false;

    const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
    let credsJson = '';
    if (credsOverride) {
        credsJson = typeof credsOverride === 'string' ? credsOverride : serialize(credsOverride);
    } else {
        const credsPath = path.join(targetDir, 'creds.json');
        if (fs.existsSync(credsPath)) {
            try { credsJson = fs.readFileSync(credsPath, 'utf8'); } catch (_) {}
        }
    }
    if (!credsJson) return false;

    let sessionToken = explicitToken || '';
    if (!sessionToken) {
        try {
            const tokenPath = path.join(targetDir, 'session_id.txt');
            if (fs.existsSync(tokenPath)) sessionToken = fs.readFileSync(tokenPath, 'utf8').trim();
        } catch (_) {}
    }

    const keysMap = collectKeyFilesMap(targetDir);
    try {
        await axios.post(
            `${bridge.apiBase}/bridge/wa-auth/${encodeURIComponent(String(sessionId))}`,
            {
                credsJson,
                keysJson: JSON.stringify(keysMap),
                sessionToken
            },
            { headers: bridge.headers, timeout: 10000 }
        );
        return true;
    } catch (_) {
        return false;
    }
}

function scheduleMainSiteSync(sessionId, sessionDir) {
    const key = String(sessionId || '');
    if (!key) return;
    if (_siteSyncTimers.has(key)) {
        clearTimeout(_siteSyncTimers.get(key));
    }
    const timer = setTimeout(() => {
        _siteSyncTimers.delete(key);
        syncSessionToMainSite(key, sessionDir).catch(() => {});
    }, 900);
    if (typeof timer.unref === 'function') timer.unref();
    _siteSyncTimers.set(key, timer);
}

async function pullSessionFromMainSite(sessionId, sessionDir) {
    const bridge = getSiteBridgeAuthConfig();
    if (!bridge || !sessionId) return false;
    try {
        const res = await axios.get(
            `${bridge.apiBase}/bridge/wa-auth/${encodeURIComponent(String(sessionId))}`,
            { headers: bridge.headers, timeout: 8000 }
        );
        const backup = res.data?.backup;
        if (!backup?.credsJson) return false;

        const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'creds.json'), backup.credsJson, 'utf8');
        if (backup.sessionToken) {
            fs.writeFileSync(path.join(targetDir, 'session_id.txt'), backup.sessionToken, 'utf8');
        }
        if (backup.keysJson) {
            try {
                const keysMap = typeof backup.keysJson === 'string' ? JSON.parse(backup.keysJson) : backup.keysJson;
                if (keysMap && typeof keysMap === 'object') {
                    for (const [filename, content] of Object.entries(keysMap)) {
                        const safeName = path.basename(filename);
                        if (safeName.endsWith('.json') && safeName !== 'creds.json' && typeof content === 'string') {
                            fs.writeFileSync(path.join(targetDir, safeName), content, 'utf8');
                        }
                    }
                }
            } catch (_) {}
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function listMainSiteSessionIds() {
    const bridge = getSiteBridgeAuthConfig();
    if (!bridge) return [];
    try {
        const res = await axios.get(`${bridge.apiBase}/bridge/wa-auth`, { headers: bridge.headers, timeout: 8000 });
        return Array.isArray(res.data?.sessionIds)
            ? res.data.sessionIds.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
    } catch (_) {
        return [];
    }
}

async function deleteSessionFromMainSite(sessionId) {
    const bridge = getSiteBridgeAuthConfig();
    if (!bridge || !sessionId) return false;
    try {
        await axios.delete(
            `${bridge.apiBase}/bridge/wa-auth/${encodeURIComponent(String(sessionId))}`,
            { headers: bridge.headers, timeout: 8000 }
        );
        return true;
    } catch (_) {
        return false;
    }
}

async function clearAllMainSiteSessions() {
    const bridge = getSiteBridgeAuthConfig();
    if (!bridge) return false;
    try {
        await axios.delete(`${bridge.apiBase}/bridge/wa-auth`, { headers: bridge.headers, timeout: 8000 });
        return true;
    } catch (_) {
        return false;
    }
}

function getSupabaseCredentials() {
    const fileCfg = readSavedCloudConfig();
    const supabaseUrl = String(process.env.SUPABASE_URL || fileCfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const supabaseKey = String(
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_KEY ||
        fileCfg.SUPABASE_KEY ||
        ''
    ).trim();

    let supabaseDbUrl = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || fileCfg.SUPABASE_DB_URL || '').trim();
    if (supabaseDbUrl && supabaseDbUrl.startsWith('postgres')) {
        supabaseDbUrl = supabaseDbUrl.replace(/[?&]sslmode=[^&]*/g, '').replace(/[?&]$/, '');
    } else {
        supabaseDbUrl = '';
    }

    const hasPostgresUri = Boolean(supabaseDbUrl);
    const hasRestApi = Boolean(supabaseUrl && supabaseKey && supabaseUrl.startsWith('http'));
    return {
        supabaseUrl,
        supabaseKey,
        supabaseDbUrl,
        hasPostgresUri,
        hasRestApi,
        isConfigured: hasPostgresUri || hasRestApi
    };
}

async function getPgPool() {
    const { supabaseDbUrl, hasPostgresUri } = getSupabaseCredentials();
    if (!hasPostgresUri) return null;
    if (_pgPool && _pgPoolUrl === supabaseDbUrl) return _pgPool;

    if (_pgPool) {
        try { await _pgPool.end(); } catch (_) {}
        _pgPool = null;
    }

    try {
        const pool = new Pool({
            connectionString: supabaseDbUrl,
            ssl: { require: true, rejectUnauthorized: false },
            max: 6,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });
        await pool.query(`
            CREATE TABLE IF NOT EXISTS auth_creds (
                "sessionId" VARCHAR(64) PRIMARY KEY,
                data TEXT NOT NULL,
                "sessionToken" TEXT,
                "updatedAt" TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS auth_keys (
                "sessionId" VARCHAR(64) NOT NULL,
                type VARCHAR(32) NOT NULL,
                "keyId" VARCHAR(128) NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY ("sessionId", type, "keyId")
            );
        `);
        _pgPool = pool;
        _pgPoolUrl = supabaseDbUrl;
        return _pgPool;
    } catch (_) {
        return null;
    }
}

async function syncCredsToSupabase(sessionId, credsObj, sessionToken = null) {
    const { hasPostgresUri } = getSupabaseCredentials();
    if (!hasPostgresUri || !sessionId || !credsObj) return false;
    const serialized = typeof credsObj === 'string' ? credsObj : serialize(credsObj);
    try {
        const pool = await getPgPool();
        if (!pool) return false;
        await pool.query(
            `INSERT INTO auth_creds ("sessionId", data, "sessionToken", "updatedAt")
             VALUES ($1, $2, COALESCE($3, (SELECT "sessionToken" FROM auth_creds WHERE "sessionId" = $1)), NOW())
             ON CONFLICT ("sessionId") DO UPDATE
             SET data = EXCLUDED.data,
                 "sessionToken" = COALESCE(EXCLUDED."sessionToken", auth_creds."sessionToken"),
                 "updatedAt" = NOW()`,
            [String(sessionId), serialized, sessionToken]
        );
        return true;
    } catch (_) {
        return false;
    }
}

async function pullSupabaseSessionToLocal(sessionId, sessionDir) {
    if (!sessionId) return false;
    const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));

    const { hasPostgresUri } = getSupabaseCredentials();
    if (hasPostgresUri) {
        try {
            const pool = await getPgPool();
            if (pool) {
                const { rows } = await pool.query(`SELECT data, "sessionToken" FROM auth_creds WHERE "sessionId" = $1 LIMIT 1`, [String(sessionId)]);
                if (rows?.[0]?.data) {
                    fs.mkdirSync(targetDir, { recursive: true });
                    fs.writeFileSync(path.join(targetDir, 'creds.json'), rows[0].data, 'utf8');
                    if (rows[0].sessionToken) {
                        fs.writeFileSync(path.join(targetDir, 'session_id.txt'), rows[0].sessionToken, 'utf8');
                    }
                    return true;
                }
            }
        } catch (_) {}
    }

    // Fallback (or primary when no volume & no Supabase): restore from Main Website SQLite Bridge
    return await pullSessionFromMainSite(sessionId, targetDir);
}

async function syncLocalSessionToSupabase(sessionId, sessionDir, explicitToken = null) {
    const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
    const credsPath = path.join(targetDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;

    let rawCreds = '';
    try {
        rawCreds = fs.readFileSync(credsPath, 'utf8');
    } catch (_) {
        return false;
    }

    const [supaOk, siteOk] = await Promise.all([
        syncCredsToSupabase(sessionId, rawCreds, explicitToken).catch(() => false),
        syncSessionToMainSite(sessionId, targetDir, explicitToken, rawCreds).catch(() => false)
    ]);
    return Boolean(supaOk || siteOk);
}

async function listSupabaseSessionIds() {
    const ids = new Set();
    const { hasPostgresUri } = getSupabaseCredentials();
    if (hasPostgresUri) {
        try {
            const pool = await getPgPool();
            if (pool) {
                const { rows } = await pool.query(`SELECT "sessionId" FROM auth_creds LIMIT 100`);
                for (const r of rows || []) {
                    const id = String(r.sessionId || '').trim();
                    if (id) ids.add(id);
                }
            }
        } catch (_) {}
    }

    const bridgeIds = await listMainSiteSessionIds().catch(() => []);
    for (const id of bridgeIds) {
        if (id) ids.add(id);
    }
    return Array.from(ids);
}

async function deleteSessionFromSupabase(sessionId) {
    if (!sessionId) return false;
    const { hasPostgresUri } = getSupabaseCredentials();
    if (hasPostgresUri) {
        try {
            const pool = await getPgPool();
            if (pool) {
                await pool.query(`DELETE FROM auth_keys WHERE "sessionId" = $1`, [String(sessionId)]);
                await pool.query(`DELETE FROM auth_creds WHERE "sessionId" = $1`, [String(sessionId)]);
            }
        } catch (_) {}
    }
    await deleteSessionFromMainSite(sessionId).catch(() => {});
    return true;
}

async function clearAllSupabaseSessions() {
    const ids = await listSupabaseSessionIds();
    for (const id of ids) await deleteSessionFromSupabase(id);
    await clearAllMainSiteSessions().catch(() => {});
    return ids.length;
}

async function getAuthState(sessionDir = './session', sessionId = 'main') {
    const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
    fs.mkdirSync(targetDir, { recursive: true });
    if (!fs.existsSync(path.join(targetDir, 'creds.json'))) {
        await pullSupabaseSessionToLocal(sessionId, targetDir).catch(() => {});
    }
    const fileAuth = await useMultiFileAuthState(targetDir);

    const origKeysSet = fileAuth.state.keys.set.bind(fileAuth.state.keys);
    const origKeysGet = fileAuth.state.keys.get.bind(fileAuth.state.keys);

    const saveCreds = async () => {
        await fileAuth.saveCreds();
        if (getSupabaseCredentials().hasPostgresUri) {
            syncCredsToSupabase(sessionId, fileAuth.state.creds).catch(() => {});
        }
        scheduleMainSiteSync(sessionId, targetDir);
    };

    const keys = {
        get: async (type, ids) => origKeysGet(type, ids),
        set: async (data) => {
            await origKeysSet(data);
            const { hasPostgresUri } = getSupabaseCredentials();
            if (hasPostgresUri && data) {
                getPgPool().then(async (pool) => {
                    if (!pool) return;
                    for (const [type, keyMap] of Object.entries(data)) {
                        for (const [keyId, val] of Object.entries(keyMap || {})) {
                            if (val != null) {
                                await pool.query(
                                    `INSERT INTO auth_keys ("sessionId", type, "keyId", data) VALUES ($1, $2, $3, $4)
                                     ON CONFLICT ("sessionId", type, "keyId") DO UPDATE SET data = EXCLUDED.data`,
                                    [String(sessionId), String(type), String(keyId), serialize(val)]
                                ).catch(() => {});
                            }
                        }
                    }
                }).catch(() => {});
            }
            scheduleMainSiteSync(sessionId, targetDir);
        }
    };

    return {
        state: { creds: fileAuth.state.creds, keys },
        saveCreds
    };
}

module.exports = {
    getAuthState,
    listSupabaseSessionIds,
    pullSupabaseSessionToLocal,
    syncLocalSessionToSupabase,
    deleteSessionFromSupabase,
    clearAllSupabaseSessions,
    syncSessionToMainSite,
    pullSessionFromMainSite,
    deserialize
};
