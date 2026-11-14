'use strict';

/**
 * Al-Mumtaz Electronics — Hasilpur
 * Full-Stack E-Commerce Marketplace, Cloudinary Image Store,
 * 24/7 Railway WhatsApp Bridge & Automated COD Order Server
 */

const express = require('express');
const path = require('path');
const axios = require('axios');
const cookie = require('cookie');
const multer = require('multer');
const dotenv = require('dotenv');
dotenv.config();

const database = require('./lib/database');
const mediaStore = require('./lib/mediaStore');
const { getVolumeDiagnostics } = require('./lib/storagePaths');
const {
    ALLOWED_ORDER_STATUSES,
    normalizePakistanWhatsApp,
    calculateOrderTotals,
    resolveProductVariantPrice,
    generateOrderId,
    verifyAdminCredentials,
    generateAdminToken,
    normalizeRailwayUrl
} = require('./lib/storeLogic');
const whatsappService = require('./lib/whatsappService');
const sessionManager = require('./lib/sessionManager');

const app = express();
const PORT = process.env.NGINX_PORT
    ? (Number(process.env.DEFAULT_APP_PORT) || 3000)
    : (Number(process.env.PORT) || 3000);
const HOST = '0.0.0.0';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        if (String(file.mimetype || '').startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPG, PNG, WEBP, GIF) are allowed.'));
        }
    }
});

app.use((req, res, next) => {
    const allowedOrigin = process.env.CORS_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-username, x-admin-password');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html' || req.path.startsWith('/admin')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
    next();
});

// Dedicated /admin entry point (Protected by Admin_Username & Admin_Password)
app.get(['/admin', '/admin/', '/admin.html'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

// ── ADMIN & BRIDGE AUTH MIDDLEWARE ───────────────────────────────────────────
function extractAdminToken(req) {
    const authHeader = req.headers.authorization || '';
    if (/^Bearer\s+/i.test(authHeader)) {
        return authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    if (req.headers.cookie) {
        const parsed = cookie.parse(req.headers.cookie);
        if (parsed.almumtaz_admin_token) {
            return String(parsed.almumtaz_admin_token).trim();
        }
    }
    return '';
}

function requireAdminAuth(req, res, next) {
    const token = extractAdminToken(req);
    const session = database.validateAdminSession(token);
    if (session) {
        req.adminUser = session;
        return next();
    }

    const headerUser = req.headers['x-admin-username'];
    const headerPass = req.headers['x-admin-password'];
    if (headerUser && headerPass) {
        const expected = database.getAdminCredentials();
        if (verifyAdminCredentials(headerUser, headerPass, expected.username, expected.password)) {
            req.adminUser = { username: expected.username };
            return next();
        }
    }

    return res.status(401).json({ error: 'Admin authentication required. Please sign in at /admin.' });
}

// ── RAILWAY BACKEND BRIDGE HELPER ────────────────────────────────────────────
function getRailwayBridgeConfig() {
    const { config } = database.getAllVariables();
    const creds = database.getAdminCredentials();
    return {
        railwayUrl: config.railwayUrl || '',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-username': creds.username,
            'x-admin-password': creds.password
        }
    };
}

async function fetchRailwayWhatsAppStatus() {
    const { railwayUrl, headers } = getRailwayBridgeConfig();
    if (!railwayUrl) return null;
    try {
        const res = await axios.get(`${railwayUrl}/api/whatsapp/status`, { headers, timeout: 6000 });
        return {
            railwayUrl,
            railwayReachable: true,
            connectedSessions: res.data?.connectedSessions || [],
            allSessions: res.data?.allSessions || []
        };
    } catch (err) {
        return {
            railwayUrl,
            railwayReachable: false,
            error: err.message,
            connectedSessions: [],
            allSessions: []
        };
    }
}

// ── HEALTH, KEEPALIVE HEARTBEAT & PUBLIC IMAGE SERVING ───────────────────────
app.get(['/health', '/api/health'], (req, res) => {
    const { config } = database.getAllVariables();
    res.json({
        status: 'ok',
        store: config.storeName,
        city: config.storeCity,
        uptime: Math.floor(process.uptime()),
        railwayConfigured: Boolean(config.railwayUrl),
        whatsappConnectedSessions: sessionManager.getConnectedSessions().length
    });
});

app.get('/api/keepalive', async (req, res) => {
    const { config } = database.getAllVariables();
    if (config.railwayUrl) {
        axios.get(`${config.railwayUrl}/api/health`, { timeout: 4000 }).catch(() => {});
    }
    res.json({ ok: true, ts: Date.now() });
});

app.get('/api/images/:id', async (req, res) => {
    try {
        const img = await mediaStore.getImageById(req.params.id);
        if (!img) {
            return res.status(404).json({ error: 'Image not found.' });
        }
        if (img.storage === 'cloudinary' && img.remoteUrl) {
            return res.redirect(302, img.remoteUrl);
        }
        if (!img.data) {
            return res.status(404).json({ error: 'Image binary missing.' });
        }
        res.setHeader('Content-Type', img.contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(img.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── PUBLIC STOREFRONT ENDPOINTS ──────────────────────────────────────────────
app.get('/api/store/bootstrap', (req, res) => {
    const { config } = database.getAllVariables();
    const categories = database.getCategories();
    const products = database.getProducts({ sort: 'newest' });
    const featured = products.filter((p) => p.isFeatured);
    const flashDeals = products.filter((p) => p.isFlashSale || p.discountPercentage > 0)
        .sort((a, b) => b.discountPercentage - a.discountPercentage);

    res.json({
        store: {
            name: config.storeName,
            city: config.storeCity,
            address: config.storeAddress,
            phone: config.storePhone,
            codFlatRate: config.codFlatRate,
            expressCodRate: config.expressCodRate,
            freeDeliveryThreshold: config.freeDeliveryThreshold,
            cityRates: config.cityRates
        },
        categories,
        products,
        featured,
        flashDeals
    });
});

app.get('/api/categories', (req, res) => {
    res.json({ categories: database.getCategories() });
});

app.get('/api/products', (req, res) => {
    const products = database.getProducts({
        category: req.query.category,
        featured: req.query.featured,
        flashSale: req.query.flashSale || req.query.offered,
        inStock: req.query.inStock,
        tag: req.query.tag,
        minPrice: req.query.minPrice,
        maxPrice: req.query.maxPrice,
        minDiscount: req.query.minDiscount,
        minRating: req.query.minRating,
        search: req.query.search,
        sort: req.query.sort
    });
    res.json({ products });
});

app.get('/api/products/:slug', (req, res) => {
    const product = database.getProductBySlugOrId(req.params.slug);
    if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
    }
    res.json({ product });
});

app.post('/api/orders/estimate', (req, res) => {
    try {
        const { items = [], city = 'Hasilpur', deliverySpeed = 'standard' } = req.body || {};
        const { config } = database.getAllVariables();
        const hydratedItems = items.map((item) => {
            const dbProd = item.productId ? database.getProductBySlugOrId(item.productId) : null;
            const resolved = dbProd ? resolveProductVariantPrice(dbProd, item.variant) : null;
            return {
                productId: dbProd ? dbProd.id : Number(item.productId) || 0,
                title: dbProd ? dbProd.title : item.title,
                sku: dbProd ? dbProd.sku : item.sku,
                variant: resolved ? resolved.variant : (item.variant || ''),
                quantity: item.quantity || 1,
                originalPrice: resolved ? resolved.originalPrice : item.originalPrice,
                discountPrice: resolved ? resolved.discountPrice : item.discountPrice,
                image: dbProd ? dbProd.images[0] : item.image
            };
        });
        const totals = calculateOrderTotals(hydratedItems, config, city, deliverySpeed);
        res.json({ success: true, ...totals });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ── AUTOMATED CASH ON DELIVERY (COD) CHECKOUT + WHATSAPP CONFIRMATION ────────
app.post('/api/orders/checkout', async (req, res) => {
    try {
        const {
            customerName,
            whatsappNumber,
            shippingAddress,
            city,
            nearestLandmark = '',
            orderNotes = '',
            deliverySpeed = 'standard',
            items = []
        } = req.body || {};

        if (!customerName || String(customerName).trim().length < 2) {
            return res.status(400).json({ error: 'Please enter your full name.' });
        }
        if (!shippingAddress || String(shippingAddress).trim().length < 5) {
            return res.status(400).json({ error: 'Please enter your complete shipping address.' });
        }
        if (!city || String(city).trim().length < 2) {
            return res.status(400).json({ error: 'Please enter or select your city.' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Your cart is empty.' });
        }

        const phoneCheck = normalizePakistanWhatsApp(whatsappNumber);
        if (!phoneCheck.valid) {
            return res.status(400).json({ error: phoneCheck.error });
        }

        const hydratedItems = items.map((item) => {
            const dbProd = item.productId ? database.getProductBySlugOrId(item.productId) : null;
            if (!dbProd) {
                throw new Error(`Product "${item.title || item.productId}" is no longer available.`);
            }
            const resolved = resolveProductVariantPrice(dbProd, item.variant);
            const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
            const availableStock = resolved.stock > 0 ? resolved.stock : dbProd.stock;
            if (availableStock > 0 && qty > availableStock) {
                throw new Error(`Only ${availableStock} unit(s) left in stock for ${dbProd.title}${resolved.variant ? ` (${resolved.variant})` : ''}.`);
            }
            return {
                productId: dbProd.id,
                title: dbProd.title,
                sku: dbProd.sku,
                variant: resolved.variant || dbProd.variants?.[0] || '',
                quantity: qty,
                originalPrice: resolved.originalPrice,
                discountPrice: resolved.discountPrice,
                image: dbProd.images[0] || ''
            };
        });

        const { config } = database.getAllVariables();
        const totals = calculateOrderTotals(hydratedItems, config, city, deliverySpeed);

        let orderId = generateOrderId();
        while (database.getOrderById(orderId)) {
            orderId = generateOrderId(new Date(), Math.floor(1000 + Math.random() * 9000));
        }

        const order = database.createOrder({
            orderId,
            customerName: String(customerName).trim(),
            whatsappNumber: phoneCheck.e164,
            whatsappDigits: phoneCheck.digits,
            shippingAddress: String(shippingAddress).trim(),
            city: String(city).trim(),
            nearestLandmark: String(nearestLandmark).trim(),
            orderNotes: String(orderNotes).trim(),
            items: totals.items,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            codDeliveryCharges: totals.codDeliveryCharges,
            grandTotal: totals.grandTotal,
            paymentMethod: 'Cash on Delivery (COD)',
            orderStatus: 'Pending WhatsApp Confirmation',
            whatsappDispatchMode: config.railwayUrl ? 'railway_baileys' : 'baileys'
        });

        const whatsappDispatch = await whatsappService.sendOrderConfirmationPrompt(order);

        res.status(201).json({
            success: true,
            order: database.getOrderById(order.orderId),
            whatsapp: {
                delivered: whatsappDispatch.delivered,
                mode: whatsappDispatch.mode,
                receiptText: whatsappDispatch.receiptText,
                buttons: whatsappDispatch.buttons
            }
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/orders/track/:orderId', (req, res) => {
    const order = database.getOrderById(req.params.orderId);
    if (!order) {
        return res.status(404).json({ error: 'Order not found. Please enter your Order ID (e.g. ORD-2026-9336 or 9336).' });
    }
    res.json({ order });
});

// ── WHATSAPP INTERACTIVE REPLY WEBHOOK & RAILWAY SYNC ────────────────────────
app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
        const body = req.body || {};
        const fromRaw = body.from || body.whatsappNumber || '';
        const textOrBtn = body.buttonId || body.text || body.message || '';
        if (!textOrBtn) {
            return res.status(400).json({ error: 'Webhook payload missing buttonId or text.' });
        }

        const phoneCheck = normalizePakistanWhatsApp(fromRaw);
        const senderJid = phoneCheck.valid
            ? phoneCheck.jid
            : (String(fromRaw).includes('@') ? String(fromRaw) : '923000000000@s.whatsapp.net');

        const outcome = await whatsappService.processIncomingMessage({
            senderJid,
            senderName: body.senderName || 'Customer',
            rawText: String(textOrBtn)
        });

        res.json({ success: true, outcome });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bridge/inquiry', requireAdminAuth, (req, res) => {
    try {
        const { senderJid, senderNumber, senderName, description, adminNumber } = req.body || {};
        if (!senderNumber || !description) {
            return res.status(400).json({ error: 'senderNumber and description are required.' });
        }
        const saved = database.recordInquiry({
            senderJid: senderJid || `${senderNumber}@s.whatsapp.net`,
            senderNumber,
            senderName: senderName || 'WhatsApp Customer',
            description,
            forwardedToAdmin: true,
            adminNumber: adminNumber || database.getAllVariables().config.adminWhatsappNumber
        });
        res.status(201).json({ success: true, inquiry: saved });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ── ADMIN AUTHENTICATION ENDPOINTS ───────────────────────────────────────────
app.get('/api/admin/session', (req, res) => {
    const token = extractAdminToken(req);
    const session = database.validateAdminSession(token);
    if (!session) {
        return res.json({ authenticated: false, username: null });
    }
    res.json({ authenticated: true, username: session.username, expiresAt: session.expiresAt });
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const expected = database.getAdminCredentials();

    if (!verifyAdminCredentials(username, password, expected.username, expected.password)) {
        return res.status(401).json({ error: 'Invalid Admin_Username or Admin_Password.' });
    }

    const token = generateAdminToken();
    const session = database.createAdminSession(expected.username, token);

    res.setHeader('Set-Cookie', cookie.serialize('almumtaz_admin_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 72 * 3600
    }));

    res.json({
        success: true,
        token: session.token,
        username: session.username,
        expiresAt: session.expiresAt
    });
});

app.post('/api/admin/logout', (req, res) => {
    const token = extractAdminToken(req);
    if (token) database.revokeAdminSession(token);
    res.setHeader('Set-Cookie', cookie.serialize('almumtaz_admin_token', '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    }));
    res.json({ success: true });
});

// ── PROTECTED ADMIN PANEL APIs ───────────────────────────────────────────────
app.get('/api/admin/overview', requireAdminAuth, async (req, res) => {
    const vars = database.getAllVariables();
    const mediaDiag = await mediaStore.getMediaDiagnostics();
    const uploadedImages = await mediaStore.listImages(50);
    const remoteWa = await fetchRailwayWhatsAppStatus();

    const whatsappStatus = remoteWa
        ? {
            source: 'railway',
            railwayUrl: remoteWa.railwayUrl,
            railwayReachable: remoteWa.railwayReachable,
            railwayError: remoteWa.error || null,
            connectedSessions: remoteWa.connectedSessions,
            allSessions: remoteWa.allSessions
        }
        : {
            source: 'local',
            railwayUrl: '',
            railwayReachable: false,
            connectedSessions: sessionManager.getConnectedSessions(),
            allSessions: sessionManager.getActiveSessions()
        };

    res.json({
        adminUser: req.adminUser.username,
        stats: database.getStatsSummary(),
        analytics: database.getAnalyticsReport(),
        products: database.getProducts({ sort: 'newest' }),
        categories: database.getCategories(),
        orders: database.getOrders(200),
        variables: vars.raw,
        config: vars.config,
        inquiries: database.getInquiries(50),
        whatsappLogs: database.getWhatsAppLogs(60),
        mediaDiagnostics: mediaDiag,
        uploadedImages,
        whatsappStatus
    });
});

app.get('/api/admin/analytics', requireAdminAuth, (req, res) => {
    res.json({
        analytics: database.getAnalyticsReport({
            category: req.query.category || 'all',
            status: req.query.status || 'all'
        })
    });
});

app.post('/api/admin/images/upload', requireAdminAuth, (req, res) => {
    upload.array('images', 10)(req, res, async (multerErr) => {
        if (multerErr) {
            return res.status(400).json({ error: multerErr.message });
        }
        try {
            const images = await mediaStore.saveUploadedImages(req.files || []);
            const diagnostics = await mediaStore.getMediaDiagnostics();
            res.status(201).json({ success: true, images, diagnostics });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
});

app.get('/api/admin/images', requireAdminAuth, async (req, res) => {
    const images = await mediaStore.listImages(100);
    const diagnostics = await mediaStore.getMediaDiagnostics();
    res.json({ images, diagnostics });
});

app.delete('/api/admin/images/:id', requireAdminAuth, async (req, res) => {
    await mediaStore.deleteImageById(req.params.id);
    res.json({ success: true });
});

app.post('/api/admin/products', requireAdminAuth, (req, res) => {
    try {
        const product = database.createProduct(req.body || {});
        res.status(201).json({ success: true, product });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.put('/api/admin/products/:id', requireAdminAuth, (req, res) => {
    try {
        const product = database.updateProduct(req.params.id, req.body || {});
        res.json({ success: true, product });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/products/:id', requireAdminAuth, (req, res) => {
    try {
        database.deleteProduct(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/admin/categories', requireAdminAuth, (req, res) => {
    try {
        const category = database.createCategory(req.body || {});
        res.status(201).json({ success: true, category });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/categories/:id', requireAdminAuth, (req, res) => {
    try {
        database.deleteCategory(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.patch('/api/admin/orders/:orderId/status', requireAdminAuth, (req, res) => {
    try {
        const { status } = req.body || {};
        if (!ALLOWED_ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid order status.' });
        }
        const order = database.updateOrderStatus(req.params.orderId, status);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        res.json({ success: true, order });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/admin/orders/:orderId', requireAdminAuth, (req, res) => {
    try {
        database.deleteOrder(req.params.orderId);
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/admin/orders/:orderId/resend-whatsapp', requireAdminAuth, async (req, res) => {
    try {
        const order = database.getOrderById(req.params.orderId);
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        const dispatch = await whatsappService.sendOrderConfirmationPrompt(order);
        res.json({ success: true, dispatch });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/variables', requireAdminAuth, (req, res) => {
    res.json(database.getAllVariables());
});

app.post('/api/admin/variables', requireAdminAuth, async (req, res) => {
    try {
        const { variables } = req.body || {};
        const applyVar = (k, v) => {
            const val = k === 'Railway_URL' ? normalizeRailwayUrl(v) : String(v ?? '');
            database.setVariable(k, val);
            if (k === 'Admin_Username' && val.trim()) {
                process.env.Admin_Username = val.trim();
            } else if (k === 'Admin_Password' && val) {
                process.env.Admin_Password = val;
            } else if (k === 'Admin_Whatsapp' && val.trim()) {
                process.env.Admin_Whatsapp = val.trim();
            } else if (k === 'Cloudinary_URI') {
                process.env.Cloudinary_URI = val.trim();
            } else if (k === 'Railway_URL') {
                process.env.Railway_URL = val.trim();
            }
        };

        if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
            for (const [k, v] of Object.entries(variables)) {
                applyVar(k, v);
            }
        } else if (req.body?.key) {
            applyVar(req.body.key, req.body.value ?? '');
        } else {
            return res.status(400).json({ error: 'Provide variables map or key/value pair.' });
        }

        const mediaDiagnostics = await mediaStore.getMediaDiagnostics();
        res.json({ success: true, ...database.getAllVariables(), mediaDiagnostics });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/admin/railway/test', requireAdminAuth, async (req, res) => {
    const candidate = normalizeRailwayUrl(req.body?.railwayUrl || database.getAllVariables().config.railwayUrl);
    if (!candidate) {
        return res.status(400).json({ error: 'Enter a valid Railway_URL (e.g. https://your-bot.up.railway.app).' });
    }
    try {
        const health = await axios.get(`${candidate}/api/health`, { timeout: 6000 });
        res.json({
            success: true,
            railwayUrl: candidate,
            health: health.data
        });
    } catch (err) {
        res.status(502).json({
            error: `Could not reach Railway backend at ${candidate}: ${err.message}`
        });
    }
});

app.get('/api/admin/inquiries', requireAdminAuth, (req, res) => {
    res.json({ inquiries: database.getInquiries(100) });
});

app.get('/api/admin/whatsapp-logs', requireAdminAuth, (req, res) => {
    res.json({ logs: database.getWhatsAppLogs(100) });
});

// ── PROTECTED WHATSAPP LINKING, PAIRING & BOT SIMULATION ─────────────────────
app.get('/api/whatsapp/status', requireAdminAuth, async (req, res) => {
    const { config } = database.getAllVariables();
    const remoteWa = await fetchRailwayWhatsAppStatus();

    if (remoteWa) {
        return res.json({
            source: 'railway',
            railwayUrl: remoteWa.railwayUrl,
            railwayReachable: remoteWa.railwayReachable,
            railwayError: remoteWa.error || null,
            adminWhatsappNumber: config.adminWhatsappNumber,
            connectedSessions: remoteWa.connectedSessions,
            allSessions: remoteWa.allSessions
        });
    }

    res.json({
        source: 'local',
        railwayUrl: '',
        railwayReachable: false,
        adminWhatsappNumber: config.adminWhatsappNumber,
        connectedSessions: sessionManager.getConnectedSessions(),
        allSessions: sessionManager.getActiveSessions(),
        diagnostics: getVolumeDiagnostics()
    });
});

app.post('/api/pair', requireAdminAuth, async (req, res) => {
    try {
        const { phoneNumber } = req.body || {};
        const { railwayUrl, headers } = getRailwayBridgeConfig();

        if (railwayUrl) {
            const bridge = await axios.post(`${railwayUrl}/api/pair`, { phoneNumber }, { headers, timeout: 30000 });
            return res.json(bridge.data);
        }

        const result = await sessionManager.generatePairingCode(phoneNumber);
        if (result && typeof result === 'object' && result.alreadyConnected) {
            return res.json({ success: true, alreadyConnected: true, message: result.message });
        }
        res.json({ success: true, code: result });
    } catch (err) {
        res.status(400).json({ error: err.response?.data?.error || err.message });
    }
});

app.delete('/api/whatsapp/session/:number', requireAdminAuth, async (req, res) => {
    try {
        const { railwayUrl, headers } = getRailwayBridgeConfig();
        if (railwayUrl) {
            const bridge = await axios.delete(
                `${railwayUrl}/api/whatsapp/session/${encodeURIComponent(req.params.number)}`,
                { headers, timeout: 15000 }
            );
            return res.json(bridge.data);
        }
        const result = await sessionManager.deleteSessionByNumber(req.params.number);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.response?.data?.error || err.message });
    }
});

app.post('/api/whatsapp/sessions/clear', requireAdminAuth, async (req, res) => {
    try {
        const { railwayUrl, headers } = getRailwayBridgeConfig();
        if (railwayUrl) {
            const bridge = await axios.post(`${railwayUrl}/api/whatsapp/sessions/clear`, {}, { headers, timeout: 15000 });
            return res.json(bridge.data);
        }
        const result = await sessionManager.clearAllSessions();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.response?.data?.error || err.message });
    }
});

app.post('/api/whatsapp/simulate-message', requireAdminAuth, async (req, res) => {
    try {
        const { from = '03001234567', senderName = 'Walk-in Customer', text = 'Hi' } = req.body || {};
        const phoneCheck = normalizePakistanWhatsApp(from);
        const senderJid = phoneCheck.valid ? phoneCheck.jid : '923001234567@s.whatsapp.net';

        const outcome = await whatsappService.processIncomingMessage({
            senderJid,
            senderName,
            rawText: String(text || 'Hi')
        });

        const logs = database.getWhatsAppLogs(8);
        res.json({ success: true, outcome, latestLogs: logs });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Storefront SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
    console.log(`[server] Al-Mumtaz Electronics running on http://${HOST}:${PORT}`);
    setTimeout(() => {
        sessionManager.rehydrateSessions().catch((err) => {
            console.warn('[whatsapp] Session rehydration notice:', err.message);
        });
    }, 1000);

    // Silent background auto-ping heartbeat (every 20s) to keep local server + Railway_URL bot active non-stop
    setInterval(() => {
        axios.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: 4000 }).catch(() => {});
        const { config } = database.getAllVariables();
        if (config.railwayUrl) {
            axios.get(`${config.railwayUrl}/api/health`, { timeout: 4000 }).catch(() => {});
        }
    }, 20000);
});
