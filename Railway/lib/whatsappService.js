'use strict';

const axios = require('axios');
const database = require('./database');
const { sendButtonMessage } = require('./buttonHelper');
const {
    normalizePakistanWhatsApp,
    normalizeOrderLookupInput,
    formatPkr,
    formatOrderTrackingMessage,
    buildMainBotButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward
} = require('./storeLogic');

const inquirySessions = new Map();
const trackSessions = new Map();
let lastCatalogSyncAt = 0;

function getSessionManager() {
    try {
        return require('./sessionManager');
    } catch (_) {
        return null;
    }
}

function toJid(phoneOrJid) {
    const raw = String(phoneOrJid || '').trim();
    if (!raw) return null;
    if (raw.includes('@s.whatsapp.net')) return raw;
    const normalized = normalizePakistanWhatsApp(raw);
    if (normalized.valid) return normalized.jid;
    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
}

function extractTextFromBaileysMessage(msg) {
    let m = msg?.message;
    if (!m || typeof m !== 'object') return '';
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

    if (m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            if (params.id || params.display_text) {
                return String(params.id || params.display_text).trim();
            }
        } catch (_) {}
    }

    return String(
        m.buttonsResponseMessage?.selectedButtonId ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.templateButtonReplyMessage?.selectedId ||
        m.templateButtonReplyMessage?.selectedDisplayText ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.listResponseMessage?.title ||
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ''
    ).trim();
}

function formatWhatsAppProductLines(products = []) {
    return products.map((p, idx) => {
        const discountStr = p.discountPercentage > 0
            ? ` (Was ${formatPkr(p.originalPrice)} • *-${p.discountPercentage}% OFF*)`
            : '';
        const stockStr = p.stock > 0 ? `${p.stock} in stock` : 'Out of Stock';
        const variantLine = Array.isArray(p.variantOptions) && p.variantOptions.length > 1
            ? `\n   Variants: ${p.variantOptions.slice(0, 3).map((v) => `${v.name} (${formatPkr(v.discountPrice)})`).join(' | ')}`
            : '';
        return `${idx + 1}. *${p.title}* (${p.sku})\n   Price: *${formatPkr(p.discountPrice)}*${discountStr} · ${stockStr}${variantLine}`;
    });
}

async function syncCatalogFromMainSite() {
    const { config } = database.getAllVariables();
    if (!config.mainSiteUrl) return;
    if (Date.now() - lastCatalogSyncAt < 20000) return;

    try {
        const res = await axios.get(`${config.mainSiteUrl}/api/store/bootstrap`, { timeout: 5000 });
        if (res.data?.categories || res.data?.products) {
            database.replaceCatalogCache(res.data.categories || [], res.data.products || []);
            lastCatalogSyncAt = Date.now();
        }
    } catch (_) {}
}

async function dispatchMessage(recipient, { text, buttons = [], footer = '', messageType = 'text', quoted = null, socketOverride = null } = {}) {
    const jid = toJid(recipient);
    if (!jid) {
        return { delivered: false, mode: 'invalid_recipient', error: 'Invalid recipient phone number.' };
    }
    const digits = jid.split('@')[0];
    const { config } = database.getAllVariables();
    const resolvedFooter = footer || `${config.storeName} • ${config.storeCity}`;

    let result = { delivered: false, mode: 'standby_recorded', messageId: '' };

    const sm = getSessionManager();
    const sock = socketOverride || sm?.getActiveSocket?.();
    if (sock && typeof sock.sendMessage === 'function') {
        try {
            let sentMsg;
            if (Array.isArray(buttons) && buttons.length > 0) {
                sentMsg = await sendButtonMessage(sock, jid, { text, footer: resolvedFooter, buttons }, quoted);
            } else {
                sentMsg = quoted
                    ? await sock.sendMessage(jid, { text }, { quoted })
                    : await sock.sendMessage(jid, { text });
            }
            result = {
                delivered: true,
                mode: 'railway_baileys',
                messageId: sentMsg?.key?.id || `railway_${Date.now()}`
            };
        } catch (err) {
            result.error = err.message;
        }
    } else {
        result.error = 'No connected WhatsApp device on Railway.';
    }

    database.logWhatsAppEvent({
        direction: 'outbound',
        recipient: `+${digits}`,
        messageType,
        summary: text.slice(0, 1200),
        payload: { text, buttons, mode: result.mode, messageId: result.messageId, error: result.error || null },
        status: result.delivered ? 'delivered' : 'standby_logged'
    });

    return result;
}

async function sendFiveButtonStoreMenu(recipient, customerName = '', sock = null, quoted = null) {
    const { config } = database.getAllVariables();
    const greeting = customerName && customerName !== 'Customer'
        ? `Assalam-o-Alaikum *${customerName}*!`
        : 'Assalam-o-Alaikum!';
    const text = [
        `${greeting} Welcome to *${config.storeName}* (${config.storeCity}).`,
        '',
        'Start shopping or track your order right here on WhatsApp:',
        '• Browse *Items Categories*, *Offered Items*, or *Featured Items*',
        '• Track any COD order by sending *ORD-2026-9336* or *9336*',
        '• Tap *Contact For Inquiry* to message our support desk'
    ].join('\n');

    return await dispatchMessage(recipient, {
        text,
        footer: `${config.storeName} • ${config.storeCity}`,
        buttons: buildMainBotButtons(),
        messageType: 'store_5_buttons',
        quoted,
        socketOverride: sock
    });
}

async function forwardOrderDecisionToMainSite({ senderDigits, senderName, rawText, orderId, decision, sock, quoted }) {
    const { config } = database.getAllVariables();
    const followUpButtons = buildMainBotButtons();

    if (config.mainSiteUrl) {
        try {
            const res = await axios.post(
                `${config.mainSiteUrl}/api/whatsapp/webhook`,
                {
                    from: senderDigits,
                    senderName,
                    buttonId: rawText,
                    text: rawText
                },
                { timeout: 10000 }
            );
            const outcome = res.data?.outcome;
            if (outcome?.replyText) {
                await dispatchMessage(senderDigits, {
                    text: outcome.replyText,
                    footer: `${config.storeName} • ${config.storeCity}`,
                    buttons: outcome.followUpButtons || followUpButtons,
                    messageType: decision === 'Confirmed' ? 'order_confirmed_reply' : 'order_cancelled_reply',
                    quoted,
                    socketOverride: sock
                });
                const adminNorm = normalizePakistanWhatsApp(config.adminWhatsappNumber);
                if (outcome.order && adminNorm.valid) {
                    const updated = outcome.order;
                    await dispatchMessage(adminNorm.digits, {
                        text: [
                            `📦 *Order ${decision.toUpperCase()} — #${updated.orderId}*`,
                            `Customer: ${updated.customerName} (${updated.whatsappNumber})`,
                            `City: ${updated.city}`,
                            `Grand Total (COD): ${formatPkr(updated.grandTotal)}`
                        ].join('\n'),
                        messageType: 'admin_order_alert',
                        socketOverride: sock
                    }).catch(() => {});
                }
                return { found: outcome.found, order: outcome.order, replyText: outcome.replyText, followUpButtons };
            }
        } catch (_) {}
    }

    const fallbackMsg = decision === 'Confirmed'
        ? [
            `✅ *Thank You!* Your order${orderId ? ` *#${orderId}*` : ''} is *CONFIRMED* at *${config.storeName}*.`,
            '',
            '🛍️ *Would you like to start shopping on WhatsApp?*',
            'Tap any button below to browse items, offers, or track your order:'
        ].join('\n')
        : `Your *${decision}* request${orderId ? ` for Order *#${orderId}*` : ''} has been received by ${config.storeName}.`;

    await dispatchMessage(senderDigits, {
        text: fallbackMsg,
        footer: `${config.storeName} • ${config.storeCity}`,
        buttons: followUpButtons,
        messageType: 'order_decision_ack',
        quoted,
        socketOverride: sock
    });
    return { found: false, replyText: fallbackMsg, followUpButtons };
}

async function handleRailwayOrderTracking(cleanDigits, query, config, sock = null, quoted = null) {
    trackSessions.delete(cleanDigits);
    if (!config.mainSiteUrl) {
        return await dispatchMessage(cleanDigits, {
            text: `Order tracking is currently unavailable (MAIN_SITE_URL not linked). Tap *Contact For Inquiry* to check order *${query}*.`,
            buttons: buildMainBotButtons(),
            messageType: 'bot_track_unavailable',
            quoted,
            socketOverride: sock
        });
    }

    try {
        const res = await axios.get(
            `${config.mainSiteUrl}/api/orders/track/${encodeURIComponent(query)}`,
            { timeout: 8000 }
        );
        const order = res.data?.order;
        if (order) {
            return await dispatchMessage(cleanDigits, {
                text: formatOrderTrackingMessage(order, config),
                footer: `${config.storeName} • Order Tracking`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_track_result',
                quoted,
                socketOverride: sock
            });
        }
    } catch (_) {}

    return await dispatchMessage(cleanDigits, {
        text: [
            `🔍 We could not find an order matching *${query}*.`,
            'Please check your Order ID (for example *ORD-2026-9336* or the 4-digit code *9336*) and try again:'
        ].join('\n'),
        buttons: buildMainBotButtons(),
        messageType: 'bot_track_not_found',
        quoted,
        socketOverride: sock
    });
}

async function processIncomingMessage({ senderJid, senderName = 'Customer', rawText = '', sock = null, quoted = null }) {
    const cleanDigits = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanDigits) return { handled: false };

    const { config } = database.getAllVariables();
    const stateKey = cleanDigits;

    database.logWhatsAppEvent({
        direction: 'inbound',
        recipient: `+${cleanDigits}`,
        messageType: 'customer_message',
        summary: rawText.slice(0, 220) || '(empty)',
        payload: { senderName, rawText },
        status: 'received'
    });

    const parsedAction = parseIncomingBotAction(rawText);
    if (parsedAction.type === 'order_decision' || parsedAction.type === 'order_decision_latest') {
        inquirySessions.delete(stateKey);
        trackSessions.delete(stateKey);
        return await forwardOrderDecisionToMainSite({
            senderDigits: cleanDigits,
            senderName,
            rawText,
            orderId: parsedAction.orderId || null,
            decision: parsedAction.decision,
            sock,
            quoted
        });
    }

    const pendingTrack = trackSessions.get(stateKey);
    const isExplicitMenuOrAction = [
        'menu_categories', 'category_detail', 'menu_offers', 'menu_featured',
        'menu_store', 'menu_track', 'menu_inquiry', 'greeting_menu', 'track_order_lookup'
    ].includes(parsedAction.type);

    if (pendingTrack && pendingTrack.step === 'awaiting_order_id' && !isExplicitMenuOrAction) {
        const lookup = normalizeOrderLookupInput(rawText);
        if (lookup.isFullId || lookup.isShortDigits) {
            return await handleRailwayOrderTracking(cleanDigits, lookup.clean, config, sock, quoted);
        }
        return await dispatchMessage(cleanDigits, {
            text: 'Please send your valid Order ID (e.g. *ORD-2026-9336*) or the 4-digit code (e.g. *9336*), or tap *Contact For Inquiry* below.',
            buttons: buildMainBotButtons(),
            messageType: 'bot_track_retry',
            quoted,
            socketOverride: sock
        });
    }

    if (parsedAction.type === 'track_order_lookup') {
        inquirySessions.delete(stateKey);
        return await handleRailwayOrderTracking(cleanDigits, parsedAction.query, config, sock, quoted);
    }

    const pendingInquiry = inquirySessions.get(stateKey);
    if (pendingInquiry && pendingInquiry.step === 'awaiting_description' && parsedAction.type === 'general_message') {
        const description = String(rawText || '').trim();
        if (description.length < 3) {
            return await dispatchMessage(cleanDigits, {
                text: 'Please share a brief description of your inquiry and your name/city so our team can assist you.',
                messageType: 'inquiry_prompt_retry',
                quoted,
                socketOverride: sock
            });
        }

        inquirySessions.delete(stateKey);
        const adminNorm = normalizePakistanWhatsApp(config.adminWhatsappNumber);
        const adminDigits = adminNorm.valid ? adminNorm.digits : '923299931199';

        const savedInquiry = database.recordInquiry({
            senderJid,
            senderNumber: cleanDigits,
            senderName: senderName || pendingInquiry.senderName || 'WhatsApp Customer',
            description,
            forwardedToAdmin: true,
            adminNumber: adminDigits
        });

        if (config.mainSiteUrl) {
            const creds = database.getAdminCredentials();
            axios.post(
                `${config.mainSiteUrl}/api/bridge/inquiry`,
                {
                    senderJid,
                    senderNumber: cleanDigits,
                    senderName: senderName || pendingInquiry.senderName || 'WhatsApp Customer',
                    description,
                    adminNumber: adminDigits
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-username': creds.username,
                        'x-admin-password': creds.password
                    },
                    timeout: 8000
                }
            ).catch(() => {});
        }

        const forwardText = formatAdminInquiryForward({
            senderJid,
            senderNumber: cleanDigits,
            senderName: senderName || pendingInquiry.senderName,
            description,
            createdAt: savedInquiry.createdAt
        }, config);

        await dispatchMessage(adminDigits, {
            text: forwardText,
            messageType: 'admin_inquiry_forward',
            socketOverride: sock
        });

        return await dispatchMessage(cleanDigits, {
            text: [
                `✅ Thank you, *${senderName || 'Valued Customer'}*!`,
                `Your inquiry details have been forwarded to our *${config.storeName}* support desk.`,
                'Our representative will contact you on this WhatsApp number shortly.',
                '',
                'Explore more below or reply anytime to reopen the store menu:'
            ].join('\n'),
            buttons: buildMainBotButtons(),
            messageType: 'inquiry_submitted_ack',
            quoted,
            socketOverride: sock
        });
    }

    await syncCatalogFromMainSite();

    switch (parsedAction.type) {
        case 'menu_categories': {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            const categories = database.getCategories();
            const catLines = categories.map((c, idx) => `${idx + 1}. *${c.name}* (${c.productCount || 0} items) — reply \`cat_${c.slug}\``);
            const catButtons = categories.slice(0, 4).map((c) => ({
                id: `cat_${c.slug}`,
                text: c.name.slice(0, 22)
            }));
            catButtons.push({ id: 'almumtaz_track', text: 'Track Order' });
            catButtons.push({ id: 'almumtaz_inquiry', text: 'Contact For Inquiry' });

            return await dispatchMessage(cleanDigits, {
                text: `📂 *${config.storeName} — Product Categories*\n\n${catLines.join('\n')}\n\nTap a category below or reply with its code to view products & prices:`,
                buttons: catButtons,
                messageType: 'bot_categories',
                quoted,
                socketOverride: sock
            });
        }

        case 'category_detail': {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            const items = database.getProducts({ category: parsedAction.slug }).slice(0, 6);
            if (items.length === 0) {
                return await sendFiveButtonStoreMenu(cleanDigits, senderName, sock, quoted);
            }
            const lines = formatWhatsAppProductLines(items);
            const orderHint = config.storePublicUrl
                ? `\n\nOrder online with COD: ${config.storePublicUrl}`
                : '\n\nTap *Contact For Inquiry* below to reserve any item on WhatsApp!';
            return await dispatchMessage(cleanDigits, {
                text: `📦 *Category Selection — ${config.storeName}*\n\n${lines.join('\n\n')}${orderHint}`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_category_products',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_offers': {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            const offers = database.getProducts({ flashSale: true, sort: 'discount' }).slice(0, 6);
            const lines = formatWhatsAppProductLines(offers);
            const orderHint = config.storePublicUrl
                ? `\n\nShop offers online: ${config.storePublicUrl}`
                : '';
            return await dispatchMessage(cleanDigits, {
                text: `🔥 *Offered Items & Flash Deals — ${config.storeName}*\n\n${lines.join('\n\n')}${orderHint}`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_offered_items',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_featured': {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            const featured = database.getProducts({ featured: true }).slice(0, 6);
            const lines = formatWhatsAppProductLines(featured);
            const orderHint = config.storePublicUrl
                ? `\n\nShop featured gear: ${config.storePublicUrl}`
                : '';
            return await dispatchMessage(cleanDigits, {
                text: `⭐ *Featured Electronics — ${config.storeName}*\n\n${lines.join('\n\n')}${orderHint}`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_featured_items',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_store': {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            const urlText = config.storePublicUrl
                ? `Shop online with Cash on Delivery:\n${config.storePublicUrl}`
                : `Visit our online storefront or showroom at *${config.storeAddress}* (${config.storeCity}).`;
            return await dispatchMessage(cleanDigits, {
                text: `🛍️ *${config.storeName} — Online Storefront*\n\n${urlText}\n\n• 100% Genuine Branded Electronics\n• Cash on Delivery (COD) Across Pakistan\n• Instant WhatsApp Order Verification`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_store_info',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_track': {
            inquirySessions.delete(stateKey);
            trackSessions.set(stateKey, {
                step: 'awaiting_order_id',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(cleanDigits, {
                text: [
                    `📦 *Track Your COD Order — ${config.storeName}*`,
                    'Please reply with your *Order ID* or *4-digit code*:',
                    '• Full Order ID: *ORD-2026-9336*',
                    '• Quick 4-digit code: *9336*'
                ].join('\n'),
                messageType: 'bot_track_ask_id',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_inquiry': {
            trackSessions.delete(stateKey);
            inquirySessions.set(stateKey, {
                step: 'awaiting_description',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(cleanDigits, {
                text: [
                    `📝 *Contact For Inquiry — ${config.storeName}*`,
                    'Please reply with a single message containing:',
                    '1. Your *Full Name* & *City*',
                    '2. Your *Description / Topic* (which appliance, solar system, or order you want to discuss)'
                ].join('\n'),
                messageType: 'bot_inquiry_ask_details',
                quoted,
                socketOverride: sock
            });
        }

        case 'greeting_menu':
        default: {
            inquirySessions.delete(stateKey);
            trackSessions.delete(stateKey);
            return await sendFiveButtonStoreMenu(cleanDigits, senderName, sock, quoted);
        }
    }
}

async function handleIncomingBaileysUpsert(sock, chatUpdate) {
    if (!chatUpdate || !Array.isArray(chatUpdate.messages)) return;

    for (const msg of chatUpdate.messages) {
        try {
            if (!msg?.message || !msg?.key?.remoteJid) continue;
            const jid = msg.key.remoteJid;

            if (jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@g.us') || msg.key.fromMe) {
                continue;
            }

            const rawText = extractTextFromBaileysMessage(msg);
            if (!rawText) continue;

            await processIncomingMessage({
                senderJid: jid,
                senderName: msg.pushName || 'Customer',
                rawText,
                sock,
                quoted: msg
            });
        } catch (err) {
            console.error('[railway-whatsapp] Incoming handler error:', err.message);
        }
    }
}

module.exports = {
    dispatchMessage,
    sendFiveButtonStoreMenu,
    processIncomingMessage,
    handleIncomingBaileysUpsert,
    extractTextFromBaileysMessage
};
