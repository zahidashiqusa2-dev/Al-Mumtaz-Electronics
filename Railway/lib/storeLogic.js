'use strict';

const BOT_BUTTONS = Object.freeze([
    { id: 'almumtaz_categories', text: 'Items Categories' },
    { id: 'almumtaz_offers', text: 'Offered Items' },
    { id: 'almumtaz_featured', text: 'Featured Items' },
    { id: 'almumtaz_store', text: 'Browse Online Store' },
    { id: 'almumtaz_inquiry', text: 'Contact For Inquiry' }
]);

function normalizePakistanWhatsApp(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        return { valid: false, error: 'WhatsApp mobile number is required.' };
    }

    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('00')) {
        digits = digits.slice(2);
    }

    if (digits.startsWith('03') && digits.length === 11) {
        digits = '92' + digits.slice(1);
    } else if (digits.startsWith('3') && digits.length === 10) {
        digits = '92' + digits;
    }

    if (digits.startsWith('92')) {
        if (!/^923\d{9}$/.test(digits)) {
            return {
                valid: false,
                error: 'Enter a valid Pakistan WhatsApp number (e.g. +923299931199 or 03299931199).'
            };
        }
    } else if (digits.length < 10 || digits.length > 15) {
        return {
            valid: false,
            error: 'WhatsApp number must include valid country code (10–15 digits).'
        };
    }

    return {
        valid: true,
        digits,
        e164: `+${digits}`,
        jid: `${digits}@s.whatsapp.net`,
        localDisplay: digits.startsWith('92') ? `0${digits.slice(2)}` : `+${digits}`
    };
}

function formatPkr(amount) {
    const num = Math.max(0, Math.round(Number(amount) || 0));
    return `Rs. ${num.toLocaleString('en-PK')}`;
}

function buildMainBotButtons() {
    return BOT_BUTTONS.map((btn) => ({ ...btn }));
}

function parseIncomingBotAction(rawInput) {
    const text = String(rawInput || '').trim();
    if (!text) return { type: 'unknown', raw: '' };

    const upper = text.toUpperCase();
    const lower = text.toLowerCase();

    const confirmMatch = text.match(/^confirm_order_([A-Za-z0-9_-]+)$/i) ||
        upper.match(/^CONFIRM\s+#?(ORD-[\w-]+)$/i);
    if (confirmMatch) {
        return { type: 'order_decision', decision: 'Confirmed', orderId: confirmMatch[1].toUpperCase() };
    }

    const cancelMatch = text.match(/^cancel_order_([A-Za-z0-9_-]+)$/i) ||
        text.match(/^reject_order_([A-Za-z0-9_-]+)$/i) ||
        upper.match(/^(?:CANCEL|REJECT|DENY)\s+#?(ORD-[\w-]+)$/i);
    if (cancelMatch) {
        return { type: 'order_decision', decision: 'Cancelled', orderId: cancelMatch[1].toUpperCase() };
    }

    if (text === '✅ Confirm Order' || upper === 'CONFIRM ORDER') {
        return { type: 'order_decision_latest', decision: 'Confirmed' };
    }
    if (text === '❌ Cancel Order' || upper === 'CANCEL ORDER' || upper === 'REJECT ORDER') {
        return { type: 'order_decision_latest', decision: 'Cancelled' };
    }

    const catMatch = text.match(/^cat_([a-z0-9-]+)$/i);
    if (catMatch) {
        return { type: 'category_detail', slug: catMatch[1].toLowerCase() };
    }

    if (lower === 'almumtaz_categories' || lower === 'items categories' || text === '1') {
        return { type: 'menu_categories' };
    }
    if (lower === 'almumtaz_offers' || lower === 'offered items' || text === '2') {
        return { type: 'menu_offers' };
    }
    if (lower === 'almumtaz_featured' || lower === 'featured items' || text === '3') {
        return { type: 'menu_featured' };
    }
    if (lower === 'almumtaz_store' || lower === 'browse online store' || text === '4') {
        return { type: 'menu_store' };
    }
    if (lower === 'almumtaz_inquiry' || lower === 'contact for inquiry' || text === '5') {
        return { type: 'menu_inquiry' };
    }

    return { type: 'general_message', raw: text };
}

function formatAdminInquiryForward(inquiry, storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    return [
        `📩 *New Customer Inquiry — ${storeName}*`,
        `Customer Name: ${inquiry.senderName || 'WhatsApp Customer'}`,
        `WhatsApp Number: +${String(inquiry.senderNumber || '').replace(/\D/g, '')}`,
        `Customer JID: ${inquiry.senderJid || 'N/A'}`,
        `Received At: ${inquiry.createdAt || new Date().toISOString()}`,
        '',
        '*Topic & Customer Details:*',
        String(inquiry.description || '').trim()
    ].join('\n');
}

function verifyAdminCredentials(inputUsername, inputPassword, expectedUsername, expectedPassword) {
    const crypto = require('crypto');
    const uIn = String(inputUsername || '').trim();
    const pIn = String(inputPassword || '');
    const uExp = String(expectedUsername || '').trim();
    const pExp = String(expectedPassword || '');
    if (!uIn || !pIn || !uExp || !pExp) return false;

    const hashA = crypto.createHash('sha256').update(`${uIn}\0${pIn}`).digest();
    const hashB = crypto.createHash('sha256').update(`${uExp}\0${pExp}`).digest();
    return crypto.timingSafeEqual(hashA, hashB);
}

function generateAdminToken() {
    const crypto = require('crypto');
    return 'adm_' + crypto.randomBytes(32).toString('hex');
}

function normalizeRailwayUrl(rawUrl) {
    const raw = String(rawUrl || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
    } catch (_) {
        return '';
    }
}

module.exports = {
    BOT_BUTTONS,
    normalizePakistanWhatsApp,
    formatPkr,
    buildMainBotButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward,
    verifyAdminCredentials,
    generateAdminToken,
    normalizeRailwayUrl
};
