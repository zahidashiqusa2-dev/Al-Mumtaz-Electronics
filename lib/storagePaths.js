'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');
const TMP_FALLBACK_DIR = path.join(os.tmpdir(), 'almumtaz_electronics_data');

function isDirectoryWritable(dirPath) {
    if (!dirPath) return false;
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        const probeFile = path.join(dirPath, `.write_probe_${process.pid}_${Date.now()}`);
        fs.writeFileSync(probeFile, 'ok', 'utf8');
        fs.rmSync(probeFile, { force: true });
        return true;
    } catch (_) {
        return false;
    }
}

function resolveWritableDataDir() {
    const candidates = [
        process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH) : null,
        process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null,
        DEFAULT_DATA_DIR,
        TMP_FALLBACK_DIR
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (isDirectoryWritable(candidate)) {
            return candidate;
        }
    }
    return TMP_FALLBACK_DIR;
}

const DATA_DIR = resolveWritableDataDir();
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const LEGACY_SESSIONS_DIR = path.join(ROOT_DIR, 'session');
const DB_PATH = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(DATA_DIR, 'almumtaz_store.db');
const CONFIG_PATH = path.join(DATA_DIR, 'store_config.json');

for (const dir of [DATA_DIR, SESSIONS_DIR, path.dirname(DB_PATH)]) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (err) {
        console.warn(`[storage] Could not create directory ${dir}:`, err.message);
    }
}

function getDirectoryStats(dirPath) {
    let fileCount = 0;
    let totalBytes = 0;
    try {
        if (!fs.existsSync(dirPath)) return { fileCount: 0, totalBytes: 0 };
        const walk = (current) => {
            const list = fs.readdirSync(current, { withFileTypes: true });
            for (const item of list) {
                const full = path.join(current, item.name);
                if (item.isDirectory()) {
                    walk(full);
                } else if (item.isFile()) {
                    fileCount++;
                    totalBytes += fs.statSync(full).size;
                }
            }
        };
        walk(dirPath);
    } catch (_) {}
    return { fileCount, totalBytes };
}

function getVolumeDiagnostics() {
    let isWritable = false;
    try {
        const probeFile = path.join(DATA_DIR, '.volume_probe');
        fs.writeFileSync(probeFile, String(Date.now()), 'utf8');
        fs.rmSync(probeFile, { force: true });
        isWritable = true;
    } catch (_) {
        isWritable = false;
    }

    let dbSizeBytes = 0;
    try {
        if (fs.existsSync(DB_PATH)) {
            dbSizeBytes = fs.statSync(DB_PATH).size;
        }
    } catch (_) {}

    let sessionFoldersCount = 0;
    try {
        if (fs.existsSync(SESSIONS_DIR)) {
            sessionFoldersCount = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^\d+$/.test(d.name)).length;
        }
    } catch (_) {}

    const totalVolumeStats = getDirectoryStats(DATA_DIR);

    return {
        volumePath: DATA_DIR,
        sessionsPath: SESSIONS_DIR,
        dbPath: DB_PATH,
        isWritable,
        dbSizeBytes,
        sessionFoldersCount,
        totalVolumeBytes: totalVolumeStats.totalBytes
    };
}

module.exports = {
    ROOT_DIR,
    DATA_DIR,
    SESSIONS_DIR,
    LEGACY_SESSIONS_DIR,
    DB_PATH,
    CONFIG_PATH,
    getVolumeDiagnostics
};
