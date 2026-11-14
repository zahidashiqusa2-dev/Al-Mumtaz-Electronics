'use strict';

const BOT_BUTTONS = Object.freeze([
    { id: 'almumtaz_categories', text: 'Items Categories' },
    { id: 'almumtaz_offers', text: 'Offered Items' },
    { id: 'almumtaz_featured', text: 'Featured Items' },
    { id: 'almumtaz_store', text: 'Browse Online Store' },
    { id: 'almumtaz_track', text: 'Track Order' },
    { id: 'almumtaz_inquiry', text: 'Contact For Inquiry' }
]);

const WELCOME_MENU_BUTTONS = Object.freeze([
    { id: 'menu_categories', text: '🛍️ Browse Categories', type: 'quick_reply' },
    { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
    { id: 'menu_track', text: '📦 Track My Order', type: 'quick_reply' },
    { id: 'menu_pay', text: '💳 Pay Now', type: 'quick_reply' },
    { id: 'almumtaz_offers', text: '🔥 Offered Items', type: 'quick_reply' },
    { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' }
]);

const GREETING_PATTERNS = [
    /^(?:hi+|he+y+|he+l+o+|hlo+|hola+|hy+)$/i,
    /^(?:good\s*(?:morning|afternoon|evening|night)|gm|ga|ge)$/i,
    /^(?:aoa|a\.o\.a|slm|salam|salaam|salamu\s*alaikum|salam[\s-]*o[\s-]*alaikum|aslam|asalam|aslkm|assalam|assalamu|assalamualaikum|assalam[\s-]*u[\s-]*alaikum|assalam[\s-]*o[\s-]*alaikum|walaikum|walikum|w\.salam|wsalam)(?:\s+.*)?$/i,
    /^(?:menu|start|shop|shopping|store|items|catalog|browse|help)$/i,
    /^(?:yes|yeah|yep|yup|sure|ok|okay|haan|ji|start\s*shopping|show\s*items)$/i
];

function isGreetingMessage(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return false;

    if (/^[\s👋🙌🤝🙋🙏✨🛒🛍️]+$/u.test(text)) {
        return true;
    }

    const cleaned = text
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
        .replace(/[!.,?'"`~:;()\[\]{}]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return false;
    return GREETING_PATTERNS.some((re) => re.test(cleaned));
}

function normalizeOrderLookupInput(rawInput) {
    const raw = String(rawInput || '').trim();
    const clean = raw.replace(/^#+/, '').trim().toUpperCase();
    const isFullId = /^ORD-[A-Z0-9-]+$/.test(clean);
    const isShortDigits = /^\d{3,6}$/.test(clean);
    return { raw, clean, isFullId, isShortDigits };
}

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

function buildStoreBaseUrl(storeConfig = {}) {
    const raw = String(storeConfig.storePublicUrl || storeConfig.storeUrl || storeConfig.mainSiteUrl || 'https://al-mumtaz.ai.studio').trim().replace(/\/+$/, '');
    return raw || 'https://al-mumtaz.ai.studio';
}

function formatOrderReceiptText(order, storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const items = Array.isArray(order.items) ? order.items : [];

    const itemLines = items.map((item, idx) => {
        const variantStr = item.variant ? ` (${item.variant})` : '';
        return `${idx + 1}. *${item.title}*${variantStr} x${item.quantity} — ${formatPkr(item.lineTotal)}`;
    });

    const lines = [
        `🛒 *Order Receipt - ${storeName} (${storeCity})*`,
        `Order ID: *#${order.orderId}*`,
        `Customer: ${order.customerName}`,
        `WhatsApp: ${order.whatsappNumber}`,
        `Address: ${order.shippingAddress}, ${order.city}${order.nearestLandmark ? ` (Near: ${order.nearestLandmark})` : ''}`,
        '',
        '*Items:*',
        ...itemLines,
        '',
        `Subtotal: ${formatPkr(order.subtotal)}`,
        order.discountTotal > 0 ? `Product Discount: -${formatPkr(order.discountTotal)}` : null,
        `COD Delivery: ${order.codDeliveryCharges === 0 ? 'FREE' : formatPkr(order.codDeliveryCharges)}`,
        `*Grand Total (COD): ${formatPkr(order.grandTotal)}*`,
        '',
        'Please tap a button below to confirm or cancel your Cash on Delivery order:'
    ].filter((l) => l !== null);

    return lines.join('\n');
}

function formatOrderTrackingMessage(order, storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeUrl = buildStoreBaseUrl(storeConfig);
    const shortCode = String(order.orderId || '').split('-').pop() || order.orderId;
    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.map((item, idx) => {
        const variantStr = item.variant ? ` (${item.variant})` : '';
        return `${idx + 1}. *${item.title}*${variantStr} × ${item.quantity} — ${formatPkr(item.lineTotal)}`;
    });

    const statusBadge =
        order.orderStatus === 'Delivered' ? '✅ Delivered'
        : order.orderStatus === 'Dispatched' || order.orderStatus === 'Shipped' ? '🚚 Dispatched'
        : order.orderStatus === 'Confirmed' ? '✅ Confirmed (Packing for Dispatch)'
        : order.orderStatus === 'Cancelled' ? '❌ Cancelled'
        : '⏳ Pending WhatsApp Confirmation';

    return [
        `📦 *Order Tracking — ${storeName}*`,
        `Order ID: *#${order.orderId}* (Quick Code: *${shortCode}*)`,
        `Status: *${statusBadge}*`,
        `Customer: ${order.customerName}`,
        `Destination: ${order.shippingAddress}, ${order.city}`,
        '',
        '*Ordered Items:*',
        ...itemLines,
        '',
        `*Grand Total (COD): ${formatPkr(order.grandTotal)}*`,
        `Track Online: ${storeUrl}/track/${order.orderId}`,
        order.whatsappConfirmedAt ? `Confirmed At: ${order.whatsappConfirmedAt}` : null
    ].filter((l) => l !== null).join('\n');
}

function formatProductWhatsAppCard(product, storeConfig = {}) {
    const storeUrl = buildStoreBaseUrl(storeConfig);
    const discountStr = product.discountPercentage > 0
        ? ` (Was ${formatPkr(product.originalPrice)} • *-${product.discountPercentage}% OFF*)`
        : '';
    const stockStr = Number(product.stock) > 0
        ? `✅ In Stock (${product.stock} available)`
        : '⚠️ Out of Stock';
    const variants = Array.isArray(product.variantOptions) && product.variantOptions.length > 1
        ? `Variants: ${product.variantOptions.slice(0, 4).map((v) => `${v.name} (${formatPkr(v.discountPrice)})`).join(' | ')}`
        : null;

    return [
        `*${product.title}*`,
        `SKU: ${product.sku || `ITEM-${product.id}`} · ${stockStr}`,
        `Price: *${formatPkr(product.discountPrice)}*${discountStr}`,
        variants,
        product.warranty ? `Warranty: ${product.warranty}` : null,
        `Store Link: ${storeUrl}`
    ].filter(Boolean).join('\n');
}

function formatPaymentOptionsMessage(storeConfig = {}, target = null) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeUrl = buildStoreBaseUrl(storeConfig);
    const paymentInfo = storeConfig.paymentInfo ||
        'EasyPaisa / JazzCash: 0329-9931199 (Al-Mumtaz Electronics Hasilpur) · Cash on Delivery (COD) also available nationwide.';

    const header = target && target.orderId
        ? `💳 *Pay Online for Order #${target.orderId}*\nAmount Due: *${formatPkr(target.grandTotal)}*`
        : target && target.title
        ? `💳 *Pay Online — ${target.title}*\nSale Price: *${formatPkr(target.discountPrice)}*`
        : `💳 *Online Payment & COD Options — ${storeName}*`;

    const checkoutUrl = target && target.orderId
        ? `${storeUrl}/track/${target.orderId}`
        : `${storeUrl}/?tab=checkout`;

    return [
        header,
        '',
        '*Accepted Payment Methods:*',
        paymentInfo,
        '',
        `Complete checkout or verify payment online:\n${checkoutUrl}`,
        '',
        'Need help or want to send your payment screenshot? Tap *Contact For Inquiry* below.'
    ].join('\n');
}

function buildOrderConfirmationButtons(orderId) {
    return [
        { id: `confirm_order_${orderId}`, text: '✅ Confirm Order', type: 'quick_reply' },
        { id: `pay_${orderId}`, text: '💳 Pay Now', type: 'quick_reply' },
        { id: `cancel_order_${orderId}`, text: '❌ Cancel Order', type: 'quick_reply' }
    ];
}

function buildMainBotButtons() {
    return BOT_BUTTONS.map((btn) => ({ ...btn }));
}

function buildWelcomeMenuButtons(storeConfig = {}) {
    const storeUrl = buildStoreBaseUrl(storeConfig);
    return [
        ...WELCOME_MENU_BUTTONS.map((b) => ({ ...b })),
        { id: 'visit_store_url', text: '🌐 Visit Online Store', type: 'cta_url', url: storeUrl }
    ];
}

function buildProductCardButtons(productId, storeConfig = {}) {
    const storeUrl = buildStoreBaseUrl(storeConfig);
    return [
        { id: `buy_${productId}`, text: '🛒 Order Now (COD)', type: 'quick_reply' },
        { id: `pay_${productId}`, text: '💳 Pay Online', type: 'quick_reply' },
        { id: 'menu_search', text: '🔍 Search Another Item', type: 'quick_reply' },
        { id: 'visit_store_url', text: '🌐 View on Website', type: 'cta_url', url: storeUrl }
    ];
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

    if (text === '✅ Confirm Order' || upper === 'CONFIRM ORDER' || upper === 'CONFIRM') {
        return { type: 'order_decision_latest', decision: 'Confirmed' };
    }
    if (text === '❌ Cancel Order' || upper === 'CANCEL ORDER' || upper === 'REJECT ORDER' || upper === 'REJECT' || upper === 'CANCEL') {
        return { type: 'order_decision_latest', decision: 'Cancelled' };
    }

    const buyMatch = text.match(/^buy_(\d+)$/i);
    if (buyMatch) {
        return { type: 'buy_product', productId: Number(buyMatch[1]) };
    }
    const payMatch = text.match(/^pay_([A-Za-z0-9_-]+)$/i);
    if (payMatch) {
        return { type: 'pay_target', targetId: payMatch[1] };
    }

    const catMatch = text.match(/^cat_([a-z0-9_-]+)$/i);
    if (catMatch) {
        return { type: 'category_detail', slug: catMatch[1].toLowerCase() };
    }

    const directSearchMatch = text.match(/^(?:search|find)\s+(.{2,})$/i);
    if (directSearchMatch) {
        return { type: 'search_query', query: directSearchMatch[1].trim() };
    }

    const trackCmdMatch = text.match(/^(?:track|status|order)\s+#?(ORD-[A-Za-z0-9-]+|\d{3,6})$/i);
    if (trackCmdMatch) {
        return { type: 'track_order_lookup', query: trackCmdMatch[1].toUpperCase() };
    }
    const fullOrderIdMatch = upper.match(/^#?(ORD-\d{4}-\d{3,6})$/);
    if (fullOrderIdMatch) {
        return { type: 'track_order_lookup', query: fullOrderIdMatch[1] };
    }

    if (lower === 'menu_categories' || lower === 'almumtaz_categories' || lower === 'items categories' || lower === '🛍️ browse categories' || lower === 'browse categories' || text === '1') {
        return { type: 'menu_categories' };
    }
    if (lower === 'menu_search' || lower === '🔍 search products' || lower === 'search products' || lower === '🔍 search another item' || lower === 'search another item' || lower === 'search') {
        return { type: 'menu_search' };
    }
    if (lower === 'almumtaz_offers' || lower === 'offered items' || lower === '🔥 offered items' || text === '2') {
        return { type: 'menu_offers' };
    }
    if (lower === 'almumtaz_featured' || lower === 'featured items' || text === '3') {
        return { type: 'menu_featured' };
    }
    if (lower === 'almumtaz_store' || lower === 'visit_store_url' || lower === 'browse online store' || lower === '🌐 visit online store' || lower === 'visit online store' || text === '4') {
        return { type: 'menu_store' };
    }
    if (lower === 'menu_track' || lower === 'almumtaz_track' || lower === '📦 track my order' || lower === 'track my order' || lower === 'track order' || lower === 'track' || text === '5') {
        return { type: 'menu_track' };
    }
    if (lower === 'menu_pay' || lower === '💳 pay now' || lower === 'pay now' || lower === '💳 pay online' || lower === 'pay online' || lower === 'pay') {
        return { type: 'menu_pay' };
    }
    if (lower === 'almumtaz_inquiry' || lower === '📝 contact for inquiry' || lower === 'contact for inquiry' || lower === 'inquiry' || text === '6') {
        return { type: 'menu_inquiry' };
    }

    if (isGreetingMessage(text)) {
        return { type: 'greeting_menu', raw: text };
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
    WELCOME_MENU_BUTTONS,
    isGreetingMessage,
    normalizeOrderLookupInput,
    normalizePakistanWhatsApp,
    formatPkr,
    buildStoreBaseUrl,
    formatOrderReceiptText,
    formatOrderTrackingMessage,
    formatProductWhatsAppCard,
    formatPaymentOptionsMessage,
    buildOrderConfirmationButtons,
    buildMainBotButtons,
    buildWelcomeMenuButtons,
    buildProductCardButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward,
    verifyAdminCredentials,
    generateAdminToken,
    normalizeRailwayUrl
};
