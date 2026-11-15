'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH } = require('./storagePaths');
const {
    calculateDiscountPercentage,
    calculateOrderTotals,
    normalizeRailwayUrl,
    computeStoreAnalytics,
    normalizeVariantOptions,
    normalizeOrderLookupInput
} = require('./storeLogic');

let activeDbPath = DB_PATH;
try {
    fs.mkdirSync(path.dirname(activeDbPath), { recursive: true });
} catch (err) {
    console.warn(`[database] Falling back to temp dir after mkdir error on ${activeDbPath}:`, err.message);
    const fallbackDir = path.join(os.tmpdir(), 'almumtaz_electronics_data');
    fs.mkdirSync(fallbackDir, { recursive: true });
    activeDbPath = path.join(fallbackDir, path.basename(DB_PATH) || 'almumtaz_store.db');
}
const db = new DatabaseSync(activeDbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT 'cpu',
    image TEXT DEFAULT '',
    parentCategory TEXT DEFAULT '',
    description TEXT DEFAULT '',
    sortOrder INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    imagesJson TEXT DEFAULT '[]',
    categorySlug TEXT NOT NULL,
    shopName TEXT DEFAULT 'Al-Mumtaz Official',
    brand TEXT DEFAULT 'Al-Mumtaz',
    originalPrice REAL NOT NULL,
    discountPrice REAL NOT NULL,
    discountPercentage INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 10,
    tagsJson TEXT DEFAULT '[]',
    isFeatured INTEGER DEFAULT 0,
    isFlashSale INTEGER DEFAULT 0,
    variantsJson TEXT DEFAULT '[]',
    rating REAL DEFAULT 4.8,
    reviewCount INTEGER DEFAULT 12,
    soldCount INTEGER DEFAULT 0,
    warranty TEXT DEFAULT '1 Year Official Brand Warranty',
    createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId TEXT UNIQUE NOT NULL,
    customerName TEXT NOT NULL,
    whatsappNumber TEXT NOT NULL,
    whatsappDigits TEXT NOT NULL,
    shippingAddress TEXT NOT NULL,
    city TEXT NOT NULL,
    nearestLandmark TEXT DEFAULT '',
    orderNotes TEXT DEFAULT '',
    itemsJson TEXT NOT NULL,
    subtotal REAL NOT NULL,
    discountTotal REAL DEFAULT 0,
    codDeliveryCharges REAL DEFAULT 0,
    grandTotal REAL NOT NULL,
    paymentMethod TEXT DEFAULT 'Cash on Delivery (COD)',
    orderStatus TEXT DEFAULT 'Pending WhatsApp Confirmation',
    whatsappMessageId TEXT DEFAULT '',
    whatsappDispatchMode TEXT DEFAULT 'baileys',
    whatsappConfirmedAt TEXT DEFAULT '',
    orderDate TEXT DEFAULT (datetime('now')),
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

CREATE TABLE IF NOT EXISTS store_variables (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    label TEXT DEFAULT '',
    updatedAt TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS media_images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    contentType TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    storage TEXT DEFAULT 'sqlite',
    remoteUrl TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wa_auth_backups (
    sessionId TEXT PRIMARY KEY,
    credsJson TEXT NOT NULL,
    keysJson TEXT DEFAULT '{}',
    sessionToken TEXT DEFAULT '',
    updatedAt TEXT DEFAULT (datetime('now'))
);
`);

try {
    db.exec(`ALTER TABLE media_images ADD COLUMN remoteUrl TEXT DEFAULT ''`);
} catch (_) {}
try {
    db.exec(`ALTER TABLE products ADD COLUMN variantPricingJson TEXT DEFAULT '[]'`);
} catch (_) {}

const DEFAULT_VARIABLES = [
    { key: 'Admin_Username', value: process.env.Admin_Username || process.env.ADMIN_USERNAME || 'admin', label: 'Admin Portal Login Username' },
    { key: 'Admin_Password', value: process.env.Admin_Password || process.env.ADMIN_PASSWORD || 'AlMumtaz@2026', label: 'Admin Portal Login Password' },
    { key: 'Admin_Whatsapp', value: process.env.Admin_Whatsapp || process.env.ADMIN_WHATSAPP_NUMBER || '923299931199', label: 'Admin WhatsApp Number (for Inquiries & Alerts)' },
    { key: 'Cloudinary_URI', value: process.env.Cloudinary_URI || process.env.CLOUDINARY_URL || '', label: 'Cloudinary Connection URI (cloudinary://api_key:api_secret@cloud_name)' },
    { key: 'Railway_URL', value: process.env.Railway_URL || process.env.RAILWAY_URL || process.env.RAILWAY_BACKEND_URL || 'https://al-mumtaz-electronics-production-f2e7e327.up.railway.app', label: '24/7 Railway WhatsApp Bot Backend URL' },
    { key: 'STORE_NAME', value: process.env.STORE_NAME || 'Al-Mumtaz Electronics', label: 'Store Name' },
    { key: 'STORE_CITY', value: process.env.STORE_CITY || 'Hasilpur', label: 'Primary Store City' },
    { key: 'STORE_ADDRESS', value: 'Main Railway Road, Hasilpur, District Bahawalpur', label: 'Physical Showroom Address' },
    { key: 'STORE_PHONE', value: '03299931199', label: 'Public Contact Helpline' },
    { key: 'COD_FLAT_RATE', value: '250', label: 'Standard COD Delivery Charge (PKR)' },
    { key: 'EXPRESS_COD_RATE', value: '550', label: 'Express COD Delivery Charge (PKR)' },
    { key: 'FREE_DELIVERY_THRESHOLD', value: '35000', label: 'Free COD Delivery Order Threshold (PKR)' },
    {
        key: 'CITY_RATES_JSON',
        value: JSON.stringify({
            Hasilpur: 0,
            Bahawalpur: 200,
            Vehari: 200,
            Multan: 300,
            Lahore: 350,
            Islamabad: 400,
            Rawalpindi: 400,
            Karachi: 450
        }),
        label: 'City-Based COD Rates (JSON)'
    },
    { key: 'STORE_PUBLIC_URL', value: process.env.STORE_URL || process.env.APP_URL || 'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app', label: 'Public Storefront URL (for WhatsApp links)' },
    { key: 'API_SECRET_KEY', value: process.env.API_SECRET_KEY || 'almumtaz-secret-2026', label: 'API & Webhook Secret Token (for Railway / External Bridge)' },
    { key: 'STORE_PAYMENT_INFO', value: process.env.STORE_PAYMENT_INFO || 'EasyPaisa / JazzCash: 0329-9931199 (Al-Mumtaz Electronics Hasilpur) · Cash on Delivery (COD) also available nationwide.', label: 'Online Payment Instructions (WhatsApp Pay Flow)' }
];

function seedDefaults() {
    // Migrate legacy variable keys cleanly and remove obsolete Meta / MongoDB keys
    const legacyMigratePairs = [
        ['ADMIN_USERNAME', 'Admin_Username'],
        ['ADMIN_PASSWORD', 'Admin_Password'],
        ['ADMIN_WHATSAPP_NUMBER', 'Admin_Whatsapp']
    ];
    for (const [oldKey, newKey] of legacyMigratePairs) {
        const oldRow = db.prepare('SELECT value FROM store_variables WHERE key = ?').get(oldKey);
        const newRow = db.prepare('SELECT value FROM store_variables WHERE key = ?').get(newKey);
        if (oldRow && !newRow) {
            db.prepare('INSERT OR IGNORE INTO store_variables (key, value, label) VALUES (?, ?, ?)').run(newKey, oldRow.value, newKey);
        }
    }
    db.prepare(`
        DELETE FROM store_variables
        WHERE key IN (
            'WHATSAPP_PROVIDER', 'META_WA_PHONE_NUMBER_ID', 'META_WA_ACCESS_TOKEN', 'META_WA_VERIFY_TOKEN',
            'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_WHATSAPP_NUMBER', 'MONGODB_URI'
        )
    `).run();

    const insertVar = db.prepare(`
        INSERT OR IGNORE INTO store_variables (key, value, label) VALUES (?, ?, ?)
    `);
    for (const v of DEFAULT_VARIABLES) {
        insertVar.run(v.key, v.value, v.label);
    }

    // Backfill STORE_PUBLIC_URL & Railway_URL if previously blank or placeholder
    const curUrlRow = db.prepare("SELECT value FROM store_variables WHERE key = 'STORE_PUBLIC_URL'").get();
    if (!curUrlRow || !String(curUrlRow.value || '').trim() || String(curUrlRow.value).trim() === 'https://al-mumtaz.ai.studio') {
        db.prepare("INSERT OR REPLACE INTO store_variables (key, value, label) VALUES ('STORE_PUBLIC_URL', ?, 'Public Storefront URL (for WhatsApp links)')")
            .run(process.env.STORE_URL || process.env.APP_URL || 'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app');
    }
    const curRailwayRow = db.prepare("SELECT value FROM store_variables WHERE key = 'Railway_URL'").get();
    if (!curRailwayRow || !String(curRailwayRow.value || '').trim()) {
        db.prepare("INSERT OR REPLACE INTO store_variables (key, value, label) VALUES ('Railway_URL', ?, '24/7 Railway WhatsApp Bot Backend URL')")
            .run(process.env.Railway_URL || process.env.RAILWAY_URL || process.env.RAILWAY_BACKEND_URL || 'https://al-mumtaz-electronics-production-f2e7e327.up.railway.app');
    }

    // Ensure Railway/container env overrides sync cleanly when explicitly set in environment
    const envOverrides = [
        ['Admin_Username', process.env.Admin_Username || process.env.ADMIN_USERNAME],
        ['Admin_Password', process.env.Admin_Password || process.env.ADMIN_PASSWORD],
        ['Admin_Whatsapp', process.env.Admin_Whatsapp || process.env.ADMIN_NUMBER || process.env.ADMIN_WHATSAPP_NUMBER],
        ['Cloudinary_URI', process.env.Cloudinary_URI || process.env.CLOUDINARY_URL],
        ['Railway_URL', process.env.Railway_URL || process.env.RAILWAY_URL || process.env.RAILWAY_BACKEND_URL],
        ['STORE_PUBLIC_URL', process.env.STORE_URL || process.env.APP_URL],
        ['API_SECRET_KEY', process.env.API_SECRET_KEY],
        ['STORE_PAYMENT_INFO', process.env.STORE_PAYMENT_INFO]
    ];
    const upsertOverride = db.prepare(`UPDATE store_variables SET value = ?, updatedAt = datetime('now') WHERE key = ?`);
    for (const [k, val] of envOverrides) {
        if (val && String(val).trim()) {
            upsertOverride.run(String(val).trim(), k);
        }
    }

    const catCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
    if (catCount === 0) {
        const categories = [
            { name: 'Smart TVs & Entertainment', slug: 'smart-tvs', icon: 'tv', image: '/images/product_qled_tv.jpg', description: '4K QLED, Google TV & Android LED Displays', sortOrder: 1 },
            { name: 'Solar & Hybrid Inverters', slug: 'solar-inverters', icon: 'sun', image: '/images/product_solar_inverter.jpg', description: 'MPPT Hybrid Inverters, Lithium Batteries & Solar Kits', sortOrder: 2 },
            { name: 'Refrigerators & Cooling', slug: 'cooling-appliances', icon: 'snowflake', image: '/images/product_refrigerator_ac.jpg', description: 'DC Inverter Refrigerators, Split ACs & Deep Freezers', sortOrder: 3 },
            { name: 'Audio & Smart Wearables', slug: 'audio-wearables', icon: 'headphones', image: '/images/product_audio_accessories.jpg', description: 'ANC Headphones, AMOLED Smartwatches & Soundbars', sortOrder: 4 },
            { name: 'Kitchen Appliances', slug: 'kitchen-appliances', icon: 'flame', image: '/images/product_refrigerator_ac.jpg', description: 'Microwave Ovens, Air Fryers & Automatic Dispensers', sortOrder: 5 },
            { name: 'Fans & Power Backup', slug: 'power-backup', icon: 'zap', image: '/images/product_solar_inverter.jpg', description: 'AC/DC Inverter Fans, UPS Systems & Voltage Stabilizers', sortOrder: 6 }
        ];
        const insCat = db.prepare(`
            INSERT INTO categories (name, slug, icon, image, description, sortOrder)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const c of categories) {
            insCat.run(c.name, c.slug, c.icon, c.image, c.description, c.sortOrder);
        }
    }

    const prodCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    if (prodCount === 0) {
        const products = [
            {
                title: 'Al-Mumtaz VisionPro 55" 4K QLED Google Smart TV',
                slug: 'visionpro-55-4k-qled-smart-tv',
                sku: 'AME-TV-55QLED',
                description: 'Frameless 55-inch 4K UHD Quantum Dot display with Dolby Audio, HDR10+, dual-band Wi-Fi, built-in Chromecast, and voice remote.',
                images: ['/images/product_qled_tv.jpg', '/images/hero_electronics_showcase.jpg'],
                categorySlug: 'smart-tvs',
                shopName: 'Al-Mumtaz Official',
                brand: 'TCL / Haier Series',
                originalPrice: 165000,
                discountPrice: 132500,
                stock: 14,
                tags: ['Featured', 'Hot', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 1,
                variants: ['55-Inch QLED', '43-Inch 4K UHD', '65-Inch QLED'],
                rating: 4.9,
                reviewCount: 48,
                soldCount: 87,
                warranty: '2 Years Official Panel & Parts Warranty'
            },
            {
                title: 'Crown Helios 6kW Dual-MPPT Hybrid Solar Inverter + BMS',
                slug: 'crown-helios-6kw-hybrid-solar-inverter',
                sku: 'AME-SOL-6000H',
                description: 'IP65 hybrid solar inverter with dual MPPT solar trackers, battery-less operation mode, smart Wi-Fi monitoring, and lithium BMS communication.',
                images: ['/images/product_solar_inverter.jpg', '/images/hero_electronics_showcase.jpg'],
                categorySlug: 'solar-inverters',
                shopName: 'Al-Mumtaz Solar Hub',
                brand: 'Crown / Inverex',
                originalPrice: 245000,
                discountPrice: 198000,
                stock: 9,
                tags: ['Featured', 'Hot', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 1,
                variants: ['6kW Hybrid', '4kW Hybrid', '8kW Dual Output'],
                rating: 4.9,
                reviewCount: 64,
                soldCount: 112,
                warranty: '5 Years Inverter Service Warranty'
            },
            {
                title: 'Haier Twin-Inverter 14 Cu.Ft Matte Titanium Refrigerator',
                slug: 'haier-twin-inverter-14-titanium-fridge',
                sku: 'AME-FRG-14TI',
                description: '1-Hour icing technology with FD Inverter compressor (runs smoothly on 1kW solar/UPS), anti-fungal gasket, and turbo cooling.',
                images: ['/images/product_refrigerator_ac.jpg', '/images/hero_electronics_showcase.jpg'],
                categorySlug: 'cooling-appliances',
                shopName: 'Al-Mumtaz Cooling Store',
                brand: 'Haier / Dawlance',
                originalPrice: 118000,
                discountPrice: 98500,
                stock: 11,
                tags: ['Featured', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 0,
                variants: ['14 Cu.Ft Titanium', '16 Cu.Ft Glass Black'],
                rating: 4.8,
                reviewCount: 39,
                soldCount: 74,
                warranty: '10 Years Compressor + 1 Year Parts'
            },
            {
                title: 'Gree 1.5 Ton T3 Full-DC Inverter Split Air Conditioner',
                slug: 'gree-1-5-ton-t3-dc-inverter-ac',
                sku: 'AME-AC-18T3DC',
                description: 'Tropicalized T3 compressor engineered for South Punjab 52°C summers, 60% energy saving, low-voltage startup (150V), and 4-way swing.',
                images: ['/images/product_refrigerator_ac.jpg'],
                categorySlug: 'cooling-appliances',
                shopName: 'Al-Mumtaz Cooling Store',
                brand: 'Gree / Kenwood',
                originalPrice: 178000,
                discountPrice: 149000,
                stock: 8,
                tags: ['Hot', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 1,
                variants: ['1.5 Ton Heat & Cool', '1.0 Ton Cool Only'],
                rating: 4.9,
                reviewCount: 53,
                soldCount: 95,
                warranty: '4 Years PCB + 10 Years Compressor'
            },
            {
                title: 'StudioPro ANC Wireless Headphones + AMOLED Watch Combo',
                slug: 'studiopro-anc-headphones-watch-combo',
                sku: 'AME-AUD-PRO26',
                description: '45dB Hybrid Active Noise Cancelling Bluetooth 5.3 headphones paired with an aluminum AMOLED Bluetooth calling smartwatch & TWS earbuds.',
                images: ['/images/product_audio_accessories.jpg'],
                categorySlug: 'audio-wearables',
                shopName: 'Al-Mumtaz Tech Accessories',
                brand: 'SoundCore / Audionic',
                originalPrice: 24500,
                discountPrice: 15900,
                stock: 28,
                tags: ['New Arrival', 'Hot'],
                isFeatured: 1,
                isFlashSale: 1,
                variants: ['Matte Black Combo', 'Headphones Only', 'Watch + TWS'],
                rating: 4.7,
                reviewCount: 82,
                soldCount: 163,
                warranty: '6 Months Replacement Warranty'
            },
            {
                title: 'EcoPower 48V 100Ah LiFePO4 Wall-Mount Lithium Battery',
                slug: 'ecopower-48v-100ah-lifepo4-battery',
                sku: 'AME-BAT-5120WH',
                description: '5.12kWh Grade-A LiFePO4 solar storage battery with 6000+ cycle life, smart LCD telemetry, and plug-and-play RS485/CAN inverter sync.',
                images: ['/images/product_solar_inverter.jpg'],
                categorySlug: 'solar-inverters',
                shopName: 'Al-Mumtaz Solar Hub',
                brand: 'Narada / Pylontech',
                originalPrice: 295000,
                discountPrice: 258000,
                stock: 6,
                tags: ['Featured', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 0,
                variants: ['51.2V 100Ah (5.1kWh)', '25.6V 100Ah (2.5kWh)'],
                rating: 4.9,
                reviewCount: 27,
                soldCount: 41,
                warranty: '5 Years Official Cycle Warranty'
            },
            {
                title: 'Dawlance 30L Convection Grill Microwave Oven (Digital)',
                slug: 'dawlance-30l-convection-microwave',
                sku: 'AME-KIT-MW30',
                description: 'Stainless cavity 30-liter digital microwave with built-in grill, auto-defrost presets, child lock, and local recipe menus.',
                images: ['/images/product_refrigerator_ac.jpg'],
                categorySlug: 'kitchen-appliances',
                shopName: 'Al-Mumtaz Kitchens',
                brand: 'Dawlance',
                originalPrice: 44000,
                discountPrice: 36500,
                stock: 19,
                tags: ['New Arrival', 'Free Delivery'],
                isFeatured: 0,
                isFlashSale: 1,
                variants: ['30L Stainless Silver', '25L Matte Black'],
                rating: 4.7,
                reviewCount: 31,
                soldCount: 58,
                warranty: '2 Years Official Warranty'
            },
            {
                title: 'Royal 30W BLDC AC/DC Inverter Ceiling Fan (Copper)',
                slug: 'royal-30w-bldc-ac-dc-ceiling-fan',
                sku: 'AME-FAN-30BLDC',
                description: '99.9% pure copper winding brushless DC ceiling fan consuming just 30W on 12V solar battery or 220V WAPDA with RF remote control.',
                images: ['/images/product_solar_inverter.jpg'],
                categorySlug: 'power-backup',
                shopName: 'Al-Mumtaz Official',
                brand: 'Royal / Pak Fans',
                originalPrice: 13500,
                discountPrice: 10900,
                stock: 42,
                tags: ['Hot', 'New Arrival'],
                isFeatured: 0,
                isFlashSale: 1,
                variants: ['56-Inch Pearl White', '56-Inch Walnut Wood'],
                rating: 4.8,
                reviewCount: 94,
                soldCount: 215,
                warranty: '2 Years Motor & Card Warranty'
            },
            {
                title: 'Samsung 43" Crystal UHD 4K Smart LED TV (2026 Edition)',
                slug: 'samsung-43-crystal-uhd-4k-tv',
                sku: 'AME-TV-43CUHD',
                description: 'PurColor 4K processor with Tizen OS, AirPlay 2, ultra-slim bezel, and crystal clear HDR contrast for bedrooms and lounges.',
                images: ['/images/product_qled_tv.jpg'],
                categorySlug: 'smart-tvs',
                shopName: 'Al-Mumtaz Official',
                brand: 'Samsung',
                originalPrice: 129000,
                discountPrice: 112000,
                stock: 10,
                tags: ['Featured', 'Free Delivery'],
                isFeatured: 1,
                isFlashSale: 0,
                variants: ['43-Inch Crystal UHD', '50-Inch Crystal UHD'],
                rating: 4.9,
                reviewCount: 36,
                soldCount: 52,
                warranty: '1 Year Official Warranty'
            },
            {
                title: 'SonicBeat 2.1CH 120W Bluetooth Soundbar + Subwoofer',
                slug: 'sonicbeat-120w-bluetooth-soundbar',
                sku: 'AME-AUD-SB120',
                description: 'Deep wireless bass subwoofer with HDMI ARC, Optical, USB, and Bluetooth 5.3 streaming designed to upgrade any Smart TV.',
                images: ['/images/product_audio_accessories.jpg'],
                categorySlug: 'audio-wearables',
                shopName: 'Al-Mumtaz Tech Accessories',
                brand: 'Audionic / JBL',
                originalPrice: 28000,
                discountPrice: 21500,
                stock: 16,
                tags: ['New Arrival'],
                isFeatured: 0,
                isFlashSale: 0,
                variants: ['120W Matte Black'],
                rating: 4.6,
                reviewCount: 22,
                soldCount: 38,
                warranty: '1 Year Official Warranty'
            }
        ];

        const insProd = db.prepare(`
            INSERT INTO products (
                title, slug, sku, description, imagesJson, categorySlug, shopName, brand,
                originalPrice, discountPrice, discountPercentage, stock, tagsJson,
                isFeatured, isFlashSale, variantsJson, rating, reviewCount, soldCount, warranty
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const p of products) {
            const pct = calculateDiscountPercentage(p.originalPrice, p.discountPrice);
            insProd.run(
                p.title,
                p.slug,
                p.sku,
                p.description,
                JSON.stringify(p.images),
                p.categorySlug,
                p.shopName,
                p.brand,
                p.originalPrice,
                p.discountPrice,
                pct,
                p.stock,
                JSON.stringify(p.tags),
                p.isFeatured,
                p.isFlashSale,
                JSON.stringify(p.variants),
                p.rating,
                p.reviewCount,
                p.soldCount,
                p.warranty
            );
        }
    }

    const ordCount = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    if (ordCount === 0) {
        const sampleOrder1Items = calculateOrderTotals([
            {
                productId: 5,
                title: 'StudioPro ANC Wireless Headphones + AMOLED Watch Combo',
                sku: 'AME-AUD-PRO26',
                variant: 'Matte Black Combo',
                quantity: 1,
                originalPrice: 24500,
                discountPrice: 15900,
                image: '/images/product_audio_accessories.jpg'
            }
        ], { codFlatRate: 250, cityRates: { Hasilpur: 0 } }, 'Hasilpur');

        db.prepare(`
            INSERT INTO orders (
                orderId, customerName, whatsappNumber, whatsappDigits, shippingAddress, city,
                nearestLandmark, orderNotes, itemsJson, subtotal, discountTotal,
                codDeliveryCharges, grandTotal, paymentMethod, orderStatus, whatsappDispatchMode, whatsappConfirmedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'ORD-2026-1041',
            'Hamza Tariq',
            '+923001234567',
            '923001234567',
            'House 14, Block B, Model Town',
            'Hasilpur',
            'Near Main Railway Gate',
            'Deliver after 4 PM',
            JSON.stringify(sampleOrder1Items.items),
            sampleOrder1Items.subtotal,
            sampleOrder1Items.discountTotal,
            sampleOrder1Items.codDeliveryCharges,
            sampleOrder1Items.grandTotal,
            'Cash on Delivery (COD)',
            'Confirmed',
            'baileys',
            new Date().toISOString()
        );
    }
}

seedDefaults();

function parseProductRow(row) {
    if (!row) return null;
    let images = [];
    let tags = [];
    let variants = [];
    let variantPricing = [];
    try { images = JSON.parse(row.imagesJson || '[]'); } catch (_) {}
    try { tags = JSON.parse(row.tagsJson || '[]'); } catch (_) {}
    try { variants = JSON.parse(row.variantsJson || '[]'); } catch (_) {}
    try { variantPricing = JSON.parse(row.variantPricingJson || '[]'); } catch (_) {}

    const normalizedVariants = normalizeVariantOptions(
        variants,
        variantPricing,
        row.originalPrice,
        row.discountPrice,
        row.stock
    );

    return {
        ...row,
        images: Array.isArray(images) && images.length > 0 ? images : ['/images/product_qled_tv.jpg'],
        tags: Array.isArray(tags) ? tags : [],
        variants: normalizedVariants.variantNames,
        variantOptions: normalizedVariants.variantOptions,
        isFeatured: Boolean(row.isFeatured),
        isFlashSale: Boolean(row.isFlashSale)
    };
}

function parseOrderRow(row) {
    if (!row) return null;
    let items = [];
    try { items = JSON.parse(row.itemsJson || '[]'); } catch (_) {}
    return { ...row, items };
}

function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `item-${Date.now()}`;
}

function getAllVariables() {
    const rows = db.prepare('SELECT key, value, label, updatedAt FROM store_variables ORDER BY key ASC').all();
    const map = {};
    for (const r of rows) {
        map[r.key] = r.value;
    }
    let cityRates = {};
    try { cityRates = JSON.parse(map.CITY_RATES_JSON || '{}'); } catch (_) {}

    return {
        raw: rows,
        map,
        config: {
            adminWhatsappNumber: process.env.Admin_Whatsapp || process.env.ADMIN_NUMBER || map.Admin_Whatsapp || '923299931199',
            cloudinaryUri: map.Cloudinary_URI || '',
            railwayUrl: normalizeRailwayUrl(map.Railway_URL || ''),
            storeName: map.STORE_NAME || 'Al-Mumtaz Electronics',
            storeCity: map.STORE_CITY || 'Hasilpur',
            storeAddress: map.STORE_ADDRESS || 'Main Railway Road, Hasilpur',
            storePhone: map.STORE_PHONE || '03299931199',
            codFlatRate: Number(map.COD_FLAT_RATE ?? 250),
            expressCodRate: Number(map.EXPRESS_COD_RATE ?? 550),
            freeDeliveryThreshold: Number(map.FREE_DELIVERY_THRESHOLD ?? 35000),
            cityRates,
            storeUrl: normalizeRailwayUrl(process.env.STORE_URL || map.STORE_PUBLIC_URL || process.env.APP_URL || '') || 'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app',
            storePublicUrl: normalizeRailwayUrl(process.env.STORE_URL || map.STORE_PUBLIC_URL || process.env.APP_URL || '') || 'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app',
            siteApiUrl: normalizeRailwayUrl(process.env.SITE_API_URL || ''),
            apiSecretKey: process.env.API_SECRET_KEY || map.API_SECRET_KEY || 'almumtaz-secret-2026',
            paymentInfo: map.STORE_PAYMENT_INFO || 'EasyPaisa / JazzCash: 0329-9931199 (Al-Mumtaz Electronics Hasilpur) · Cash on Delivery (COD) also available nationwide.'
        }
    };
}

function setVariable(key, value, label = null) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) throw new Error('Variable key is required.');
    const existing = db.prepare('SELECT label FROM store_variables WHERE key = ?').get(cleanKey);
    const finalLabel = label !== null ? String(label) : (existing?.label || cleanKey);
    db.prepare(`
        INSERT INTO store_variables (key, value, label, updatedAt)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            label = COALESCE(NULLIF(excluded.label, ''), store_variables.label),
            updatedAt = datetime('now')
    `).run(cleanKey, String(value ?? ''), finalLabel);
    return getAllVariables();
}

function getCategories() {
    return db.prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.categorySlug = c.slug) AS productCount
        FROM categories c
        ORDER BY c.sortOrder ASC, c.id ASC
    `).all();
}

function createCategory(data) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Category name is required.');
    const slug = slugify(data.slug || name);
    const info = db.prepare(`
        INSERT INTO categories (name, slug, icon, image, parentCategory, description, sortOrder)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        name,
        slug,
        String(data.icon || 'cpu'),
        String(data.image || '/images/product_qled_tv.jpg'),
        String(data.parentCategory || ''),
        String(data.description || ''),
        Number(data.sortOrder) || 10
    );
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
}

function deleteCategory(idOrSlug) {
    const target = String(idOrSlug || '').trim();
    if (/^\d+$/.test(target)) {
        return db.prepare('DELETE FROM categories WHERE id = ?').run(Number(target));
    }
    return db.prepare('DELETE FROM categories WHERE slug = ?').run(target);
}

function getProducts(filters = {}) {
    let rows = db.prepare('SELECT * FROM products ORDER BY isFeatured DESC, id DESC').all().map(parseProductRow);

    if (filters.category && filters.category !== 'all') {
        rows = rows.filter((p) => p.categorySlug === filters.category);
    }
    if (filters.featured === true || filters.featured === 'true') {
        rows = rows.filter((p) => p.isFeatured);
    }
    if (filters.flashSale === true || filters.flashSale === 'true' || filters.offered === 'true') {
        rows = rows.filter((p) => p.isFlashSale || p.discountPercentage > 0);
    }
    if (filters.inStock === true || filters.inStock === 'true') {
        rows = rows.filter((p) => p.stock > 0);
    }
    if (filters.tag) {
        const t = String(filters.tag).toLowerCase();
        rows = rows.filter((p) => p.tags.some((tag) => tag.toLowerCase() === t));
    }
    if (filters.minPrice !== undefined && filters.minPrice !== '') {
        const min = Number(filters.minPrice) || 0;
        rows = rows.filter((p) => p.discountPrice >= min);
    }
    if (filters.maxPrice !== undefined && filters.maxPrice !== '') {
        const max = Number(filters.maxPrice);
        if (max > 0) rows = rows.filter((p) => p.discountPrice <= max);
    }
    if (filters.minDiscount !== undefined && filters.minDiscount !== '') {
        const minD = Number(filters.minDiscount) || 0;
        rows = rows.filter((p) => p.discountPercentage >= minD);
    }
    if (filters.minRating !== undefined && filters.minRating !== '') {
        const minR = Number(filters.minRating) || 0;
        rows = rows.filter((p) => p.rating >= minR);
    }
    if (filters.search) {
        const q = String(filters.search).toLowerCase().trim();
        rows = rows.filter((p) =>
            p.title.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            p.brand.toLowerCase().includes(q) ||
            p.categorySlug.toLowerCase().includes(q)
        );
    }

    switch (filters.sort) {
        case 'price_asc':
            rows.sort((a, b) => a.discountPrice - b.discountPrice);
            break;
        case 'price_desc':
            rows.sort((a, b) => b.discountPrice - a.discountPrice);
            break;
        case 'best_selling':
            rows.sort((a, b) => b.soldCount - a.soldCount);
            break;
        case 'discount':
            rows.sort((a, b) => b.discountPercentage - a.discountPercentage);
            break;
        case 'newest':
        default:
            rows.sort((a, b) => b.id - a.id);
            break;
    }

    return rows;
}

function getProductBySlugOrId(idOrSlug) {
    const val = String(idOrSlug || '').trim();
    const row = /^\d+$/.test(val)
        ? db.prepare('SELECT * FROM products WHERE id = ?').get(Number(val))
        : db.prepare('SELECT * FROM products WHERE slug = ?').get(val);
    return parseProductRow(row);
}

function createProduct(data) {
    const title = String(data.title || '').trim();
    if (!title) throw new Error('Product title is required.');
    const rawOriginal = Number(data.originalPrice || data.discountPrice || 0);
    const rawDiscount = Number(data.discountPrice || rawOriginal || 0);
    const baseStock = Math.max(0, parseInt(data.stock, 10) || 0);

    const normalizedVariants = normalizeVariantOptions(
        data.variants !== undefined ? data.variants : 'Standard Edition',
        data.variantPricing || data.variantOptions,
        rawOriginal,
        rawDiscount,
        baseStock
    );

    const primaryOpt = normalizedVariants.variantOptions[0];
    const originalPrice = Math.max(1, rawOriginal || primaryOpt?.originalPrice || 1);
    const discountPrice = Math.max(1, rawDiscount || primaryOpt?.discountPrice || originalPrice);
    const discountPercentage = calculateDiscountPercentage(originalPrice, discountPrice);
    const baseSlug = slugify(data.slug || title);
    const existingSlug = db.prepare('SELECT id FROM products WHERE slug = ?').get(baseSlug);
    const slug = existingSlug ? `${baseSlug}-${Date.now().toString().slice(-4)}` : baseSlug;
    const sku = String(data.sku || `AME-${Date.now().toString().slice(-6)}`).trim().toUpperCase();

    const images = Array.isArray(data.images) && data.images.length > 0
        ? data.images
        : [String(data.image || '/images/product_qled_tv.jpg')];
    const tags = Array.isArray(data.tags)
        ? data.tags
        : String(data.tags || '').split(',').map((s) => s.trim()).filter(Boolean);

    const info = db.prepare(`
        INSERT INTO products (
            title, slug, sku, description, imagesJson, categorySlug, shopName, brand,
            originalPrice, discountPrice, discountPercentage, stock, tagsJson,
            isFeatured, isFlashSale, variantsJson, variantPricingJson, rating, reviewCount, soldCount, warranty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        title,
        slug,
        sku,
        String(data.description || ''),
        JSON.stringify(images),
        String(data.categorySlug || 'smart-tvs'),
        String(data.shopName || 'Al-Mumtaz Official'),
        String(data.brand || 'Al-Mumtaz'),
        originalPrice,
        discountPrice,
        discountPercentage,
        baseStock,
        JSON.stringify(tags),
        data.isFeatured ? 1 : 0,
        data.isFlashSale ? 1 : 0,
        JSON.stringify(normalizedVariants.variantNames),
        JSON.stringify(normalizedVariants.variantOptions),
        Number(data.rating) || 4.8,
        parseInt(data.reviewCount, 10) || 1,
        parseInt(data.soldCount, 10) || 0,
        String(data.warranty || '1 Year Official Brand Warranty')
    );

    return getProductBySlugOrId(info.lastInsertRowid);
}

function updateProduct(id, data) {
    const existing = getProductBySlugOrId(id);
    if (!existing) throw new Error('Product not found.');

    const title = data.title !== undefined ? String(data.title).trim() : existing.title;
    const originalPrice = data.originalPrice !== undefined ? Math.max(1, Number(data.originalPrice)) : existing.originalPrice;
    const discountPrice = data.discountPrice !== undefined ? Math.max(1, Number(data.discountPrice)) : existing.discountPrice;
    const discountPercentage = calculateDiscountPercentage(originalPrice, discountPrice);
    const nextStock = data.stock !== undefined ? Math.max(0, parseInt(data.stock, 10) || 0) : existing.stock;

    const images = data.images !== undefined
        ? (Array.isArray(data.images) ? data.images : [String(data.images)])
        : (data.image ? [String(data.image)] : existing.images);

    const tags = data.tags !== undefined
        ? (Array.isArray(data.tags) ? data.tags : String(data.tags).split(',').map((s) => s.trim()).filter(Boolean))
        : existing.tags;

    const hasVariantUpdate = data.variants !== undefined || data.variantPricing !== undefined || data.variantOptions !== undefined;
    const normalizedVariants = hasVariantUpdate
        ? normalizeVariantOptions(
            data.variants !== undefined ? data.variants : existing.variants,
            data.variantPricing || data.variantOptions,
            originalPrice,
            discountPrice,
            nextStock
        )
        : normalizeVariantOptions(
            existing.variants,
            existing.variantOptions,
            originalPrice,
            discountPrice,
            nextStock
        );

    db.prepare(`
        UPDATE products SET
            title = ?, description = ?, imagesJson = ?, categorySlug = ?, shopName = ?, brand = ?,
            originalPrice = ?, discountPrice = ?, discountPercentage = ?, stock = ?,
            tagsJson = ?, isFeatured = ?, isFlashSale = ?, variantsJson = ?, variantPricingJson = ?, warranty = ?
        WHERE id = ?
    `).run(
        title,
        data.description !== undefined ? String(data.description) : existing.description,
        JSON.stringify(images),
        data.categorySlug !== undefined ? String(data.categorySlug) : existing.categorySlug,
        data.shopName !== undefined ? String(data.shopName) : existing.shopName,
        data.brand !== undefined ? String(data.brand) : existing.brand,
        originalPrice,
        discountPrice,
        discountPercentage,
        nextStock,
        JSON.stringify(tags),
        data.isFeatured !== undefined ? (data.isFeatured ? 1 : 0) : (existing.isFeatured ? 1 : 0),
        data.isFlashSale !== undefined ? (data.isFlashSale ? 1 : 0) : (existing.isFlashSale ? 1 : 0),
        JSON.stringify(normalizedVariants.variantNames),
        JSON.stringify(normalizedVariants.variantOptions),
        data.warranty !== undefined ? String(data.warranty) : existing.warranty,
        existing.id
    );

    return getProductBySlugOrId(existing.id);
}

function deleteProduct(id) {
    return db.prepare('DELETE FROM products WHERE id = ?').run(Number(id));
}

function createOrder(orderData) {
    db.prepare(`
        INSERT INTO orders (
            orderId, customerName, whatsappNumber, whatsappDigits, shippingAddress, city,
            nearestLandmark, orderNotes, itemsJson, subtotal, discountTotal,
            codDeliveryCharges, grandTotal, paymentMethod, orderStatus, whatsappMessageId, whatsappDispatchMode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        orderData.orderId,
        orderData.customerName,
        orderData.whatsappNumber,
        orderData.whatsappDigits,
        orderData.shippingAddress,
        orderData.city,
        orderData.nearestLandmark || '',
        orderData.orderNotes || '',
        JSON.stringify(orderData.items || []),
        orderData.subtotal,
        orderData.discountTotal || 0,
        orderData.codDeliveryCharges || 0,
        orderData.grandTotal,
        orderData.paymentMethod || 'Cash on Delivery (COD)',
        orderData.orderStatus || 'Pending WhatsApp Confirmation',
        orderData.whatsappMessageId || '',
        orderData.whatsappDispatchMode || 'baileys'
    );

    // Increment soldCount and decrement stock safely
    const updateStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?), soldCount = soldCount + ? WHERE id = ?');
    for (const item of orderData.items || []) {
        if (item.productId > 0) {
            updateStock.run(item.quantity || 1, item.quantity || 1, item.productId);
        }
    }

    return getOrderById(orderData.orderId);
}

function getOrderById(orderId) {
    const { clean, isShortDigits } = normalizeOrderLookupInput(orderId);
    if (!clean) return null;
    const exactRow = db.prepare('SELECT * FROM orders WHERE UPPER(orderId) = UPPER(?)').get(clean);
    if (exactRow) return parseOrderRow(exactRow);
    if (isShortDigits) {
        const suffixRow = db.prepare(`
            SELECT * FROM orders
            WHERE UPPER(orderId) LIKE ?
            ORDER BY id DESC LIMIT 1
        `).get(`%-${clean}`);
        if (suffixRow) return parseOrderRow(suffixRow);
    }
    return null;
}

function getLatestPendingOrderByDigits(digits) {
    const clean = String(digits || '').replace(/\D/g, '');
    if (!clean) return null;
    const row = db.prepare(`
        SELECT * FROM orders
        WHERE whatsappDigits = ? AND orderStatus = 'Pending WhatsApp Confirmation'
        ORDER BY id DESC LIMIT 1
    `).get(clean);
    return parseOrderRow(row);
}

function getOrders(limit = 100) {
    return db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit).map(parseOrderRow);
}

function updateOrderStatus(orderId, status, extra = {}) {
    const existing = getOrderById(orderId);
    if (!existing) return null;

    const confirmedAt = status === 'Confirmed' ? new Date().toISOString() : existing.whatsappConfirmedAt;
    const msgId = extra.whatsappMessageId !== undefined ? extra.whatsappMessageId : existing.whatsappMessageId;
    const dispatchMode = extra.whatsappDispatchMode !== undefined ? extra.whatsappDispatchMode : existing.whatsappDispatchMode;

    db.prepare(`
        UPDATE orders
        SET orderStatus = ?, whatsappConfirmedAt = ?, whatsappMessageId = ?, whatsappDispatchMode = ?, updatedAt = datetime('now')
        WHERE orderId = ?
    `).run(status, confirmedAt || '', msgId || '', dispatchMode || 'baileys', existing.orderId);

    return getOrderById(existing.orderId);
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

function getInquiries(limit = 50) {
    return db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT ?').all(limit);
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
    return db.prepare('SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT ?').all(limit).map((r) => {
        let payload = {};
        try { payload = JSON.parse(r.payloadJson || '{}'); } catch (_) {}
        return { ...r, payload };
    });
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
    if (!clean) return;
    db.prepare('DELETE FROM sessions WHERE phone_number = ?').run(clean);
}

function clearAllWhatsAppSessionRows() {
    db.prepare('DELETE FROM sessions').run();
}

function getStatsSummary() {
    const totalProducts = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    const confirmedOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus IN ('Confirmed','Dispatched','Shipped','Delivered')").get().count;
    const confirmedOnlyOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus = 'Confirmed'").get().count;
    const dispatchedOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus IN ('Dispatched','Shipped')").get().count;
    const deliveredOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus = 'Delivered'").get().count;
    const cancelledOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus = 'Cancelled'").get().count;
    const pendingOrders = db.prepare("SELECT COUNT(*) AS count FROM orders WHERE orderStatus = 'Pending WhatsApp Confirmation'").get().count;
    const revenueRow = db.prepare("SELECT COALESCE(SUM(grandTotal), 0) AS total FROM orders WHERE orderStatus != 'Cancelled'").get();
    const totalInquiries = db.prepare('SELECT COUNT(*) AS count FROM inquiries').get().count;
    return {
        totalProducts,
        totalOrders,
        confirmedOrders,
        confirmedOnlyOrders,
        dispatchedOrders,
        deliveredOrders,
        cancelledOrders,
        pendingOrders,
        totalRevenue: revenueRow?.total || 0,
        totalInquiries
    };
}

function getAnalyticsReport(filters = {}) {
    const orders = getOrders(500);
    const products = getProducts({ sort: 'newest' });
    const categories = getCategories();
    return computeStoreAnalytics({
        orders,
        products,
        categories,
        filterCategory: filters.category || 'all',
        filterStatus: filters.status || 'all'
    });
}

function getAdminCredentials() {
    const { map } = getAllVariables();
    return {
        username: String(process.env.Admin_Username || process.env.ADMIN_USERNAME || map.Admin_Username || 'admin').trim(),
        password: String(process.env.Admin_Password || process.env.ADMIN_PASSWORD || map.Admin_Password || 'AlMumtaz@2026')
    };
}

function createAdminSession(username, token, ttlHours = 72) {
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    db.prepare(`
        INSERT INTO admin_sessions (token, username, expiresAt)
        VALUES (?, ?, ?)
    `).run(token, username, expiresAt);
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

function revokeAdminSession(token) {
    if (!token) return;
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(String(token));
}

function deleteOrder(orderId) {
    return db.prepare('DELETE FROM orders WHERE UPPER(orderId) = UPPER(?)').run(String(orderId || '').trim());
}

function saveMediaImage(id, filename, contentType, size, buffer, storage = 'sqlite', remoteUrl = '') {
    db.prepare(`
        INSERT INTO media_images (id, filename, contentType, size, data, storage, remoteUrl)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, filename, contentType, size, buffer, storage, remoteUrl || '');
}

function getMediaImage(id) {
    return db.prepare('SELECT id, filename, contentType, size, data, storage, remoteUrl, createdAt FROM media_images WHERE id = ?').get(id);
}

function listMediaImages(limit = 50) {
    return db.prepare('SELECT id, filename, contentType, size, storage, remoteUrl, createdAt FROM media_images ORDER BY createdAt DESC LIMIT ?').all(limit);
}

function deleteMediaImage(id) {
    return db.prepare('DELETE FROM media_images WHERE id = ?').run(id);
}

function countMediaImages() {
    return db.prepare('SELECT COUNT(*) AS count FROM media_images').get().count;
}

function upsertWaAuthBackup(sessionId, { credsJson = '', keysJson = '', sessionToken = '' } = {}) {
    const id = String(sessionId || '').trim();
    if (!id) return null;
    const existing = db.prepare('SELECT credsJson, keysJson, sessionToken FROM wa_auth_backups WHERE sessionId = ?').get(id);
    const nextCreds = String(credsJson || existing?.credsJson || '');
    if (!nextCreds) return null;
    let mergedKeysJson = existing?.keysJson || '{}';
    if (keysJson && typeof keysJson === 'string') {
        try {
            const prevObj = JSON.parse(mergedKeysJson || '{}');
            const incomingObj = JSON.parse(keysJson || '{}');
            mergedKeysJson = JSON.stringify({ ...prevObj, ...incomingObj });
        } catch (_) {
            mergedKeysJson = keysJson;
        }
    } else if (keysJson && typeof keysJson === 'object') {
        try {
            const prevObj = JSON.parse(mergedKeysJson || '{}');
            mergedKeysJson = JSON.stringify({ ...prevObj, ...keysJson });
        } catch (_) {
            mergedKeysJson = JSON.stringify(keysJson);
        }
    }
    const nextToken = String(sessionToken || existing?.sessionToken || '');
    db.prepare(`
        INSERT INTO wa_auth_backups (sessionId, credsJson, keysJson, sessionToken, updatedAt)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(sessionId) DO UPDATE SET
            credsJson = excluded.credsJson,
            keysJson = excluded.keysJson,
            sessionToken = COALESCE(NULLIF(excluded.sessionToken, ''), wa_auth_backups.sessionToken),
            updatedAt = datetime('now')
    `).run(id, nextCreds, mergedKeysJson, nextToken);
    return getWaAuthBackup(id);
}

function getWaAuthBackup(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return null;
    return db.prepare('SELECT sessionId, credsJson, keysJson, sessionToken, updatedAt FROM wa_auth_backups WHERE sessionId = ?').get(id) || null;
}

function listWaAuthBackupIds() {
    return db.prepare('SELECT sessionId FROM wa_auth_backups ORDER BY updatedAt DESC').all().map((r) => String(r.sessionId));
}

function deleteWaAuthBackup(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return;
    db.prepare('DELETE FROM wa_auth_backups WHERE sessionId = ?').run(id);
}

function clearAllWaAuthBackups() {
    db.prepare('DELETE FROM wa_auth_backups').run();
}

module.exports = {
    db,
    getAllVariables,
    setVariable,
    getCategories,
    createCategory,
    deleteCategory,
    getProducts,
    getProductBySlugOrId,
    createProduct,
    updateProduct,
    deleteProduct,
    createOrder,
    getOrderById,
    getLatestPendingOrderByDigits,
    getOrders,
    updateOrderStatus,
    deleteOrder,
    recordInquiry,
    getInquiries,
    logWhatsAppEvent,
    getWhatsAppLogs,
    upsertWhatsAppSession,
    deleteWhatsAppSessionRow,
    clearAllWhatsAppSessionRows,
    getStatsSummary,
    getAnalyticsReport,
    getAdminCredentials,
    createAdminSession,
    validateAdminSession,
    revokeAdminSession,
    saveMediaImage,
    getMediaImage,
    listMediaImages,
    deleteMediaImage,
    countMediaImages,
    upsertWaAuthBackup,
    getWaAuthBackup,
    listWaAuthBackupIds,
    deleteWaAuthBackup,
    clearAllWaAuthBackups
};
