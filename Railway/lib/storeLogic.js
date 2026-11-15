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
    const raw = String(
        storeConfig.storeUrl ||
        storeConfig.storePublicUrl ||
        storeConfig.mainSiteUrl ||
        'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app'
    ).trim().replace(/\/+$/, '');
    return raw || 'https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app';
}

function buildSiteApiUrl(storeConfig = {}) {
    const explicitApi = String(storeConfig.siteApiUrl || '').trim().replace(/\/+$/, '');
    if (explicitApi) {
        return /\/api$/i.test(explicitApi) ? explicitApi : `${explicitApi}/api`;
    }
    const base = String(storeConfig.mainSiteUrl || storeConfig.storeUrl || storeConfig.storePublicUrl || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    return /\/api$/i.test(base) ? base : `${base}/api`;
}

function formatSiteDetailsSummary(storeConfig = {}) {
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const address = storeConfig.storeAddress || 'Main Railway Road, Hasilpur, District Bahawalpur';
    const phone = storeConfig.storePhone || '03299931199';
    const storeUrl = buildStoreBaseUrl(storeConfig);

    return [
        `🌐 *Website:* ${storeUrl}`,
        `📍 *Showroom:* ${address} (${storeCity})`,
        `📞 *Phone / WhatsApp:* ${phone}`,
        `🕒 *Hours:* Mon–Sat 10:00 AM – 9:30 PM`,
        `🛡️ *Service:* Genuine Brand Warranty · Nationwide COD`
    ].join('\n');
}

function formatStoreAboutMessage(storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const address = storeConfig.storeAddress || 'Main Railway Road, Hasilpur, District Bahawalpur';
    const phone = storeConfig.storePhone || '03299931199';
    const storeUrl = buildStoreBaseUrl(storeConfig);

    return [
        `🏪 *${storeName} — Official Showroom (${storeCity})*`,
        '',
        `📍 *Address:* ${address}`,
        `📞 *Helpline / WhatsApp:* ${phone}`,
        '🕒 *Showroom Hours:* Mon–Sat `10:00 AM – 9:30 PM` (Friday Break `1:00 – 2:30 PM`)',
        `🌐 *Online Store:* ${storeUrl}`,
        '',
        '*Why Shop With Us:*',
        '• 100% Genuine Branded Appliances & Official Warranty Cards',
        '• FREE Same-Day Delivery in Hasilpur & Fast Nationwide COD',
        '• Two-Way WhatsApp Order Verification before dispatch'
    ].join('\n');
}

function formatWarrantyDeliveryMessage(storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const freeThreshold = Number(storeConfig.freeDeliveryThreshold ?? 35000);
    const flatRate = Number(storeConfig.codFlatRate ?? 250);
    const cityRates = storeConfig.cityRates && typeof storeConfig.cityRates === 'object'
        ? storeConfig.cityRates
        : { Hasilpur: 0, Bahawalpur: 200, Vehari: 200, Multan: 300, Lahore: 350, Islamabad: 400, Karachi: 450 };

    const rateLines = Object.entries(cityRates)
        .slice(0, 8)
        .map(([city, fee]) => `• ${city}: *${Number(fee) === 0 ? 'FREE' : formatPkr(fee)}*`);

    return [
        `🛡️ *Warranty & COD Delivery Policy — ${storeName}*`,
        '',
        '*Official Brand Warranty:*',
        '• Sealed official warranty cards included (Haier, Gree, Dawlance, Crown, VisionPro).',
        '• 7-Day Replacement Guarantee on transit damage or factory defect.',
        '',
        '*Cash on Delivery (COD) Charges:*',
        ...rateLines,
        `• Other Cities: ${formatPkr(flatRate)} flat`,
        `• *FREE Nationwide COD* on orders of *${formatPkr(freeThreshold)}+*!`
    ].join('\n');
}

function formatSolarAdvisorMessage(storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const phone = storeConfig.storePhone || '03299931199';
    const storeUrl = buildStoreBaseUrl(storeConfig);

    return [
        `☀️ *Solar & Inverter Load Guide — ${storeName}*`,
        '',
        'Choose the right hybrid setup for your home or shop:',
        '• *3kW Hybrid System:* 4–6 Fans + 8 Lights + LED TV + Wi-Fi + Fridge',
        '• *6kW Dual-MPPT Hybrid (Most Popular):* 1× 1.5 Ton Inverter AC + Fridge + Water Motor + Full Home Lights & Fans',
        '• *10kW Three-Phase / Heavy Load:* 2–3 Inverter ACs + Deep Freezer + Commercial Backup',
        '',
        `Tap *Browse Categories* → *Solar & Hybrid Inverters* to view live prices, or tap *Contact For Inquiry* (Helpline: ${phone}) for a free Hasilpur/South Punjab quote.`,
        `Catalog: ${storeUrl}/?category=solar-inverters`
    ].join('\n');
}

function buildWelcomeStoreMenuLists(storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    return [{
        title: '📋 Open Store Menu',
        sections: [
            {
                title: `${storeName} — Shop & Track`,
                rows: [
                    { id: 'menu_categories', title: '🛍️ Browse Categories', description: 'Smart TVs, Solar Inverters, Cooling, Audio & Kitchen' },
                    { id: 'almumtaz_offers', title: '🔥 Offered Items (Flash Sale)', description: 'Live discounted appliances & special bundles' },
                    { id: 'almumtaz_featured', title: '⭐ Featured Electronics', description: 'Top-rated models in stock now' },
                    { id: 'menu_search', title: '🔍 Search Products', description: 'Search by model, brand, or keyword' },
                    { id: 'menu_track', title: '📦 Track My Order', description: 'Check live COD status via ORD-2026-XXXX or 4-digit code' },
                    { id: 'menu_pay', title: '💳 Pay Now / COD Info', description: 'EasyPaisa, JazzCash & Cash on Delivery options' }
                ]
            },
            {
                title: 'Store Info & Solar Desk',
                rows: [
                    { id: 'menu_about', title: '🏪 Showroom & Timings', description: 'Hasilpur address, helpline & working hours' },
                    { id: 'menu_warranty', title: '🛡️ Warranty & Delivery', description: 'Brand warranty & city-wise COD shipping rates' },
                    { id: 'menu_solar', title: '☀️ Solar Load Guide', description: '3kW, 6kW & 10kW hybrid inverter recommendations' },
                    { id: 'almumtaz_inquiry', title: '📝 Contact For Inquiry', description: 'Speak directly with our showroom team' }
                ]
            }
        ]
    }];
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
        'Please tap a button below (or reply *CONFIRM* / *REJECT*) to verify your Cash on Delivery order:',
        `Helpline: ${storeConfig.storePhone || '03299931199'} · Web: ${buildStoreBaseUrl(storeConfig)}`
    ].filter((l) => l !== null);

    return lines.join('\n');
}

function formatOrderConfirmationThanksAndShopPrompt(order, storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const phone = storeConfig.storePhone || '03299931199';
    const address = storeConfig.storeAddress || 'Main Railway Road, Hasilpur, District Bahawalpur';
    const storeUrl = buildStoreBaseUrl(storeConfig);
    const shortCode = String(order.orderId || '').split('-').pop() || order.orderId;
    const itemCount = Array.isArray(order.items)
        ? order.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
        : 0;

    return [
        `✅ *Thank You, ${order.customerName || 'Valued Customer'}!*`,
        `Your order *#${order.orderId}* has been *ACCEPTED & CONFIRMED* at *${storeName}* (${storeCity}).`,
        '',
        `• Items: ${itemCount || 1} | *COD Total: ${formatPkr(order.grandTotal)}*`,
        `• Delivery City: ${order.city || storeCity}`,
        `• Track anytime by sending *${order.orderId}* or *${shortCode}*`,
        `• Live Tracking Link: ${storeUrl}/track/${order.orderId}`,
        '',
        'We appreciate your trust in us! Your parcel is being prepared for fast COD dispatch.',
        `📞 Helpline: ${phone} · 📍 ${address}`,
        '',
        '🛍️ *Would you like to start shopping on WhatsApp?*',
        'Tap any button below to browse categories, search items, pay online, or track orders:'
    ].join('\n');
}

function formatOrderRejectionApologyMessage(order, storeConfig = {}) {
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const phone = storeConfig.storePhone || '03299931199';
    const address = storeConfig.storeAddress || 'Main Railway Road, Hasilpur, District Bahawalpur';
    const storeUrl = buildStoreBaseUrl(storeConfig);
    const orderLabel = order?.orderId ? `*#${order.orderId}*` : 'your order';

    return [
        `🙏 *We Sincerely Apologize, ${order?.customerName || 'Valued Customer'}*`,
        `Your order ${orderLabel} at *${storeName}* (${storeCity}) has been *CANCELLED / REJECTED*.`,
        '',
        '• We are truly sorry for any inconvenience caused.',
        '• No Cash on Delivery (COD) charges will be collected.',
        `• Need assistance or want to reorder another model? Contact our showroom team or browse our live catalog anytime:`,
        '',
        `🌐 *Store:* ${storeUrl}`,
        `📞 *Helpline / WhatsApp:* ${phone}`,
        `📍 *Showroom:* ${address}`
    ].join('\n');
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
        text.match(/^accept_order_([A-Za-z0-9_-]+)$/i) ||
        upper.match(/^(?:CONFIRM|ACCEPT)\s+#?(ORD-[\w-]+)$/i);
    if (confirmMatch) {
        return { type: 'order_decision', decision: 'Confirmed', orderId: confirmMatch[1].toUpperCase() };
    }

    const cancelMatch = text.match(/^cancel_order_([A-Za-z0-9_-]+)$/i) ||
        text.match(/^reject_order_([A-Za-z0-9_-]+)$/i) ||
        upper.match(/^(?:CANCEL|REJECT|DENY|DECLINE)\s+#?(ORD-[\w-]+)$/i);
    if (cancelMatch) {
        return { type: 'order_decision', decision: 'Cancelled', orderId: cancelMatch[1].toUpperCase() };
    }

    if (text === '✅ Confirm Order' || upper === 'CONFIRM ORDER' || upper === 'CONFIRM' || upper === 'ACCEPT' || upper === 'ACCEPT ORDER' || upper === 'YES CONFIRM') {
        return { type: 'order_decision_latest', decision: 'Confirmed' };
    }
    if (text === '❌ Cancel Order' || upper === 'CANCEL ORDER' || upper === 'REJECT ORDER' || upper === 'REJECT' || upper === 'CANCEL' || upper === 'DECLINE' || upper === 'NO CANCEL') {
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
    if (lower === 'almumtaz_offers' || lower === 'offered items' || lower === '🔥 offered items' || lower === '🔥 offered items (flash sale)' || text === '2') {
        return { type: 'menu_offers' };
    }
    if (lower === 'almumtaz_featured' || lower === 'featured items' || lower === '⭐ featured electronics' || text === '3') {
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
    if (
        lower === 'menu_about' || lower === '🏪 showroom & timings' || lower === 'showroom & timings' ||
        lower === 'about' || lower === 'location' || lower === 'address' || lower === 'timings' ||
        lower === 'hours' || lower === 'showroom' || lower === 'details' || lower === 'site' ||
        lower === 'website' || lower === 'info' || lower === 'contact' || lower === 'number' ||
        lower === 'phone' || lower === 'helpline' || lower === 'store details' || lower === 'site details' ||
        /\b(?:address|location|timing|hours|helpline|website|site\s*details|store\s*details|contact\s*number|where\s*is\s*(?:your\s*)?(?:shop|store|showroom))\b/i.test(lower) ||
        text === '7'
    ) {
        return { type: 'menu_about' };
    }
    if (lower === 'menu_warranty' || lower === '🛡️ warranty & delivery' || lower === 'warranty & delivery' || lower === 'warranty' || lower === 'delivery' || lower === 'shipping' || lower === 'rates' || text === '8') {
        return { type: 'menu_warranty' };
    }
    if (lower === 'menu_solar' || lower === '☀️ solar load guide' || lower === 'solar load guide' || lower === 'solar' || lower === 'inverter' || lower === 'load' || text === '9') {
        return { type: 'menu_solar' };
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
    buildSiteApiUrl,
    formatSiteDetailsSummary,
    formatStoreAboutMessage,
    formatWarrantyDeliveryMessage,
    formatSolarAdvisorMessage,
    buildWelcomeStoreMenuLists,
    formatOrderReceiptText,
    formatOrderConfirmationThanksAndShopPrompt,
    formatOrderRejectionApologyMessage,
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
