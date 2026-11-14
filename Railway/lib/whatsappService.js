'use strict';

const axios = require('axios');
const database = require('./database');
const { sendButtonMessage } = require('./buttonHelper');
const {
    normalizePakistanWhatsApp,
    formatPkr,
    buildMainBotButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward
} = require('./storeLogic');

const inquirySessions = new Map();
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
    const greeting = customerName ? `Assalam-o-Alaikum *${customerName}*!` : 'Assalam-o-Alaikum!';
    const text = [
        `${greeting} Welcome to *${config.storeName}* (${config.storeCity}).`,
        'Choose an option below to explore categories, flash offers, featured electronics, or submit an inquiry:'
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
                return { found: outcome.found, order: outcome.order, replyText: outcome.replyText };
            }
        } catch (_) {}
    }

    const fallbackMsg = orderId
        ? `Your decision (*${decision}*) for Order *#${orderId}* has been received by ${config.storeName}.`
        : `Your *${decision}* request has been received by ${config.storeName}.`;

    await dispatchMessage(senderDigits, {
        text: fallbackMsg,
        messageType: 'order_decision_ack',
        quoted,
        socketOverride: sock
    });
    return { found: false, replyText: fallbackMsg };
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
                'Reply with any message anytime to reopen the store menu.'
            ].join('\n'),
            messageType: 'inquiry_submitted_ack',
            quoted,
            socketOverride: sock
        });
    }

    await syncCatalogFromMainSite();

    switch (parsedAction.type) {
        case 'menu_categories': {
            inquirySessions.delete(stateKey);
            const categories = database.getCategories();
            const catLines = categories.map((c, idx) => `${idx + 1}. *${c.name}* (${c.productCount || 0} items) — reply \`cat_${c.slug}\``);
            const catButtons = categories.slice(0, 4).map((c) => ({
                id: `cat_${c.slug}`,
                text: c.name.slice(0, 22)
            }));
            catButtons.push({ id: 'almumtaz_inquiry', text: 'Contact For Inquiry' });

            return await dispatchMessage(cleanDigits, {
                text: `📂 *${config.storeName} — Product Categories*\n\n${catLines.join('\n')}\n\nTap a category below or reply with its code:`,
                buttons: catButtons,
                messageType: 'bot_categories',
                quoted,
                socketOverride: sock
            });
        }

        case 'category_detail': {
            inquirySessions.delete(stateKey);
            const items = database.getProducts({ category: parsedAction.slug }).slice(0, 6);
            if (items.length === 0) {
                return await sendFiveButtonStoreMenu(cleanDigits, senderName, sock, quoted);
            }
            const lines = items.map((p, idx) =>
                `${idx + 1}. *${p.title}*\n   Price: *${formatPkr(p.discountPrice)}*` +
                (p.discountPercentage > 0 ? ` ~( ${formatPkr(p.originalPrice)} )~ (-${p.discountPercentage}%)` : '')
            );
            return await dispatchMessage(cleanDigits, {
                text: `📦 *Category Selection*\n\n${lines.join('\n\n')}\n\nSelect an option below:`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_category_products',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_offers': {
            inquirySessions.delete(stateKey);
            const offers = database.getProducts({ flashSale: true, sort: 'discount' }).slice(0, 6);
            const lines = offers.map((p, idx) =>
                `${idx + 1}. *${p.title}*\n   Offer: *${formatPkr(p.discountPrice)}* (Was ${formatPkr(p.originalPrice)} • *-${p.discountPercentage}% OFF*)`
            );
            return await dispatchMessage(cleanDigits, {
                text: `🔥 *Offered Items & Flash Deals — ${config.storeName}*\n\n${lines.join('\n\n')}`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_offered_items',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_featured': {
            inquirySessions.delete(stateKey);
            const featured = database.getProducts({ featured: true }).slice(0, 6);
            const lines = featured.map((p, idx) =>
                `${idx + 1}. *${p.title}*\n   Price: *${formatPkr(p.discountPrice)}* • Stock: ${p.stock > 0 ? `${p.stock} available` : 'Out of Stock'}`
            );
            return await dispatchMessage(cleanDigits, {
                text: `⭐ *Featured Electronics — ${config.storeName}*\n\n${lines.join('\n\n')}`,
                buttons: buildMainBotButtons(),
                messageType: 'bot_featured_items',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_store': {
            inquirySessions.delete(stateKey);
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

        case 'menu_inquiry': {
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

        default: {
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
