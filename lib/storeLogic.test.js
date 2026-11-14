'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizePakistanWhatsApp,
    normalizeOrderLookupInput,
    isGreetingMessage,
    calculateDiscountPercentage,
    calculateOrderTotals,
    generateOrderId,
    formatOrderReceiptText,
    formatOrderConfirmationThanksAndShopPrompt,
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
    normalizeRailwayUrl,
    normalizeOrderStatus,
    computeStoreAnalytics,
    normalizeVariantOptions,
    resolveProductVariantPrice
} = require('./storeLogic');

test('normalizePakistanWhatsApp accepts 03XXXXXXXXX, +923XXXXXXXXX, and 923XXXXXXXXX', () => {
    const local = normalizePakistanWhatsApp('03299931199');
    assert.equal(local.valid, true);
    assert.equal(local.digits, '923299931199');
    assert.equal(local.e164, '+923299931199');
    assert.equal(local.jid, '923299931199@s.whatsapp.net');

    const plus = normalizePakistanWhatsApp('+92 300-1234567');
    assert.equal(plus.valid, true);
    assert.equal(plus.digits, '923001234567');

    const invalid = normalizePakistanWhatsApp('0312');
    assert.equal(invalid.valid, false);
    assert.ok(invalid.error);
});

test('calculateDiscountPercentage computes accurate integer discount percentage', () => {
    assert.equal(calculateDiscountPercentage(10000, 7500), 25);
    assert.equal(calculateDiscountPercentage(24500, 15900), 35);
    assert.equal(calculateDiscountPercentage(5000, 5000), 0);
});

test('calculateOrderTotals computes subtotal, discount savings, city COD shipping, and free threshold', () => {
    const shippingCfg = {
        codFlatRate: 250,
        expressCodRate: 550,
        freeDeliveryThreshold: 35000,
        cityRates: { Hasilpur: 0, Multan: 300, Karachi: 450 }
    };

    const lowTotal = calculateOrderTotals(
        [{ productId: 1, title: 'Fan', quantity: 1, originalPrice: 13500, discountPrice: 10900 }],
        shippingCfg,
        'Multan',
        'standard'
    );
    assert.equal(lowTotal.subtotal, 10900);
    assert.equal(lowTotal.discountTotal, 2600);
    assert.equal(lowTotal.codDeliveryCharges, 300);
    assert.equal(lowTotal.freeDeliveryApplied, false);
    assert.equal(lowTotal.grandTotal, 11200);

    const hasilpurLocal = calculateOrderTotals(
        [{ productId: 1, title: 'Fan', quantity: 1, originalPrice: 13500, discountPrice: 10900 }],
        shippingCfg,
        'Hasilpur',
        'standard'
    );
    assert.equal(hasilpurLocal.codDeliveryCharges, 0);

    const freeThresholdOrder = calculateOrderTotals(
        [{ productId: 2, title: 'Smart TV', quantity: 1, originalPrice: 165000, discountPrice: 132500 }],
        shippingCfg,
        'Karachi',
        'standard'
    );
    assert.equal(freeThresholdOrder.codDeliveryCharges, 0);
    assert.equal(freeThresholdOrder.freeDeliveryApplied, true);
    assert.equal(freeThresholdOrder.grandTotal, 132500);
});

test('buildMainBotButtons returns store shopping, track order, and inquiry buttons with zero Admin Direct button', () => {
    const buttons = buildMainBotButtons();
    assert.equal(buttons.length, 6);
    const texts = buttons.map((b) => b.text);
    assert.deepEqual(texts, [
        'Items Categories',
        'Offered Items',
        'Featured Items',
        'Browse Online Store',
        'Track Order',
        'Contact For Inquiry'
    ]);
    assert.equal(texts.some((t) => /admin\s*direct/i.test(t)), false);
});

test('formatOrderReceiptText & buildOrderConfirmationButtons produce complete COD receipt', () => {
    const orderId = generateOrderId(new Date('2026-06-01T10:00:00Z'), 4242);
    assert.equal(orderId, 'ORD-2026-4242');

    const receipt = formatOrderReceiptText({
        orderId,
        customerName: 'Bilal Ahmed',
        whatsappNumber: '+923299931199',
        shippingAddress: 'Street 4, Satellite Town',
        city: 'Hasilpur',
        nearestLandmark: 'Baldia Park',
        items: [{ title: 'QLED TV 55"', variant: '55-Inch', quantity: 1, lineTotal: 132500 }],
        subtotal: 132500,
        discountTotal: 32500,
        codDeliveryCharges: 0,
        grandTotal: 132500
    });

    assert.match(receipt, /Al-Mumtaz Electronics/);
    assert.match(receipt, /#ORD-2026-4242/);
    assert.match(receipt, /Grand Total \(COD\): Rs\. 132,500/);

    const btns = buildOrderConfirmationButtons(orderId);
    assert.equal(btns.length, 3);
    assert.equal(btns[0].id, 'confirm_order_ORD-2026-4242');
    assert.equal(btns[1].id, 'pay_ORD-2026-4242');
    assert.equal(btns[2].id, 'cancel_order_ORD-2026-4242');
});

test('buildWelcomeMenuButtons & buildProductCardButtons return required interactive buttons & URLs', () => {
    const welcomeBtns = buildWelcomeMenuButtons({ storeUrl: 'https://shop.almumtaz.pk/' });
    const ids = welcomeBtns.map((b) => b.id);
    assert.ok(ids.includes('menu_categories'));
    assert.ok(ids.includes('menu_search'));
    assert.ok(ids.includes('menu_track'));
    assert.ok(ids.includes('menu_pay'));
    const urlBtn = welcomeBtns.find((b) => b.type === 'cta_url');
    assert.equal(urlBtn.url, 'https://shop.almumtaz.pk');

    const cardBtns = buildProductCardButtons(12, { storeUrl: 'https://shop.almumtaz.pk' });
    assert.equal(cardBtns.length, 4);
    assert.equal(cardBtns[0].id, 'buy_12');
    assert.equal(cardBtns[1].id, 'pay_12');
    assert.equal(cardBtns[2].id, 'menu_search');
    assert.equal(cardBtns[3].type, 'cta_url');
});

test('parseIncomingBotAction handles order confirm/cancel, buy/pay/search, greetings, Track Order, and inquiry triggers', () => {
    assert.deepEqual(parseIncomingBotAction('confirm_order_ORD-2026-4242'), {
        type: 'order_decision',
        decision: 'Confirmed',
        orderId: 'ORD-2026-4242'
    });
    assert.deepEqual(parseIncomingBotAction('cancel_order_ORD-2026-4242'), {
        type: 'order_decision',
        decision: 'Cancelled',
        orderId: 'ORD-2026-4242'
    });
    assert.deepEqual(parseIncomingBotAction('buy_1'), { type: 'buy_product', productId: 1 });
    assert.deepEqual(parseIncomingBotAction('pay_1'), { type: 'pay_target', targetId: '1' });
    assert.deepEqual(parseIncomingBotAction('pay_ORD-2026-9336'), { type: 'pay_target', targetId: 'ORD-2026-9336' });
    assert.deepEqual(parseIncomingBotAction('menu_search'), { type: 'menu_search' });
    assert.deepEqual(parseIncomingBotAction('menu_pay'), { type: 'menu_pay' });
    assert.deepEqual(parseIncomingBotAction('search qled tv'), { type: 'search_query', query: 'qled tv' });
    assert.deepEqual(parseIncomingBotAction('almumtaz_track'), { type: 'menu_track' });
    assert.deepEqual(parseIncomingBotAction('Track Order'), { type: 'menu_track' });
    assert.deepEqual(parseIncomingBotAction('track 9336'), { type: 'track_order_lookup', query: '9336' });
    assert.deepEqual(parseIncomingBotAction('ORD-2026-9336'), { type: 'track_order_lookup', query: 'ORD-2026-9336' });
    assert.deepEqual(parseIncomingBotAction('almumtaz_inquiry'), { type: 'menu_inquiry' });
    assert.deepEqual(parseIncomingBotAction('Offered Items'), { type: 'menu_offers' });
    assert.equal(parseIncomingBotAction('Assalamualaikum').type, 'greeting_menu');
    assert.equal(parseIncomingBotAction('Salam').type, 'greeting_menu');
    assert.equal(parseIncomingBotAction('Hey 👋').type, 'greeting_menu');
    assert.equal(parseIncomingBotAction('👋').type, 'greeting_menu');
    assert.equal(parseIncomingBotAction('Hello').type, 'greeting_menu');
    assert.equal(isGreetingMessage('Assalam-o-Alaikum bhai'), true);
    assert.equal(isGreetingMessage('I want 6kW inverter pricing in Hasilpur'), false);
    assert.deepEqual(parseIncomingBotAction('I want 6kW inverter pricing'), {
        type: 'general_message',
        raw: 'I want 6kW inverter pricing'
    });
});

test('normalizeOrderLookupInput & formatOrderConfirmationThanksAndShopPrompt + formatOrderTrackingMessage work cleanly', () => {
    const full = normalizeOrderLookupInput('#ord-2026-9336');
    assert.equal(full.clean, 'ORD-2026-9336');
    assert.equal(full.isFullId, true);
    assert.equal(full.isShortDigits, false);

    const short = normalizeOrderLookupInput('9336');
    assert.equal(short.clean, '9336');
    assert.equal(short.isFullId, false);
    assert.equal(short.isShortDigits, true);

    const sampleOrder = {
        orderId: 'ORD-2026-9336',
        customerName: 'Bilal Tariq',
        whatsappNumber: '+923299931199',
        shippingAddress: 'Street 7, Model Town',
        city: 'Hasilpur',
        orderStatus: 'Confirmed',
        grandTotal: 145000,
        items: [{ title: '6kW Solar Inverter', variant: '6kW MPPT', quantity: 1, lineTotal: 145000 }]
    };

    const thanksMsg = formatOrderConfirmationThanksAndShopPrompt(sampleOrder);
    assert.match(thanksMsg, /Thank You, Bilal Tariq/);
    assert.match(thanksMsg, /#ORD-2026-9336/);
    assert.match(thanksMsg, /9336/);
    assert.match(thanksMsg, /start shopping on WhatsApp/i);

    const trackMsg = formatOrderTrackingMessage(sampleOrder);
    assert.match(trackMsg, /ORD-2026-9336/);
    assert.match(trackMsg, /Quick Code: \*9336\*/);
    assert.match(trackMsg, /Confirmed/);
});

test('formatAdminInquiryForward includes sender details and inquiry description', () => {
    const msg = formatAdminInquiryForward({
        senderNumber: '923001112233',
        senderName: 'Usman Khan',
        senderJid: '923001112233@s.whatsapp.net',
        description: 'Need pricing for 6kW Solar Inverter installation in Hasilpur',
        createdAt: '2026-11-14T06:00:00Z'
    });
    assert.match(msg, /Usman Khan/);
    assert.match(msg, /\+923001112233/);
    assert.match(msg, /6kW Solar Inverter/);
});

test('verifyAdminCredentials validates matching username/password safely and rejects invalid credentials', () => {
    assert.equal(verifyAdminCredentials('admin', 'AlMumtaz@2026', 'admin', 'AlMumtaz@2026'), true);
    assert.equal(verifyAdminCredentials(' admin ', 'AlMumtaz@2026', 'admin', 'AlMumtaz@2026'), true);
    assert.equal(verifyAdminCredentials('admin', 'wrongpass', 'admin', 'AlMumtaz@2026'), false);
    assert.equal(verifyAdminCredentials('other', 'AlMumtaz@2026', 'admin', 'AlMumtaz@2026'), false);
    assert.equal(verifyAdminCredentials('', '', 'admin', 'AlMumtaz@2026'), false);
    assert.equal(verifyAdminCredentials('admin', 'AlMumtaz@2026', '', ''), false);
});

test('generateAdminToken generates unique prefixed hex session tokens', () => {
    const t1 = generateAdminToken();
    const t2 = generateAdminToken();
    assert.match(t1, /^adm_[a-f0-9]{64}$/);
    assert.match(t2, /^adm_[a-f0-9]{64}$/);
    assert.notEqual(t1, t2);
});

test('parseCloudinaryUri parses valid cloudinary:// URIs and rejects invalid ones', () => {
    const ok = parseCloudinaryUri('cloudinary://123456789:secretKeyHere@almumtazcloud');
    assert.equal(ok.valid, true);
    assert.equal(ok.apiKey, '123456789');
    assert.equal(ok.apiSecret, 'secretKeyHere');
    assert.equal(ok.cloudName, 'almumtazcloud');

    assert.equal(parseCloudinaryUri('').valid, false);
    assert.equal(parseCloudinaryUri('https://example.com').valid, false);
    assert.equal(parseCloudinaryUri('cloudinary://onlykey@cloud').valid, false);
});

test('normalizeRailwayUrl normalizes https:// URLs and strips trailing slashes', () => {
    assert.equal(normalizeRailwayUrl('https://almumtaz-bot.up.railway.app/'), 'https://almumtaz-bot.up.railway.app');
    assert.equal(normalizeRailwayUrl('almumtaz-bot.up.railway.app///'), 'https://almumtaz-bot.up.railway.app');
    assert.equal(normalizeRailwayUrl('  '), '');
});

test('computeStoreAnalytics & normalizeOrderStatus map ACCEPTED/CANCELLED/Shipped cleanly', () => {
    assert.equal(normalizeOrderStatus('ACCEPTED'), 'Confirmed');
    assert.equal(normalizeOrderStatus('CANCELLED'), 'Cancelled');
    assert.equal(normalizeOrderStatus('Shipped'), 'Dispatched');
    assert.equal(normalizeOrderStatus('Dispatched'), 'Dispatched');

    const card = formatProductWhatsAppCard({
        id: 1,
        title: '55" QLED Smart TV',
        sku: 'AME-TV-55',
        originalPrice: 165000,
        discountPrice: 132500,
        discountPercentage: 20,
        stock: 9
    }, { storeUrl: 'https://shop.almumtaz.pk' });
    assert.match(card, /55" QLED Smart TV/);
    assert.match(card, /Rs\. 132,500/);

    const payMsg = formatPaymentOptionsMessage({ storeUrl: 'https://shop.almumtaz.pk' }, { orderId: 'ORD-2026-9336', grandTotal: 55000 });
    assert.match(payMsg, /ORD-2026-9336/);
    assert.match(payMsg, /track\/ORD-2026-9336/);

    const categories = [
        { slug: 'smart-tvs', name: 'Smart TVs' },
        { slug: 'solar-inverters', name: 'Solar Inverters' }
    ];
    const products = [
        { id: 1, title: '55" QLED TV', sku: 'TV-55', categorySlug: 'smart-tvs', stock: 5 },
        { id: 2, title: '6kW Inverter', sku: 'SOL-6', categorySlug: 'solar-inverters', stock: 3 }
    ];
    const orders = [
        {
            orderId: 'ORD-1',
            city: 'Hasilpur',
            orderStatus: 'Confirmed',
            grandTotal: 100000,
            items: [{ productId: 1, title: '55" QLED TV', quantity: 1, lineTotal: 100000 }]
        },
        {
            orderId: 'ORD-2',
            city: 'Multan',
            orderStatus: 'Dispatched',
            grandTotal: 200000,
            items: [{ productId: 2, title: '6kW Inverter', quantity: 1, lineTotal: 200000 }]
        },
        {
            orderId: 'ORD-3',
            city: 'Hasilpur',
            orderStatus: 'Delivered',
            grandTotal: 50000,
            items: [{ productId: 1, title: '55" QLED TV', quantity: 2, lineTotal: 50000 }]
        },
        {
            orderId: 'ORD-4',
            city: 'Lahore',
            orderStatus: 'Shipped',
            grandTotal: 40000,
            items: [{ productId: 1, title: '55" QLED TV', quantity: 1, lineTotal: 40000 }]
        },
        {
            orderId: 'ORD-5',
            city: 'Karachi',
            orderStatus: 'Cancelled',
            grandTotal: 90000,
            items: [{ productId: 2, title: '6kW Inverter', quantity: 1, lineTotal: 90000 }]
        }
    ];

    const report = computeStoreAnalytics({ orders, products, categories });
    assert.equal(report.summary.totalOrders, 5);
    assert.equal(report.summary.confirmedOrders, 1);
    assert.equal(report.summary.dispatchedOrders, 2);
    assert.equal(report.summary.deliveredOrders, 1);
    assert.equal(report.summary.cancelledOrders, 1);
    assert.equal(report.summary.grossRevenue, 390000);
    assert.equal(report.summary.deliveredRevenue, 50000);
    assert.equal(report.summary.confirmationRate, 80);

    const solar = report.byCategories.find((c) => c.slug === 'solar-inverters');
    assert.equal(solar.dispatchedOrders, 1);
    assert.equal(solar.cancelledOrders, 1);
    assert.equal(solar.revenue, 200000);
    assert.equal(solar.unitsSold, 1);

    const tv = report.byCategories.find((c) => c.slug === 'smart-tvs');
    assert.equal(tv.confirmedOrders, 1);
    assert.equal(tv.dispatchedOrders, 1);
    assert.equal(tv.deliveredOrders, 1);
    assert.equal(tv.unitsSold, 4);
    assert.equal(tv.revenue, 190000);

    const filteredTv = computeStoreAnalytics({ orders, products, categories, filterCategory: 'smart-tvs' });
    assert.equal(filteredTv.summary.totalOrders, 3);
    assert.equal(filteredTv.summary.grossRevenue, 190000);
});

test('normalizeVariantOptions and resolveProductVariantPrice handle distinct per-variant prices and fallback cleanly', () => {
    const normalized = normalizeVariantOptions(
        ['43-Inch 4K UHD', '55-Inch QLED', '65-Inch QLED'],
        [
            { name: '43-Inch 4K UHD', originalPrice: 120000, discountPrice: 99000, stock: 8 },
            { name: '65-Inch QLED', originalPrice: 230000, discountPrice: 192000, stock: 4 }
        ],
        165000,
        132500,
        14
    );

    assert.deepEqual(normalized.variantNames, ['43-Inch 4K UHD', '55-Inch QLED', '65-Inch QLED']);
    assert.equal(normalized.variantOptions[0].discountPrice, 99000);
    assert.equal(normalized.variantOptions[0].discountPercentage, 18);
    assert.equal(normalized.variantOptions[1].discountPrice, 132500);
    assert.equal(normalized.variantOptions[2].originalPrice, 230000);
    assert.equal(normalized.variantOptions[2].discountPrice, 192000);
    assert.equal(normalized.variantOptions[2].stock, 4);

    const product = {
        originalPrice: 165000,
        discountPrice: 132500,
        stock: 14,
        variants: normalized.variantNames,
        variantOptions: normalized.variantOptions
    };

    const sixtyFive = resolveProductVariantPrice(product, '65-Inch QLED');
    assert.equal(sixtyFive.variant, '65-Inch QLED');
    assert.equal(sixtyFive.originalPrice, 230000);
    assert.equal(sixtyFive.discountPrice, 192000);
    assert.equal(sixtyFive.stock, 4);

    const fallback = resolveProductVariantPrice(product, 'Unknown Edition');
    assert.equal(fallback.originalPrice, 165000);
    assert.equal(fallback.discountPrice, 132500);
});


