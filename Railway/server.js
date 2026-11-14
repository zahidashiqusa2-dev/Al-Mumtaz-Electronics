'use strict';

/**
 * Al-Mumtaz Electronics — Hasilpur
 * Standalone 24/7 Railway WhatsApp COD & Store Bot Server
 */

process.env.IS_RAILWAY_BACKEND = 'true';

const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config({ override: true });

const database = require('./lib/database');
const { getVolumeDiagnostics } = require('./lib/storagePaths');
const { normalizePakistanWhatsApp, verifyAdminCredentials } = require('./lib/storeLogic');
const whatsappService = require('./lib/whatsappService');
const sessionManager = require('./lib/sessionManager');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.use((req, res, next) => {
    const allowedOrigin = process.env.CORS_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-username, x-admin-password, x-api-secret');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

function requireBridgeAuth(req, res, next) {
    const { config } = database.getAllVariables();
    const expectedSecret = String(config.apiSecretKey || '').trim();
    const headerSecret = String(req.headers['x-api-secret'] || '').trim();
    const authHeader = req.headers.authorization || '';
    const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

    if (expectedSecret && (bearer === expectedSecret || headerSecret === expectedSecret)) {
        return next();
    }

    const expected = database.getAdminCredentials();
    const headerUser = req.headers['x-admin-username'];
    const headerPass = req.headers['x-admin-password'];

    if (headerUser && headerPass && verifyAdminCredentials(headerUser, headerPass, expected.username, expected.password)) {
        return next();
    }

    if (bearer && database.validateAdminSession(bearer)) {
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized Railway bridge request. Check Admin_Username, Admin_Password, or API_SECRET_KEY.' });
}

app.get(['/', '/health', '/api/health'], (req, res) => {
    const { config } = database.getAllVariables();
    res.json({
        status: 'ok',
        service: 'almumtaz-railway-whatsapp-bot',
        store: config.storeName,
        city: config.storeCity,
        uptime: Math.floor(process.uptime()),
        connectedSessions: sessionManager.getConnectedSessions().length,
        activeSessions: sessionManager.getActiveSessions().length
    });
});

app.get('/api/keepalive', (req, res) => {
    const { config } = database.getAllVariables();
    if (config.mainSiteUrl) {
        axios.get(`${config.mainSiteUrl}/api/keepalive`, { timeout: 4000 }).catch(() => {});
    }
    res.json({ ok: true, ts: Date.now() });
});

app.get('/api/whatsapp/status', requireBridgeAuth, (req, res) => {
    const { config } = database.getAllVariables();
    res.json({
        source: 'railway',
        adminWhatsappNumber: config.adminWhatsappNumber,
        mainSiteUrl: config.mainSiteUrl,
        connectedSessions: sessionManager.getConnectedSessions(),
        allSessions: sessionManager.getActiveSessions(),
        diagnostics: getVolumeDiagnostics()
    });
});

app.post('/api/pair', requireBridgeAuth, async (req, res) => {
    try {
        const { phoneNumber } = req.body || {};
        const result = await sessionManager.generatePairingCode(phoneNumber);
        if (result && typeof result === 'object' && result.alreadyConnected) {
            return res.json({ success: true, alreadyConnected: true, message: result.message });
        }
        res.json({ success: true, code: result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/whatsapp/session/:number', requireBridgeAuth, async (req, res) => {
    try {
        const result = await sessionManager.deleteSessionByNumber(req.params.number);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/whatsapp/sessions/clear', requireBridgeAuth, async (req, res) => {
    try {
        const result = await sessionManager.clearAllSessions();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bridge/send', requireBridgeAuth, async (req, res) => {
    try {
        const { recipient, title = '', text, buttons = [], lists = [], footer = '', imageUrl = '', messageType = 'text' } = req.body || {};
        if (!recipient || !text) {
            return res.status(400).json({ error: 'recipient and text are required.' });
        }
        const dispatch = await whatsappService.dispatchMessage(recipient, {
            title,
            text,
            buttons,
            lists,
            footer,
            imageUrl,
            messageType
        });
        res.json(dispatch);
    } catch (err) {
        res.status(500).json({ delivered: false, error: err.message });
    }
});

app.post('/webhook/new-website-order', requireBridgeAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const order = body.order || body;
        if (!order || (!order.orderId && !order.whatsappDigits && !order.customerPhone)) {
            return res.status(400).json({ error: 'Invalid order webhook payload.' });
        }
        const dispatch = await whatsappService.sendOrderConfirmationPrompt(order);
        res.json({ success: true, orderId: order.orderId || '', dispatch });
    } catch (err) {
        res.status(500).json({ delivered: false, error: err.message });
    }
});

app.post('/api/whatsapp/simulate-message', requireBridgeAuth, async (req, res) => {
    try {
        const { from = '03001234567', senderName = 'Walk-in Customer', text = 'Hi' } = req.body || {};
        const phoneCheck = normalizePakistanWhatsApp(from);
        const senderJid = phoneCheck.valid ? phoneCheck.jid : '923001234567@s.whatsapp.net';

        const outcome = await whatsappService.processIncomingMessage({
            senderJid,
            senderName,
            rawText: String(text || 'Hi')
        });

        res.json({
            success: true,
            outcome,
            latestLogs: database.getWhatsAppLogs(8)
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.listen(PORT, HOST, () => {
    console.log(`[railway-bot] Al-Mumtaz Electronics 24/7 WhatsApp Bot listening on http://${HOST}:${PORT}`);
    setTimeout(() => {
        sessionManager.rehydrateSessions().catch((err) => {
            console.warn('[railway-bot] Session rehydration notice:', err.message);
        });
    }, 1000);

    // Silent background auto-ping heartbeat (every 20s) to stay non-stop active on Railway
    setInterval(() => {
        axios.get(`http://127.0.0.1:${PORT}/api/health`, { timeout: 4000 }).catch(() => {});
        const { config } = database.getAllVariables();
        if (config.mainSiteUrl) {
            axios.get(`${config.mainSiteUrl}/api/keepalive`, { timeout: 4000 }).catch(() => {});
        }
    }, 20000);
});
