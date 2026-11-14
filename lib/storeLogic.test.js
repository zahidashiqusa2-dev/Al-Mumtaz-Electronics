'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizePakistanWhatsApp,
    calculateDiscountPercentage,
    calculateOrderTotals,
    generateOrderId,
    formatOrderReceiptText,
    buildOrderConfirmationButtons,
    buildMainBotButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward,
    verifyAdminCredentials,
    generateAdminToken,
    parseCloudinaryUri,
    normalizeRailwayUrl
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

test('buildMainBotButtons returns strictly 5 store buttons with zero Admin Direct button', () => {
    const buttons = buildMainBotButtons();
    assert.equal(buttons.length, 5);
    const texts = buttons.map((b) => b.text);
    assert.deepEqual(texts, [
        'Items Categories',
        'Offered Items',
        'Featured Items',
        'Browse Online Store',
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
    assert.equal(btns.length, 2);
    assert.equal(btns[0].id, 'confirm_order_ORD-2026-4242');
    assert.equal(btns[1].id, 'cancel_order_ORD-2026-4242');
});

test('parseIncomingBotAction handles order confirm/cancel, 5-button actions, and inquiry triggers', () => {
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
    assert.deepEqual(parseIncomingBotAction('almumtaz_inquiry'), { type: 'menu_inquiry' });
    assert.deepEqual(parseIncomingBotAction('Offered Items'), { type: 'menu_offers' });
    assert.deepEqual(parseIncomingBotAction('Hello'), { type: 'general_message', raw: 'Hello' });
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


