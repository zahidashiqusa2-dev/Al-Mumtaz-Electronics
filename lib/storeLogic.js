'use strict';

/**
 * Pure, framework-free domain logic for Al-Mumtaz Electronics
 * (Phone validation, COD pricing, Digital WhatsApp Receipt formatting,
 *  and WhatsApp 5-button / Order Confirm & Cancel payload parsing).
 */

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

    // Pure greeting / wave emojis
    if (/^[\s👋🙌🤝🙋🙏✨🛒🛍️]+$/u.test(text)) {
        return true;
    }

    // Strip emojis & punctuation for clean matching (e.g. "Hey 👋", "Salam!", "Assalamualaikum 🌙")
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
    return {
        raw,
        clean,
        isFullId,
        isShortDigits
    };
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

    // Pakistan local mobile format: 03XXXXXXXXX (11 digits) -> 923XXXXXXXXX
    if (digits.startsWith('03') && digits.length === 11) {
        digits = '92' + digits.slice(1);
    } else if (digits.startsWith('3') && digits.length === 10) {
        digits = '92' + digits;
    }

    // Validate Pakistan mobile (923XXXXXXXXX = 12 digits) or valid international mobile (10-15 digits)
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

function calculateDiscountPercentage(originalPrice, discountPrice) {
    const orig = Number(originalPrice) || 0;
    const disc = Number(discountPrice) || 0;
    if (orig <= 0 || disc <= 0 || disc >= orig) return 0;
    return Math.round(((orig - disc) / orig) * 100);
}

function formatPkr(amount) {
    const num = Math.max(0, Math.round(Number(amount) || 0));
    return `Rs. ${num.toLocaleString('en-PK')}`;
}

function calculateOrderTotals(items = [], shippingConfig = {}, city = '', deliverySpeed = 'standard') {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Cart must contain at least one item.');
    }

    let originalSubtotal = 0;
    let subtotal = 0;
    const normalizedItems = [];

    for (const item of items) {
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unitOriginal = Math.max(0, Number(item.originalPrice || item.price || 0));
        const unitSale = Math.max(0, Number(item.discountPrice || item.price || unitOriginal));
        const effectiveUnit = unitSale > 0 && unitSale <= unitOriginal ? unitSale : unitOriginal;

        originalSubtotal += unitOriginal * qty;
        subtotal += effectiveUnit * qty;

        normalizedItems.push({
            productId: Number(item.productId || item.id) || 0,
            title: String(item.title || 'Product').trim(),
            sku: String(item.sku || '').trim(),
            variant: String(item.variant || '').trim(),
            quantity: qty,
            originalPrice: unitOriginal,
            unitPrice: effectiveUnit,
            lineTotal: effectiveUnit * qty,
            image: String(item.image || '').trim()
        });
    }

    const discountTotal = Math.max(0, originalSubtotal - subtotal);
    const flatRate = Number(shippingConfig.codFlatRate ?? 250) || 0;
    const expressRate = Number(shippingConfig.expressCodRate ?? 550) || 0;
    const freeThreshold = Number(shippingConfig.freeDeliveryThreshold ?? 35000) || 0;
    const cityRates = shippingConfig.cityRates && typeof shippingConfig.cityRates === 'object'
        ? shippingConfig.cityRates
        : {};

    const cleanCity = String(city || '').trim().toLowerCase();
    let baseCityRate = flatRate;
    for (const [cityName, rateVal] of Object.entries(cityRates)) {
        if (cityName.trim().toLowerCase() === cleanCity) {
            baseCityRate = Number(rateVal) || 0;
            break;
        }
    }

    let codDeliveryCharges = deliverySpeed === 'express'
        ? Math.max(expressRate, baseCityRate)
        : baseCityRate;

    let freeDeliveryApplied = false;
    if (deliverySpeed !== 'express' && freeThreshold > 0 && subtotal >= freeThreshold) {
        codDeliveryCharges = 0;
        freeDeliveryApplied = true;
    }

    const grandTotal = subtotal + codDeliveryCharges;

    return {
        items: normalizedItems,
        originalSubtotal,
        subtotal,
        discountTotal,
        codDeliveryCharges,
        freeDeliveryApplied,
        grandTotal
    };
}

function generateOrderId(now = new Date(), randomSuffix = null) {
    const year = now.getFullYear();
    const rand = randomSuffix !== null
        ? String(randomSuffix).padStart(4, '0').slice(-4)
        : String(Math.floor(1000 + Math.random() * 9000));
    return `ORD-${year}-${rand}`;
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
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
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

function formatOrderStatusUpdateMessage(order, storeConfig = {}) {
    const status = String(order?.orderStatus || '');
    if (status === 'Confirmed') {
        return formatOrderConfirmationThanksAndShopPrompt(order, storeConfig);
    }
    if (status === 'Cancelled') {
        return formatOrderRejectionApologyMessage(order, storeConfig);
    }
    const storeName = storeConfig.storeName || 'Al-Mumtaz Electronics';
    const storeCity = storeConfig.storeCity || 'Hasilpur';
    const phone = storeConfig.storePhone || '03299931199';
    const storeUrl = buildStoreBaseUrl(storeConfig);
    if (status === 'Delivered') {
        return [
            `🎉 *Thank You for Shopping with ${storeName}!*`,
            `Your order *#${order.orderId}* has been marked *DELIVERED*.`,
            `We truly appreciate your business! If you need warranty support or assistance, reach us at *${phone}*.`,
            `🌐 *Shop Again:* ${storeUrl}`
        ].join('\n');
    }
    if (status === 'Dispatched' || status === 'Shipped') {
        return [
            `🚚 *Order Dispatched — #${order.orderId}*`,
            `Great news, *${order.customerName || 'Valued Customer'}*! Your parcel from *${storeName}* (${storeCity}) is on its way.`,
            `• COD Amount on Delivery: *${formatPkr(order.grandTotal)}*`,
            `• Live Tracking: ${storeUrl}/track/${order.orderId}`,
            `📞 Support Helpline: ${phone}`
        ].join('\n');
    }
    return formatOrderTrackingMessage(order, storeConfig);
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
        `*Accepted Payment Methods:*`,
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

    // 1. Order Confirm / Accept / Reject / Cancel button IDs or text commands
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

    // Fuzzy text button labels when user taps fallback text or replies Confirm/Accept/Reject/Cancel without ID
    if (text === '✅ Confirm Order' || upper === 'CONFIRM ORDER' || upper === 'CONFIRM' || upper === 'ACCEPT' || upper === 'ACCEPT ORDER' || upper === 'YES CONFIRM') {
        return { type: 'order_decision_latest', decision: 'Confirmed' };
    }
    if (text === '❌ Cancel Order' || upper === 'CANCEL ORDER' || upper === 'REJECT ORDER' || upper === 'REJECT' || upper === 'CANCEL' || upper === 'DECLINE' || upper === 'NO CANCEL') {
        return { type: 'order_decision_latest', decision: 'Cancelled' };
    }

    // 2. Product In-Chat Buy / Pay callbacks: buy_<productId> | pay_<productIdOrOrderId>
    const buyMatch = text.match(/^buy_(\d+)$/i);
    if (buyMatch) {
        return { type: 'buy_product', productId: Number(buyMatch[1]) };
    }
    const payMatch = text.match(/^pay_([A-Za-z0-9_-]+)$/i);
    if (payMatch) {
        return { type: 'pay_target', targetId: payMatch[1] };
    }

    // 3. Category selection callback: cat_<slug>
    const catMatch = text.match(/^cat_([a-z0-9_-]+)$/i);
    if (catMatch) {
        return { type: 'category_detail', slug: catMatch[1].toLowerCase() };
    }

    // 4. Direct Search commands: "search inverter"
    const directSearchMatch = text.match(/^(?:search|find)\s+(.{2,})$/i);
    if (directSearchMatch) {
        return { type: 'search_query', query: directSearchMatch[1].trim() };
    }

    // 5. Direct Order Tracking commands: "track ORD-2026-9336", "track 9336", "ORD-2026-9336", "#ORD-2026-9336"
    const trackCmdMatch = text.match(/^(?:track|status|order)\s+#?(ORD-[A-Za-z0-9-]+|\d{3,6})$/i);
    if (trackCmdMatch) {
        return { type: 'track_order_lookup', query: trackCmdMatch[1].toUpperCase() };
    }
    const fullOrderIdMatch = upper.match(/^#?(ORD-\d{4}-\d{3,6})$/);
    if (fullOrderIdMatch) {
        return { type: 'track_order_lookup', query: fullOrderIdMatch[1] };
    }

    // 6. Store Menu Buttons (IDs, exact labels, or numeric shortcuts)
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

    // 7. Greetings -> automatically show shopping menu + site details
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

function parseCloudinaryUri(uri) {
    const raw = String(uri || '').trim();
    if (!raw) return { valid: false, error: 'Cloudinary_URI is not configured.' };
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'cloudinary:') {
            return { valid: false, error: 'Cloudinary_URI must start with cloudinary://' };
        }
        const apiKey = decodeURIComponent(parsed.username || '').trim();
        const apiSecret = decodeURIComponent(parsed.password || '').trim();
        const cloudName = String(parsed.hostname || '').trim();
        if (!apiKey || !apiSecret || !cloudName) {
            return { valid: false, error: 'Cloudinary_URI must include api_key, api_secret, and cloud_name.' };
        }
        return { valid: true, cloudName, apiKey, apiSecret };
    } catch (_) {
        return { valid: false, error: 'Invalid Cloudinary_URI format (expected cloudinary://api_key:api_secret@cloud_name).' };
    }
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

const ORDER_STATUSES = Object.freeze([
    'Pending WhatsApp Confirmation',
    'Confirmed',
    'Dispatched',
    'Delivered',
    'Cancelled'
]);

const ALLOWED_ORDER_STATUSES = Object.freeze([
    'Pending WhatsApp Confirmation',
    'Confirmed',
    'ACCEPTED',
    'Dispatched',
    'Shipped',
    'Delivered',
    'Cancelled',
    'CANCELLED'
]);

function normalizeOrderStatus(status) {
    const raw = String(status || '').trim();
    const upper = raw.toUpperCase();
    if (upper === 'ACCEPTED' || upper === 'CONFIRMED') return 'Confirmed';
    if (upper === 'SHIPPED' || upper === 'DISPATCHED') return 'Dispatched';
    if (upper === 'DELIVERED') return 'Delivered';
    if (upper === 'CANCELLED' || upper === 'CANCELED' || upper === 'REJECTED' || upper === 'DENIED') return 'Cancelled';
    if (ORDER_STATUSES.includes(raw)) return raw;
    return 'Pending WhatsApp Confirmation';
}

function computeStoreAnalytics({ orders = [], products = [], categories = [], filterCategory = 'all', filterStatus = 'all' } = {}) {
    const productById = new Map();
    const productBySku = new Map();
    const catMap = new Map();

    for (const cat of categories || []) {
        if (!cat?.slug) continue;
        catMap.set(cat.slug, {
            slug: cat.slug,
            name: cat.name || cat.slug,
            productCount: 0,
            totalStock: 0,
            orderIds: new Set(),
            pendingOrderIds: new Set(),
            confirmedOrderIds: new Set(),
            dispatchedOrderIds: new Set(),
            deliveredOrderIds: new Set(),
            cancelledOrderIds: new Set(),
            unitsSold: 0,
            revenue: 0,
            pendingRevenue: 0,
            confirmedRevenue: 0,
            dispatchedRevenue: 0,
            deliveredRevenue: 0,
            cancelledRevenue: 0
        });
    }

    const ensureCategoryBucket = (slug, fallbackName = null) => {
        const key = slug || 'uncategorized';
        if (!catMap.has(key)) {
            catMap.set(key, {
                slug: key,
                name: fallbackName || (key === 'uncategorized' ? 'Uncategorized / Other' : key),
                productCount: 0,
                totalStock: 0,
                orderIds: new Set(),
                pendingOrderIds: new Set(),
                confirmedOrderIds: new Set(),
                dispatchedOrderIds: new Set(),
                deliveredOrderIds: new Set(),
                cancelledOrderIds: new Set(),
                unitsSold: 0,
                revenue: 0,
                pendingRevenue: 0,
                confirmedRevenue: 0,
                dispatchedRevenue: 0,
                deliveredRevenue: 0,
                cancelledRevenue: 0
            });
        }
        return catMap.get(key);
    };

    let totalInventoryStock = 0;
    for (const p of products || []) {
        if (!p) continue;
        if (p.id !== undefined) productById.set(Number(p.id), p);
        if (p.sku) productBySku.set(String(p.sku).toUpperCase(), p);
        const bucket = ensureCategoryBucket(p.categorySlug || 'uncategorized');
        bucket.productCount += 1;
        const stock = Math.max(0, Number(p.stock) || 0);
        bucket.totalStock += stock;
        totalInventoryStock += stock;
    }

    const statusBuckets = {
        'Pending WhatsApp Confirmation': { key: 'Pending WhatsApp Confirmation', label: 'Pending WhatsApp', count: 0, revenue: 0 },
        Confirmed: { key: 'Confirmed', label: 'Confirmed Orders', count: 0, revenue: 0 },
        Dispatched: { key: 'Dispatched', label: 'Dispatched', count: 0, revenue: 0 },
        Delivered: { key: 'Delivered', label: 'Delivered', count: 0, revenue: 0 },
        Cancelled: { key: 'Cancelled', label: 'Cancelled', count: 0, revenue: 0 }
    };

    const cityMap = new Map();
    const prodSalesMap = new Map();

    const cleanStatusFilter = filterStatus && filterStatus !== 'all' ? normalizeOrderStatus(filterStatus) : 'all';
    const cleanCategoryFilter = filterCategory && filterCategory !== 'all' ? String(filterCategory) : 'all';

    let filteredOrdersCount = 0;
    let totalUnitsSold = 0;
    let grossRevenue = 0;
    let nonCancelledCount = 0;

    for (const order of orders || []) {
        if (!order) continue;
        const normStatus = normalizeOrderStatus(order.orderStatus);
        const items = Array.isArray(order.items) ? order.items : [];

        // Determine matching items if a category filter is active
        const itemEntries = items.map((item) => {
            const matchedProd = productById.get(Number(item.productId)) ||
                (item.sku ? productBySku.get(String(item.sku).toUpperCase()) : null);
            const catSlug = item.categorySlug || matchedProd?.categorySlug || 'uncategorized';
            const qty = Math.max(1, Number(item.quantity) || 1);
            const lineTotal = Number(item.lineTotal) || (Number(item.unitPrice || item.discountPrice || 0) * qty);
            return { item, matchedProd, catSlug, qty, lineTotal };
        });

        if (cleanStatusFilter !== 'all' && normStatus !== cleanStatusFilter) {
            continue;
        }
        if (cleanCategoryFilter !== 'all' && !itemEntries.some((e) => e.catSlug === cleanCategoryFilter)) {
            continue;
        }

        filteredOrdersCount += 1;
        const orderGrand = Number(order.grandTotal) || 0;
        statusBuckets[normStatus].count += 1;
        statusBuckets[normStatus].revenue += orderGrand;

        if (normStatus !== 'Cancelled') {
            grossRevenue += orderGrand;
            nonCancelledCount += 1;
        }

        const cityName = String(order.city || 'Other').trim() || 'Other';
        if (!cityMap.has(cityName)) {
            cityMap.set(cityName, { city: cityName, orderCount: 0, deliveredCount: 0, revenue: 0 });
        }
        const cityEntry = cityMap.get(cityName);
        cityEntry.orderCount += 1;
        if (normStatus === 'Delivered') cityEntry.deliveredCount += 1;
        if (normStatus !== 'Cancelled') cityEntry.revenue += orderGrand;

        for (const { item, matchedProd, catSlug, qty, lineTotal } of itemEntries) {
            if (cleanCategoryFilter !== 'all' && catSlug !== cleanCategoryFilter) {
                continue;
            }
            const catBucket = ensureCategoryBucket(catSlug);
            const oid = order.orderId || String(order.id || Math.random());
            catBucket.orderIds.add(oid);

            if (normStatus === 'Pending WhatsApp Confirmation') {
                catBucket.pendingOrderIds.add(oid);
                catBucket.pendingRevenue += lineTotal;
            } else if (normStatus === 'Confirmed') {
                catBucket.confirmedOrderIds.add(oid);
                catBucket.confirmedRevenue += lineTotal;
            } else if (normStatus === 'Dispatched') {
                catBucket.dispatchedOrderIds.add(oid);
                catBucket.dispatchedRevenue += lineTotal;
            } else if (normStatus === 'Delivered') {
                catBucket.deliveredOrderIds.add(oid);
                catBucket.deliveredRevenue += lineTotal;
            } else if (normStatus === 'Cancelled') {
                catBucket.cancelledOrderIds.add(oid);
                catBucket.cancelledRevenue += lineTotal;
            }

            if (normStatus !== 'Cancelled') {
                catBucket.unitsSold += qty;
                catBucket.revenue += lineTotal;
                totalUnitsSold += qty;

                const prodKey = matchedProd?.id ? `id_${matchedProd.id}` : `sku_${item.sku || item.title}`;
                if (!prodSalesMap.has(prodKey)) {
                    prodSalesMap.set(prodKey, {
                        productId: matchedProd?.id || Number(item.productId) || 0,
                        title: matchedProd?.title || item.title || 'Product',
                        sku: matchedProd?.sku || item.sku || '',
                        categorySlug: catSlug,
                        categoryName: catBucket.name,
                        unitsSold: 0,
                        revenue: 0,
                        stock: matchedProd ? matchedProd.stock : null
                    });
                }
                const prodEntry = prodSalesMap.get(prodKey);
                prodEntry.unitsSold += qty;
                prodEntry.revenue += lineTotal;
            }
        }
    }

    const totalOrders = filteredOrdersCount;
    const byStatus = ORDER_STATUSES.map((key) => {
        const b = statusBuckets[key];
        return {
            key: b.key,
            label: b.label,
            count: b.count,
            revenue: b.revenue,
            sharePct: totalOrders > 0 ? Math.round((b.count / totalOrders) * 100) : 0
        };
    });

    const totalCategoryRevenue = Array.from(catMap.values()).reduce((sum, c) => sum + c.revenue, 0);
    const byCategories = Array.from(catMap.values())
        .map((c) => ({
            slug: c.slug,
            name: c.name,
            productCount: c.productCount,
            totalStock: c.totalStock,
            totalOrders: c.orderIds.size,
            pendingOrders: c.pendingOrderIds.size,
            confirmedOrders: c.confirmedOrderIds.size,
            dispatchedOrders: c.dispatchedOrderIds.size,
            deliveredOrders: c.deliveredOrderIds.size,
            cancelledOrders: c.cancelledOrderIds.size,
            unitsSold: c.unitsSold,
            revenue: c.revenue,
            revenueSharePct: totalCategoryRevenue > 0 ? Math.round((c.revenue / totalCategoryRevenue) * 100) : 0,
            pendingRevenue: c.pendingRevenue,
            confirmedRevenue: c.confirmedRevenue,
            dispatchedRevenue: c.dispatchedRevenue,
            deliveredRevenue: c.deliveredRevenue,
            cancelledRevenue: c.cancelledRevenue
        }))
        .sort((a, b) => b.revenue - a.revenue || b.totalOrders - a.totalOrders || b.productCount - a.productCount || a.name.localeCompare(b.name));

    const byCity = Array.from(cityMap.values())
        .sort((a, b) => b.revenue - a.revenue || b.orderCount - a.orderCount);

    const topProducts = Array.from(prodSalesMap.values())
        .sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold)
        .slice(0, 8);

    const pendingCount = statusBuckets['Pending WhatsApp Confirmation'].count;
    const confirmedCount = statusBuckets.Confirmed.count;
    const dispatchedCount = statusBuckets.Dispatched.count;
    const deliveredCount = statusBuckets.Delivered.count;
    const cancelledCount = statusBuckets.Cancelled.count;
    const confirmedPipelineOrders = confirmedCount + dispatchedCount + deliveredCount;
    const confirmedPipelineRevenue =
        statusBuckets.Confirmed.revenue +
        statusBuckets.Dispatched.revenue +
        statusBuckets.Delivered.revenue;

    return {
        summary: {
            totalOrders,
            pendingOrders: pendingCount,
            confirmedOrders: confirmedCount,
            dispatchedOrders: dispatchedCount,
            deliveredOrders: deliveredCount,
            cancelledOrders: cancelledCount,
            confirmedPipelineOrders,
            grossRevenue,
            pendingRevenue: statusBuckets['Pending WhatsApp Confirmation'].revenue,
            confirmedRevenue: statusBuckets.Confirmed.revenue,
            dispatchedRevenue: statusBuckets.Dispatched.revenue,
            deliveredRevenue: statusBuckets.Delivered.revenue,
            cancelledRevenue: statusBuckets.Cancelled.revenue,
            confirmedPipelineRevenue,
            averageOrderValue: nonCancelledCount > 0 ? Math.round(grossRevenue / nonCancelledCount) : 0,
            confirmationRate: totalOrders > 0 ? Math.round((confirmedPipelineOrders / totalOrders) * 100) : 0,
            totalProducts: (products || []).length,
            totalCategories: (categories || []).length,
            totalInventoryStock,
            totalUnitsSold
        },
        byStatus,
        byCategories,
        byCity,
        topProducts
    };
}

function normalizeVariantOptions(
    variantsInput,
    variantPricingInput,
    fallbackOriginalPrice = 0,
    fallbackDiscountPrice = 0,
    fallbackStock = 10
) {
    const baseOrig = Math.max(1, Number(fallbackOriginalPrice) || Number(fallbackDiscountPrice) || 1);
    const baseDisc = Math.max(1, Number(fallbackDiscountPrice) || baseOrig);
    const baseStock = Math.max(0, parseInt(fallbackStock, 10) || 0);

    const pricingByName = new Map();
    if (Array.isArray(variantPricingInput)) {
        for (const row of variantPricingInput) {
            if (!row || typeof row !== 'object') continue;
            const name = String(row.name || row.variant || '').trim();
            if (!name) continue;
            const orig = Math.max(1, Number(row.originalPrice ?? row.price ?? baseOrig) || baseOrig);
            const disc = Math.max(1, Number(row.discountPrice ?? row.salePrice ?? row.price ?? orig) || orig);
            const stock = row.stock !== undefined && row.stock !== ''
                ? Math.max(0, parseInt(row.stock, 10) || 0)
                : baseStock;
            pricingByName.set(name.toLowerCase(), {
                name,
                originalPrice: orig,
                discountPrice: disc,
                discountPercentage: calculateDiscountPercentage(orig, disc),
                stock
            });
        }
    }

    const rawList = Array.isArray(variantsInput)
        ? variantsInput
        : String(variantsInput || '').split(',').map((s) => s.trim()).filter(Boolean);

    const seen = new Set();
    const variantOptions = [];

    for (const item of rawList) {
        if (item && typeof item === 'object') {
            const name = String(item.name || item.variant || '').trim();
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const override = pricingByName.get(name.toLowerCase());
            const orig = override
                ? override.originalPrice
                : Math.max(1, Number(item.originalPrice ?? item.price ?? baseOrig) || baseOrig);
            const disc = override
                ? override.discountPrice
                : Math.max(1, Number(item.discountPrice ?? item.salePrice ?? item.price ?? orig) || orig);
            const stock = override
                ? override.stock
                : (item.stock !== undefined && item.stock !== '' ? Math.max(0, parseInt(item.stock, 10) || 0) : baseStock);
            variantOptions.push({
                name,
                originalPrice: orig,
                discountPrice: disc,
                discountPercentage: calculateDiscountPercentage(orig, disc),
                stock
            });
        } else {
            const name = String(item || '').trim();
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const override = pricingByName.get(name.toLowerCase());
            if (override) {
                variantOptions.push(override);
            } else {
                variantOptions.push({
                    name,
                    originalPrice: baseOrig,
                    discountPrice: baseDisc,
                    discountPercentage: calculateDiscountPercentage(baseOrig, baseDisc),
                    stock: baseStock
                });
            }
        }
    }

    for (const [key, opt] of pricingByName.entries()) {
        if (!seen.has(key)) {
            seen.add(key);
            variantOptions.push(opt);
        }
    }

    if (variantOptions.length === 0) {
        variantOptions.push({
            name: 'Standard',
            originalPrice: baseOrig,
            discountPrice: baseDisc,
            discountPercentage: calculateDiscountPercentage(baseOrig, baseDisc),
            stock: baseStock
        });
    }

    return {
        variantNames: variantOptions.map((v) => v.name),
        variantOptions
    };
}

function resolveProductVariantPrice(product, requestedVariant = '') {
    if (!product) {
        return {
            variant: String(requestedVariant || '').trim(),
            originalPrice: 0,
            discountPrice: 0,
            discountPercentage: 0,
            stock: 0
        };
    }

    const baseOrig = Math.max(1, Number(product.originalPrice) || Number(product.discountPrice) || 1);
    const baseDisc = Math.max(1, Number(product.discountPrice) || baseOrig);
    const baseStock = Math.max(0, parseInt(product.stock, 10) || 0);
    const opts = Array.isArray(product.variantOptions) ? product.variantOptions : [];
    const targetName = String(requestedVariant || '').trim();

    let matched = null;
    if (targetName && opts.length > 0) {
        matched = opts.find((v) => String(v.name || '').trim().toLowerCase() === targetName.toLowerCase()) || null;
    }
    if (!matched && !targetName && opts.length > 0) {
        matched = opts[0];
    }

    if (matched) {
        const orig = Math.max(1, Number(matched.originalPrice) || baseOrig);
        const disc = Math.max(1, Number(matched.discountPrice) || baseDisc);
        return {
            variant: matched.name,
            originalPrice: orig,
            discountPrice: disc,
            discountPercentage: calculateDiscountPercentage(orig, disc),
            stock: matched.stock !== undefined ? Math.max(0, parseInt(matched.stock, 10) || 0) : baseStock
        };
    }

    return {
        variant: targetName || (Array.isArray(product.variants) && product.variants[0]) || '',
        originalPrice: baseOrig,
        discountPrice: baseDisc,
        discountPercentage: calculateDiscountPercentage(baseOrig, baseDisc),
        stock: baseStock
    };
}

module.exports = {
    BOT_BUTTONS,
    WELCOME_MENU_BUTTONS,
    ORDER_STATUSES,
    ALLOWED_ORDER_STATUSES,
    isGreetingMessage,
    normalizeOrderLookupInput,
    normalizeOrderStatus,
    computeStoreAnalytics,
    normalizeVariantOptions,
    resolveProductVariantPrice,
    normalizePakistanWhatsApp,
    calculateDiscountPercentage,
    formatPkr,
    calculateOrderTotals,
    generateOrderId,
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
    formatOrderStatusUpdateMessage,
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
    parseCloudinaryUri,
    normalizeRailwayUrl
};
