'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./storagePaths');
const { normalizeRailwayUrl } = require('./storeLogic');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_variables (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderJid TEXT NOT NULL,
    senderNumber TEXT NOT NULL,
    senderName TEXT DEFAULT 'WhatsApp Customer',
    description TEXT NOT NULL,
    forwardedToAdmin INTEGER DEFAULT 0,
    adminNumber TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    recipient TEXT NOT NULL,
    messageType TEXT NOT NULL,
    summary TEXT NOT NULL,
    payloadJson TEXT DEFAULT '{}',
    status TEXT DEFAULT 'sent',
    createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    phone_number TEXT PRIMARY KEY,
    session_id TEXT,
    status TEXT DEFAULT 'inactive',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    expiresAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    productCount INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cached_products (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    categorySlug TEXT NOT NULL,
    originalPrice REAL NOT NULL,
    discountPrice REAL NOT NULL,
    discountPercentage INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 10,
    isFeatured INTEGER DEFAULT 0,
    isFlashSale INTEGER DEFAULT 0
);
`);

const DEFAULT_VARS = [
    ['Admin_Username', process.env.Admin_Username || process.env.ADMIN_USERNAME || 'admin'],
    ['Admin_Password', process.env.Admin_Password || process.env.ADMIN_PASSWORD || 'AlMumtaz@2026'],
    ['Admin_Whatsapp', process.env.Admin_Whatsapp || process.env.ADMIN_WHATSAPP_NUMBER || '923299931199'],
    ['Cloudinary_URI', process.env.Cloudinary_URI || ''],
    ['MAIN_SITE_URL', process.env.MAIN_SITE_URL || ''],
    ['STORE_NAME', process.env.STORE_NAME || 'Al-Mumtaz Electronics'],
    ['STORE_CITY', process.env.STORE_CITY || 'Hasilpur'],
    ['STORE_ADDRESS', process.env.STORE_ADDRESS || 'Main Railway Road, Hasilpur, District Bahawalpur']
];

const insVar = db.prepare('INSERT OR IGNORE INTO store_variables (key, value) VALUES (?, ?)');
for (const [k, v] of DEFAULT_VARS) {
    insVar.run(k, String(v ?? ''));
}

// Seed baseline catalog fallback if MAIN_SITE_URL is unset or offline
if (db.prepare('SELECT COUNT(*) AS count FROM cached_categories').get().count === 0) {
    const insCat = db.prepare('INSERT INTO cached_categories (slug, name, productCount) VALUES (?, ?, ?)');
    insCat.run('smart-tvs', 'Smart TVs & Entertainment', 2);
    insCat.run('solar-inverters', 'Solar & Hybrid Inverters', 2);
    insCat.run('cooling-appliances', 'Refrigerators & Cooling', 2);
    insCat.run('audio-wearables', 'Audio & Smart Wearables', 2);
    insCat.run('kitchen-appliances', 'Kitchen Appliances', 1);
    insCat.run('power-backup', 'Fans & Power Backup', 1);
}

if (db.prepare('SELECT COUNT(*) AS count FROM cached_products').get().count === 0) {
    const insProd = db.prepare(`
        INSERT INTO cached_products (id, title, categorySlug, originalPrice, discountPrice, discountPercentage, stock, isFeatured, isFlashSale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insProd.run(1, 'Al-Mumtaz VisionPro 55" 4K QLED Google Smart TV', 'smart-tvs', 165000, 132500, 20, 14, 1, 1);
    insProd.run(2, 'Crown Helios 6kW Dual-MPPT Hybrid Solar Inverter + BMS', 'solar-inverters', 245000, 198000, 19, 9, 1, 1);
    insProd.run(3, 'Haier Twin-Inverter 14 Cu.Ft Matte Titanium Refrigerator', 'cooling-appliances', 118000, 98500, 17, 11, 1, 0);
    insProd.run(4, 'Gree 1.5 Ton T3 Full-DC Inverter Split Air Conditioner', 'cooling-appliances', 178000, 149000, 16, 8, 1, 1);
    insProd.run(5, 'StudioPro ANC Wireless Headphones + AMOLED Watch Combo', 'audio-wearables', 24500, 15900, 35, 28, 1, 1);
}

function getAllVariables() {
    const rows = db.prepare('SELECT key, value, updatedAt FROM store_variables ORDER BY key ASC').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;

    const mainSiteUrl = normalizeRailwayUrl(process.env.MAIN_SITE_URL || map.MAIN_SITE_URL || '');
    return {
        raw: rows,
        map,
        config: {
            adminWhatsappNumber: process.env.Admin_Whatsapp || map.Admin_Whatsapp || '923299931199',
            cloudinaryUri: process.env.Cloudinary_URI || map.Cloudinary_URI || '',
            mainSiteUrl,
            storePublicUrl: mainSiteUrl,
            storeName: process.env.STORE_NAME || map.STORE_NAME || 'Al-Mumtaz Electronics',
            storeCity: process.env.STORE_CITY || map.STORE_CITY || 'Hasilpur',
            storeAddress: process.env.STORE_ADDRESS || map.STORE_ADDRESS || 'Main Railway Road, Hasilpur'
        }
    };
}

function getAdminCredentials() {
    const { map } = getAllVariables();
    return {
        username: String(process.env.Admin_Username || process.env.ADMIN_USERNAME || map.Admin_Username || 'admin').trim(),
        password: String(process.env.Admin_Password || process.env.ADMIN_PASSWORD || map.Admin_Password || 'AlMumtaz@2026')
    };
}

function replaceCatalogCache(categories = [], products = []) {
    if (Array.isArray(categories) && categories.length > 0) {
        db.prepare('DELETE FROM cached_categories').run();
        const insCat = db.prepare('INSERT OR REPLACE INTO cached_categories (slug, name, productCount) VALUES (?, ?, ?)');
        for (const c of categories) {
            insCat.run(String(c.slug), String(c.name), Number(c.productCount || 0));
        }
    }
    if (Array.isArray(products) && products.length > 0) {
        db.prepare('DELETE FROM cached_products').run();
        const insProd = db.prepare(`
            INSERT OR REPLACE INTO cached_products (id, title, categorySlug, originalPrice, discountPrice, discountPercentage, stock, isFeatured, isFlashSale)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of products) {
            insProd.run(
                Number(p.id),
                String(p.title),
                String(p.categorySlug || 'smart-tvs'),
                Number(p.originalPrice || 0),
                Number(p.discountPrice || 0),
                Number(p.discountPercentage || 0),
                Number(p.stock || 0),
                p.isFeatured ? 1 : 0,
                p.isFlashSale ? 1 : 0
            );
        }
    }
}

function getCategories() {
    return db.prepare('SELECT slug, name, productCount FROM cached_categories ORDER BY name ASC').all();
}

function getProducts(filters = {}) {
    let rows = db.prepare('SELECT * FROM cached_products ORDER BY isFeatured DESC, id DESC').all()
        .map((r) => ({ ...r, isFeatured: Boolean(r.isFeatured), isFlashSale: Boolean(r.isFlashSale) }));

    if (filters.category) rows = rows.filter((p) => p.categorySlug === filters.category);
    if (filters.featured) rows = rows.filter((p) => p.isFeatured);
    if (filters.flashSale) rows = rows.filter((p) => p.isFlashSale || p.discountPercentage > 0);
    if (filters.sort === 'discount') rows.sort((a, b) => b.discountPercentage - a.discountPercentage);
    return rows;
}

function recordInquiry(data) {
    const info = db.prepare(`
        INSERT INTO inquiries (senderJid, senderNumber, senderName, description, forwardedToAdmin, adminNumber)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        String(data.senderJid || ''),
        String(data.senderNumber || ''),
        String(data.senderName || 'WhatsApp Customer'),
        String(data.description || ''),
        data.forwardedToAdmin ? 1 : 0,
        String(data.adminNumber || '')
    );
    return db.prepare('SELECT * FROM inquiries WHERE id = ?').get(info.lastInsertRowid);
}

function logWhatsAppEvent(entry) {
    const info = db.prepare(`
        INSERT INTO whatsapp_logs (direction, recipient, messageType, summary, payloadJson, status)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        String(entry.direction || 'outbound'),
        String(entry.recipient || ''),
        String(entry.messageType || 'text'),
        String(entry.summary || ''),
        JSON.stringify(entry.payload || {}),
        String(entry.status || 'sent')
    );
    return db.prepare('SELECT * FROM whatsapp_logs WHERE id = ?').get(info.lastInsertRowid);
}

function getWhatsAppLogs(limit = 60) {
    return db.prepare('SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT ?').all(limit);
}

function upsertWhatsAppSession(phoneNumber, sessionId, status = 'active') {
    const clean = String(phoneNumber || '').replace(/\D/g, '');
    if (!clean) return;
    db.prepare(`
        INSERT INTO sessions (phone_number, session_id, status, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(phone_number) DO UPDATE SET
            session_id = COALESCE(excluded.session_id, sessions.session_id),
            status = excluded.status,
            updated_at = datetime('now')
    `).run(clean, sessionId || '', status);
}

function deleteWhatsAppSessionRow(phoneNumber) {
    const clean = String(phoneNumber || '').replace(/\D/g, '');
    if (clean) db.prepare('DELETE FROM sessions WHERE phone_number = ?').run(clean);
}

function clearAllWhatsAppSessionRows() {
    db.prepare('DELETE FROM sessions').run();
}

function createAdminSession(username, token, ttlHours = 72) {
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    db.prepare('INSERT INTO admin_sessions (token, username, expiresAt) VALUES (?, ?, ?)').run(token, username, expiresAt);
    return { token, username, expiresAt };
}

function validateAdminSession(token) {
    if (!token) return null;
    const row = db.prepare('SELECT token, username, expiresAt FROM admin_sessions WHERE token = ?').get(String(token));
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
        db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(row.token);
        return null;
    }
    return row;
}

module.exports = {
    getAllVariables,
    getAdminCredentials,
    replaceCatalogCache,
    getCategories,
    getProducts,
    recordInquiry,
    logWhatsAppEvent,
    getWhatsAppLogs,
    upsertWhatsAppSession,
    deleteWhatsAppSessionRow,
    clearAllWhatsAppSessionRows,
    createAdminSession,
    validateAdminSession
};
