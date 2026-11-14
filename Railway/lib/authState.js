'use strict';

const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { SESSIONS_DIR, CONFIG_PATH } = require('./storagePaths');
const { useMultiFileAuthState, BufferJSON } = require('@whiskeysockets/baileys');

const serialize = (v) => JSON.stringify(v, BufferJSON.replacer);
const deserialize = (s) => JSON.parse(s, BufferJSON.reviver);

let _pgPool = null;
let _pgPoolUrl = null;
let _supabaseSyncedSessions = new Set();

function readSavedCloudConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (_) {}
    return {};
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
        _supabaseSyncedSessions.add(String(sessionId));
        return true;
    } catch (_) {
        return false;
    }
}

async function pullSupabaseSessionToLocal(sessionId, sessionDir) {
    const { hasPostgresUri } = getSupabaseCredentials();
    if (!hasPostgresUri || !sessionId) return false;
    try {
        const pool = await getPgPool();
        if (!pool) return false;
        const { rows } = await pool.query(`SELECT data, "sessionToken" FROM auth_creds WHERE "sessionId" = $1 LIMIT 1`, [String(sessionId)]);
        if (!rows?.[0]?.data) return false;
        const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'creds.json'), rows[0].data, 'utf8');
        if (rows[0].sessionToken) {
            fs.writeFileSync(path.join(targetDir, 'session_id.txt'), rows[0].sessionToken, 'utf8');
        }
        return true;
    } catch (_) {
        return false;
    }
}

async function syncLocalSessionToSupabase(sessionId, sessionDir, explicitToken = null) {
    const targetDir = sessionDir || path.join(SESSIONS_DIR, String(sessionId));
    const credsPath = path.join(targetDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    try {
        const rawCreds = fs.readFileSync(credsPath, 'utf8');
        return await syncCredsToSupabase(sessionId, rawCreds, explicitToken);
    } catch (_) {
        return false;
    }
}

async function listSupabaseSessionIds() {
    const { hasPostgresUri } = getSupabaseCredentials();
    if (!hasPostgresUri) return [];
    try {
        const pool = await getPgPool();
        if (!pool) return [];
        const { rows } = await pool.query(`SELECT "sessionId" FROM auth_creds LIMIT 100`);
        return (rows || []).map((r) => String(r.sessionId || '').trim()).filter(Boolean);
    } catch (_) {
        return [];
    }
}

async function deleteSessionFromSupabase(sessionId) {
    const { hasPostgresUri } = getSupabaseCredentials();
    if (!hasPostgresUri || !sessionId) return false;
    try {
        const pool = await getPgPool();
        if (!pool) return false;
        await pool.query(`DELETE FROM auth_keys WHERE "sessionId" = $1`, [String(sessionId)]);
        await pool.query(`DELETE FROM auth_creds WHERE "sessionId" = $1`, [String(sessionId)]);
        return true;
    } catch (_) {
        return false;
    }
}

async function clearAllSupabaseSessions() {
    const ids = await listSupabaseSessionIds();
    for (const id of ids) await deleteSessionFromSupabase(id);
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
    deserialize
};
