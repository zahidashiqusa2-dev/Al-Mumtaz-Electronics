'use strict';

const axios = require('axios');
const database = require('./database');
const { sendInteractiveMessage } = require('./buttonHelper');
const {
    normalizePakistanWhatsApp,
    normalizeOrderLookupInput,
    calculateOrderTotals,
    resolveProductVariantPrice,
    generateOrderId,
    formatPkr,
    buildStoreBaseUrl,
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
    buildWelcomeMenuButtons,
    buildProductCardButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward
} = require('./storeLogic');

// Per-customer conversation states
const inquirySessions = new Map();
const trackSessions = new Map();
const searchSessions = new Map();
const checkoutSessions = new Map();

function clearCustomerSessions(stateKey, except = '') {
    if (except !== 'inquiry') inquirySessions.delete(stateKey);
    if (except !== 'track') trackSessions.delete(stateKey);
    if (except !== 'search') searchSessions.delete(stateKey);
    if (except !== 'checkout') checkoutSessions.delete(stateKey);
}

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
    const cleaned = raw.replace(/:\d+@/, '@');
    if (cleaned.endsWith('@s.whatsapp.net') || cleaned.endsWith('@lid')) {
        return cleaned;
    }
    const normalized = normalizePakistanWhatsApp(cleaned);
    if (normalized.valid) return normalized.jid;
    const digits = cleaned.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
}

function unwrapBaileysMessageContent(msg) {
    let m = msg?.message;
    if (!m || typeof m !== 'object') return null;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
    if (m.editedMessage?.message?.protocolMessage?.editedMessage) {
        m = m.editedMessage.message.protocolMessage.editedMessage;
    } else if (m.editedMessage?.message) {
        m = m.editedMessage.message;
    }
    return m;
}

function extractTextFromBaileysMessage(msg) {
    const m = unwrapBaileysMessageContent(msg);
    if (!m) return '';

    if (m.templateButtonReplyMessage?.selectedId || m.templateButtonReplyMessage?.selectedDisplayText) {
        return String(m.templateButtonReplyMessage.selectedId || m.templateButtonReplyMessage.selectedDisplayText).trim();
    }

    if (m.buttonsResponseMessage?.selectedButtonId || m.buttonsResponseMessage?.selectedDisplayText) {
        return String(m.buttonsResponseMessage.selectedButtonId || m.buttonsResponseMessage.selectedDisplayText).trim();
    }

    const interactiveRes =
        m.interactiveResponseMessage ||
        m.viewOnceMessage?.message?.interactiveResponseMessage ||
        m.viewOnceMessageV2?.message?.interactiveResponseMessage;
    if (interactiveRes?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(interactiveRes.nativeFlowResponseMessage.paramsJson);
            if (params.id || params.display_text) {
                return String(params.id || params.display_text).trim();
            }
        } catch (_) {}
    }

    if (m.productMessage?.product?.title) {
        return `__catalog_product__:${m.productMessage.product.title}`;
    }
    if (m.orderMessage?.orderId || m.orderMessage?.orderTitle) {
        return `__catalog_order__:${m.orderMessage.orderTitle || m.orderMessage.orderId}`;
    }

    return String(
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.listResponseMessage?.title ||
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ''
    ).trim();
}

function extractCatalogPayload(msg) {
    const m = unwrapBaileysMessageContent(msg);
    if (!m) return null;
    if (m.productMessage?.product) {
        return {
            kind: 'product',
            title: m.productMessage.product.title || '',
            productId: m.productMessage.product.productId || '',
            retailerId: m.productMessage.product.retailerId || ''
        };
    }
    if (m.orderMessage) {
        return {
            kind: 'order',
            orderId: m.orderMessage.orderId || '',
            orderTitle: m.orderMessage.orderTitle || '',
            itemCount: Number(m.orderMessage.itemCount || 1),
            totalAmount1000: Number(m.orderMessage.totalAmount1000 || 0)
        };
    }
    return null;
}

function inferCityFromAddress(addressText, config = {}) {
    const lower = String(addressText || '').toLowerCase();
    const cityKeys = Object.keys(config.cityRates || {});
    for (const c of cityKeys) {
        if (lower.includes(c.toLowerCase())) {
            return c;
        }
    }
    return config.storeCity || 'Hasilpur';
}

/**
 * Forward outbound WhatsApp dispatches to 24/7 Railway Backend when Railway_URL is configured
 */
async function sendViaRailwayBridge(recipientTarget, { title = '', text, buttons = [], lists = [], footer = '', imageUrl = '', messageType = 'text' }, config = {}) {
    if (!config.railwayUrl || process.env.IS_RAILWAY_BACKEND === 'true') {
        return { delivered: false };
    }

    const creds = database.getAdminCredentials();
    const res = await axios.post(
        `${config.railwayUrl}/api/bridge/send`,
        { recipient: recipientTarget, title, text, buttons, lists, footer, imageUrl, messageType },
        {
            headers: {
                'Content-Type': 'application/json',
                'x-admin-username': creds.username,
                'x-admin-password': creds.password,
                ...(config.apiSecretKey ? { 'x-api-secret': config.apiSecretKey } : {})
            },
            timeout: 15000
        }
    );

    if (res.data?.delivered) {
        return {
            delivered: true,
            mode: 'railway_baileys',
            messageId: res.data.messageId || `railway_${Date.now()}`
        };
    }
    return { delivered: false, error: res.data?.error || 'Railway WhatsApp device not connected.' };
}

/**
 * Unified Baileys interactive message dispatcher (prefers 24/7 Railway_URL bridge when configured,
 * otherwise uses local connected Baileys socket, with full DB audit log).
 */
async function dispatchMessage(recipient, {
    title = '',
    text,
    buttons = [],
    lists = [],
    footer = '',
    imageUrl = '',
    messageType = 'text',
    quoted = null,
    socketOverride = null
} = {}) {
    const jid = toJid(recipient);
    if (!jid) {
        return { delivered: false, mode: 'invalid_recipient', error: 'Invalid recipient phone number.' };
    }
    const digits = jid.split('@')[0].split(':')[0];
    const bridgeRecipient = jid.endsWith('@lid') ? jid : digits;
    const { config } = database.getAllVariables();
    const resolvedFooter = footer || `${config.storeName} • ${config.storeCity}`;

    let result = { delivered: false, mode: 'standby_recorded', messageId: '' };

    // 1. If Railway_URL is configured on the main site, dispatch via 24/7 Railway Baileys Bot
    if (!socketOverride && config.railwayUrl && process.env.IS_RAILWAY_BACKEND !== 'true') {
        try {
            const bridgeRes = await sendViaRailwayBridge(
                bridgeRecipient,
                { title, text, buttons, lists, footer: resolvedFooter, imageUrl, messageType },
                config
            );
            if (bridgeRes.delivered) {
                result = bridgeRes;
            } else if (bridgeRes.error) {
                result.error = bridgeRes.error;
            }
        } catch (err) {
            result.error = err.response?.data?.error || err.message;
        }
    }

    // 2. Otherwise use local active Baileys socket if connected
    if (!result.delivered) {
        const sm = getSessionManager();
        const sock = socketOverride || sm?.getActiveSocket?.();
        if (sock && typeof sock.sendMessage === 'function') {
            try {
                let sentMsg;
                const hasInteractive = (Array.isArray(buttons) && buttons.length > 0) || (Array.isArray(lists) && lists.length > 0);
                if (hasInteractive) {
                    sentMsg = await sendInteractiveMessage(sock, jid, {
                        title,
                        text,
                        footer: resolvedFooter,
                        buttons,
                        lists,
                        imageUrl,
                        storeBaseUrl: buildStoreBaseUrl(config)
                    }, quoted);
                } else {
                    sentMsg = quoted
                        ? await sock.sendMessage(jid, { text }, { quoted })
                        : await sock.sendMessage(jid, { text });
                }
                result = {
                    delivered: true,
                    mode: 'baileys',
                    messageId: sentMsg?.key?.id || `baileys_${Date.now()}`
                };
            } catch (err) {
                result.error = err.message;
            }
        }
    }

    database.logWhatsAppEvent({
        direction: 'outbound',
        recipient: `+${digits}`,
        messageType,
        summary: String(text || '').slice(0, 1200),
        payload: {
            title,
            text,
            buttons,
            lists,
            imageUrl,
            mode: result.mode,
            messageId: result.messageId,
            error: result.error || null
        },
        status: result.delivered ? 'delivered' : 'standby_logged'
    });

    return result;
}

/**
 * Send the interactive Al-Mumtaz Electronics Welcome Menu (Categories, Search, Track, Pay, Offers, Inquiry, Store Link).
 * No .menu, no .ping, no songs, no Admin Direct button.
 */
async function sendFiveButtonStoreMenu(recipient, customerName = '', sock = null, quoted = null) {
    const { config } = database.getAllVariables();
    const greeting = customerName && customerName !== 'Customer'
        ? `Assalam-o-Alaikum *${customerName}*!`
        : 'Assalam-o-Alaikum!';

    const text = [
        `${greeting} Welcome to *${config.storeName}* (${config.storeCity}).`,
        '',
        formatSiteDetailsSummary(config),
        '',
        'Choose a button or open *Store Menu* below to shop, search, pay, track orders, or view showroom & solar info:',
        '• Tap *Browse Categories* or *Search Products* to view live items & order in chat',
        '• Send *ORD-2026-9336* or *9336* anytime to track delivery status',
        '• Tap *Contact For Inquiry* to message our showroom team'
    ].join('\n');

    return await dispatchMessage(recipient, {
        title: `${config.storeName} • ${config.storeCity}`,
        text,
        footer: `Helpline: ${config.storePhone || '03299931199'} • COD Nationwide`,
        buttons: buildWelcomeMenuButtons(config),
        lists: buildWelcomeStoreMenuLists(config),
        messageType: 'store_welcome_menu',
        quoted,
        socketOverride: sock
    });
}

async function sendProductCardsList(recipientTarget, items, headingText, config, sock = null, quoted = null) {
    if (!Array.isArray(items) || items.length === 0) {
        return await dispatchMessage(recipientTarget, {
            title: 'No Matching Products',
            text: `${headingText}\n\nNo items found right now. Try searching another keyword or browse our categories below:`,
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_products_empty',
            quoted,
            socketOverride: sock
        });
    }

    const storeUrl = buildStoreBaseUrl(config);
    const cards = items.slice(0, 4);

    // Send summary header when returning multiple cards
    await dispatchMessage(recipientTarget, {
        title: headingText,
        text: `Showing ${cards.length} item(s) from *${config.storeName}*. Tap *Order Now (COD)* or *Pay Online* on any item card, or shop full catalog at ${storeUrl}`,
        buttons: [
            { id: 'menu_search', text: '🔍 Search Another Item', type: 'quick_reply' },
            { id: 'menu_categories', text: '🛍️ Browse Categories', type: 'quick_reply' },
            { id: 'menu_pay', text: '💳 Pay Now', type: 'quick_reply' }
        ],
        messageType: 'bot_products_intro',
        quoted,
        socketOverride: sock
    });

    for (const p of cards) {
        const cardText = formatProductWhatsAppCard(p, config);
        await dispatchMessage(recipientTarget, {
            title: p.title,
            text: cardText,
            imageUrl: p.images?.[0] || '',
            footer: `${config.storeName} • Cash on Delivery`,
            buttons: buildProductCardButtons(p.id, config),
            messageType: 'bot_product_card',
            socketOverride: sock
        });
    }

    return { handled: true, count: cards.length };
}

/**
 * Automated COD Order Receipt + Confirm / Pay Now / Cancel Buttons sent after checkout.
 */
async function sendOrderConfirmationPrompt(order) {
    const { config } = database.getAllVariables();
    const receiptText = formatOrderReceiptText(order, config);
    const buttons = buildOrderConfirmationButtons(order.orderId);

    const dispatchRes = await dispatchMessage(order.whatsappDigits || order.customerPhone || order.whatsappNumber, {
        title: `COD Order #${order.orderId}`,
        text: receiptText,
        footer: `${config.storeName} • Cash on Delivery Verification`,
        buttons,
        messageType: 'cod_order_confirmation'
    });

    if (order.orderId && database.getOrderById(order.orderId)) {
        database.updateOrderStatus(order.orderId, order.orderStatus, {
            whatsappMessageId: dispatchRes.messageId || '',
            whatsappDispatchMode: dispatchRes.mode || 'standby_recorded'
        });
    }

    return {
        ...dispatchRes,
        receiptText,
        buttons
    };
}

/**
 * Process customer's Confirm or Cancel/Reject response.
 * When confirmed, sends an automatic thank-you receipt + clickable track URL + interactive welcome menu.
 */
async function processOrderDecision(orderId, decision, senderDigits = '', sock = null, quoted = null, replyTarget = '') {
    const cleanDecision = decision === 'Confirmed' ? 'Confirmed' : 'Cancelled';
    let order = orderId ? database.getOrderById(orderId) : null;

    if (!order && senderDigits) {
        order = database.getLatestPendingOrderByDigits(senderDigits);
    }

    if (!order) {
        return {
            found: false,
            replyText: 'We could not find an active pending order matching that reference. Please check your Order ID or tap Contact For Inquiry.'
        };
    }

    const updated = database.updateOrderStatus(order.orderId, cleanDecision);
    const { config } = database.getAllVariables();
    const followUpButtons = buildWelcomeMenuButtons(config);

    const replyText = cleanDecision === 'Confirmed'
        ? formatOrderConfirmationThanksAndShopPrompt(updated, config)
        : formatOrderRejectionApologyMessage(updated, config);

    await dispatchMessage(replyTarget || updated.whatsappDigits || senderDigits, {
        title: cleanDecision === 'Confirmed' ? `Order #${updated.orderId} Confirmed` : `Order #${updated.orderId} Cancelled / Rejected`,
        text: replyText,
        footer: `${config.storeName} • ${config.storeCity}`,
        buttons: followUpButtons,
        lists: buildWelcomeStoreMenuLists(config),
        messageType: cleanDecision === 'Confirmed' ? 'order_confirmed_reply' : 'order_cancelled_reply',
        quoted,
        socketOverride: sock
    });

    // Notify Admin_Whatsapp when an order is confirmed/cancelled
    const adminNorm = normalizePakistanWhatsApp(config.adminWhatsappNumber);
    if (adminNorm.valid) {
        const adminNotice = [
            `📦 *Order ${cleanDecision.toUpperCase()} — #${updated.orderId}*`,
            `Customer: ${updated.customerName} (${updated.whatsappNumber})`,
            `City: ${updated.city}`,
            `Grand Total (COD): ${formatPkr(updated.grandTotal)}`
        ].join('\n');
        await dispatchMessage(adminNorm.digits, {
            text: adminNotice,
            messageType: 'admin_order_alert',
            socketOverride: sock
        }).catch(() => {});
    }

    return { found: true, order: updated, replyText, followUpButtons };
}

/**
 * Send automatic WhatsApp Thank You / Apology / Dispatch / Delivery notification
 * whenever order status changes in /admin or via external REST API.
 */
async function sendOrderStatusNotification(order) {
    if (!order || !(order.whatsappDigits || order.whatsappNumber)) {
        return { delivered: false, mode: 'invalid_recipient' };
    }
    const { config } = database.getAllVariables();
    const status = String(order.orderStatus || '');
    const title =
        status === 'Confirmed' ? `Order #${order.orderId} Confirmed`
        : status === 'Cancelled' ? `Order #${order.orderId} Cancelled / Rejected`
        : status === 'Dispatched' ? `Order #${order.orderId} Dispatched`
        : status === 'Delivered' ? `Order #${order.orderId} Delivered`
        : `Order #${order.orderId} Update`;

    const messageType =
        status === 'Confirmed' ? 'order_confirmed_reply'
        : status === 'Cancelled' ? 'order_cancelled_reply'
        : status === 'Dispatched' ? 'order_dispatched_update'
        : status === 'Delivered' ? 'order_delivered_update'
        : 'order_status_update';

    return await dispatchMessage(order.whatsappDigits || order.whatsappNumber, {
        title,
        text: formatOrderStatusUpdateMessage(order, config),
        footer: `${config.storeName} • ${config.storeCity}`,
        buttons: buildWelcomeMenuButtons(config),
        lists: buildWelcomeStoreMenuLists(config),
        messageType
    });
}

async function handleOrderTrackingReply(cleanDigits, query, config, sock = null, quoted = null, replyTarget = '') {
    trackSessions.delete(cleanDigits);
    const target = replyTarget || cleanDigits;
    const storeUrl = buildStoreBaseUrl(config);
    const order = database.getOrderById(query);
    if (!order) {
        return await dispatchMessage(target, {
            title: 'Order Not Found',
            text: [
                `🔍 We could not find an order matching *${query}*.`,
                'Please check your Order ID (for example *ORD-2026-9336* or the 4-digit code *9336*) and try again, or choose an option below:'
            ].join('\n'),
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_track_not_found',
            quoted,
            socketOverride: sock
        });
    }

    const buttons = [
        { id: 'track_online_url', text: '📦 Track on Website', type: 'cta_url', url: `${storeUrl}/track/${order.orderId}` },
        ...buildWelcomeMenuButtons(config).slice(0, 4)
    ];

    return await dispatchMessage(target, {
        title: `Order #${order.orderId} Status`,
        text: formatOrderTrackingMessage(order, config),
        footer: `${config.storeName} • Order Tracking`,
        buttons,
        messageType: 'bot_track_result',
        quoted,
        socketOverride: sock
    });
}

async function sendCategoriesInteractiveMenu(recipientTarget, config, sock = null, quoted = null) {
    const categories = database.getCategories();
    const storeUrl = buildStoreBaseUrl(config);
    const catLines = categories.map((c, idx) => `${idx + 1}. *${c.name}* (${c.productCount || 0} items) — reply \`cat_${c.slug}\``);

    const lists = categories.length > 0
        ? [{
            title: '🛍️ Browse Categories',
            sections: [{
                title: 'Store Departments',
                rows: categories.map((c) => ({
                    id: `cat_${c.slug}`,
                    title: c.name,
                    description: `${c.productCount || 0} products in stock`
                }))
            }]
        }]
        : [];

    const buttons = [
        { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
        { id: 'menu_pay', text: '💳 Pay Now', type: 'quick_reply' },
        { id: 'visit_store_url', text: '🌐 Visit Store', type: 'cta_url', url: storeUrl }
    ];

    return await dispatchMessage(recipientTarget, {
        title: `${config.storeName} — Categories`,
        text: `📂 *${config.storeName} — Live Product Categories*\n\n${catLines.join('\n')}\n\nSelect a department from the list or reply with its code to view products & order via COD:`,
        footer: `${config.storeName} • ${config.storeCity}`,
        lists,
        buttons,
        messageType: 'bot_categories',
        quoted,
        socketOverride: sock
    });
}

async function handleInChatCheckoutStep(cleanDigits, senderName, rawText, session, config, sock, quoted, replyTarget = '') {
    const target = replyTarget || cleanDigits;
    const text = String(rawText || '').trim();
    if (/^(?:cancel|stop|exit|menu)$/i.test(text)) {
        checkoutSessions.delete(cleanDigits);
        return await sendFiveButtonStoreMenu(target, senderName, sock, quoted);
    }

    const product = database.getProductBySlugOrId(session.productId);
    if (!product) {
        checkoutSessions.delete(cleanDigits);
        return await sendFiveButtonStoreMenu(target, senderName, sock, quoted);
    }

    if (session.step === 'awaiting_name') {
        if (text.length < 2) {
            return await dispatchMessage(target, {
                text: 'Please reply with your *Full Name* to place your COD order (or type *cancel* to exit):',
                messageType: 'bot_checkout_retry_name',
                quoted,
                socketOverride: sock
            });
        }
        checkoutSessions.set(cleanDigits, {
            ...session,
            step: 'awaiting_address',
            customerName: text
        });
        return await dispatchMessage(target, {
            title: 'Step 2 of 2: Delivery Address',
            text: `Thanks, *${text}*! Now please reply with your *Complete Delivery Address & City* (e.g. *House 14, Model Town, Hasilpur*):`,
            messageType: 'bot_checkout_ask_address',
            quoted,
            socketOverride: sock
        });
    }

    if (session.step === 'awaiting_address') {
        if (text.length < 5) {
            return await dispatchMessage(target, {
                text: 'Please share a complete street address and city so our courier can deliver your parcel:',
                messageType: 'bot_checkout_retry_address',
                quoted,
                socketOverride: sock
            });
        }

        checkoutSessions.delete(cleanDigits);
        const city = inferCityFromAddress(text, config);
        const resolved = resolveProductVariantPrice(product, session.variant || '');
        const totals = calculateOrderTotals([{
            productId: product.id,
            title: product.title,
            sku: product.sku,
            variant: resolved.variant || product.variants?.[0] || 'Standard',
            quantity: session.quantity || 1,
            originalPrice: resolved.originalPrice,
            discountPrice: resolved.discountPrice,
            image: product.images?.[0] || ''
        }], config, city, 'standard');

        let orderId = generateOrderId();
        while (database.getOrderById(orderId)) {
            orderId = generateOrderId(new Date(), Math.floor(1000 + Math.random() * 9000));
        }

        const phoneCheck = normalizePakistanWhatsApp(cleanDigits);
        const order = database.createOrder({
            orderId,
            customerName: session.customerName || senderName || 'WhatsApp Customer',
            whatsappNumber: phoneCheck.valid ? phoneCheck.e164 : `+${cleanDigits}`,
            whatsappDigits: String(target).endsWith('@lid') ? target : cleanDigits,
            shippingAddress: text,
            city,
            orderNotes: 'Ordered directly inside WhatsApp bot',
            items: totals.items,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            codDeliveryCharges: totals.codDeliveryCharges,
            grandTotal: totals.grandTotal,
            paymentMethod: 'Cash on Delivery (COD)',
            orderStatus: 'Pending WhatsApp Confirmation',
            whatsappDispatchMode: 'whatsapp_in_chat'
        });

        await sendOrderConfirmationPrompt(order);
        return { handled: true, orderCreated: order };
    }
}

/**
 * Handle any incoming WhatsApp message
 */
async function processIncomingMessage({ senderJid, replyJid = '', senderName = 'Customer', rawText = '', catalogPayload = null, sock = null, quoted = null }) {
    const cleanDigits = String(senderJid || replyJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanDigits) return { handled: false };

    const replyTarget = toJid(replyJid || senderJid) || cleanDigits;
    const { config } = database.getAllVariables();
    const stateKey = cleanDigits;

    database.logWhatsAppEvent({
        direction: 'inbound',
        recipient: `+${cleanDigits}`,
        messageType: catalogPayload ? `catalog_${catalogPayload.kind}` : 'customer_message',
        summary: String(rawText || '').slice(0, 220) || '(empty)',
        payload: { senderName, rawText, catalogPayload, replyTarget },
        status: 'received'
    });

    // 0. Native WhatsApp Catalog productMessage / orderMessage handling
    if (catalogPayload) {
        clearCustomerSessions(stateKey);
        if (catalogPayload.kind === 'product' && catalogPayload.title) {
            const matched = database.getProducts({ search: catalogPayload.title }).slice(0, 3);
            if (matched.length > 0) {
                return await sendProductCardsList(replyTarget, matched, 'WhatsApp Catalog Match', config, sock, quoted);
            }
            return await dispatchMessage(replyTarget, {
                title: catalogPayload.title,
                text: `Thanks for sharing *${catalogPayload.title}* from our catalog! Tap *Search Products* to check live availability or *Contact For Inquiry* to order with our team.`,
                buttons: buildWelcomeMenuButtons(config),
                messageType: 'catalog_product_ack',
                quoted,
                socketOverride: sock
            });
        }
        if (catalogPayload.kind === 'order') {
            return await dispatchMessage(replyTarget, {
                title: 'WhatsApp Catalog Basket Received',
                text: `We received your WhatsApp catalog selection (${catalogPayload.itemCount || 1} item(s)). Our team at *${config.storeName}* will confirm your order shortly, or tap an option below:`,
                buttons: buildWelcomeMenuButtons(config),
                messageType: 'catalog_order_ack',
                quoted,
                socketOverride: sock
            });
        }
    }

    const parsedAction = parseIncomingBotAction(rawText);

    // 1. Order confirmation / rejection buttons take top priority
    if (parsedAction.type === 'order_decision' || parsedAction.type === 'order_decision_latest') {
        clearCustomerSessions(stateKey);
        return await processOrderDecision(parsedAction.orderId || null, parsedAction.decision, cleanDigits, sock, quoted, replyTarget);
    }

    const isExplicitMenuOrAction = [
        'menu_categories', 'category_detail', 'menu_offers', 'menu_featured',
        'menu_store', 'menu_track', 'menu_inquiry', 'menu_search', 'menu_pay',
        'menu_about', 'menu_warranty', 'menu_solar',
        'buy_product', 'pay_target', 'search_query', 'greeting_menu', 'track_order_lookup'
    ].includes(parsedAction.type);

    // 2. Active in-chat Checkout session
    const pendingCheckout = checkoutSessions.get(stateKey);
    if (pendingCheckout && !isExplicitMenuOrAction) {
        return await handleInChatCheckoutStep(cleanDigits, senderName, rawText, pendingCheckout, config, sock, quoted, replyTarget);
    }

    // 3. Active Product Search session
    const pendingSearch = searchSessions.get(stateKey);
    if (pendingSearch && pendingSearch.step === 'awaiting_query' && !isExplicitMenuOrAction) {
        searchSessions.delete(stateKey);
        const query = String(rawText || '').trim();
        const matches = database.getProducts({ search: query });
        return await sendProductCardsList(replyTarget, matches, `Search Results for "${query}"`, config, sock, quoted);
    }

    // 4. Active Track Order session
    const pendingTrack = trackSessions.get(stateKey);
    if (pendingTrack && pendingTrack.step === 'awaiting_order_id' && !isExplicitMenuOrAction) {
        const lookup = normalizeOrderLookupInput(rawText);
        if (lookup.isFullId || lookup.isShortDigits) {
            return await handleOrderTrackingReply(cleanDigits, lookup.clean, config, sock, quoted, replyTarget);
        }
        return await dispatchMessage(replyTarget, {
            text: 'Please send your valid Order ID (e.g. *ORD-2026-9336*) or the 4-digit code (e.g. *9336*), or tap an option below:',
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_track_retry',
            quoted,
            socketOverride: sock
        });
    }

    // 5. Direct Order Tracking command or standalone 4-digit code outside inquiry session
    if (parsedAction.type === 'track_order_lookup') {
        clearCustomerSessions(stateKey);
        return await handleOrderTrackingReply(cleanDigits, parsedAction.query, config, sock, quoted, replyTarget);
    }

    const pendingInquiry = inquirySessions.get(stateKey);
    if (!pendingInquiry && !pendingCheckout && !pendingSearch) {
        const directLookup = normalizeOrderLookupInput(rawText);
        if (directLookup.isShortDigits && database.getOrderById(directLookup.clean)) {
            return await handleOrderTrackingReply(cleanDigits, directLookup.clean, config, sock, quoted, replyTarget);
        }
    }

    // 6. Active "Contact For Inquiry" description capture
    if (pendingInquiry && pendingInquiry.step === 'awaiting_description' && parsedAction.type === 'general_message') {
        const description = String(rawText || '').trim();
        if (description.length < 3) {
            return await dispatchMessage(replyTarget, {
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
            senderJid: replyTarget,
            senderNumber: cleanDigits,
            senderName: senderName || pendingInquiry.senderName || 'WhatsApp Customer',
            description,
            forwardedToAdmin: true,
            adminNumber: adminDigits
        });

        const forwardText = formatAdminInquiryForward({
            senderJid: replyTarget,
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

        return await dispatchMessage(replyTarget, {
            title: 'Inquiry Sent to Showroom Desk',
            text: [
                `✅ Thank you, *${senderName || 'Valued Customer'}*!`,
                `Your inquiry details have been forwarded to our *${config.storeName}* support desk.`,
                'Our representative will contact you on this WhatsApp number shortly.',
                '',
                'Explore more below or reply anytime to reopen the store menu:'
            ].join('\n'),
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'inquiry_submitted_ack',
            quoted,
            socketOverride: sock
        });
    }

    switch (parsedAction.type) {
        case 'menu_categories': {
            clearCustomerSessions(stateKey);
            return await sendCategoriesInteractiveMenu(replyTarget, config, sock, quoted);
        }

        case 'category_detail': {
            clearCustomerSessions(stateKey);
            const items = database.getProducts({ category: parsedAction.slug });
            return await sendProductCardsList(replyTarget, items, `Category: ${parsedAction.slug}`, config, sock, quoted);
        }

        case 'menu_search': {
            clearCustomerSessions(stateKey, 'search');
            searchSessions.set(stateKey, {
                step: 'awaiting_query',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(replyTarget, {
                title: 'Search Al-Mumtaz Catalog',
                text: [
                    `🔍 *Search Products — ${config.storeName}*`,
                    'Please type the *product name, brand, or SKU* you are looking for:',
                    '• Example: _QLED TV_, _6kW Inverter_, _Gree AC_, _Fan_'
                ].join('\n'),
                messageType: 'bot_search_ask_query',
                quoted,
                socketOverride: sock
            });
        }

        case 'search_query': {
            clearCustomerSessions(stateKey);
            const matches = database.getProducts({ search: parsedAction.query });
            return await sendProductCardsList(replyTarget, matches, `Search Results for "${parsedAction.query}"`, config, sock, quoted);
        }

        case 'buy_product': {
            clearCustomerSessions(stateKey, 'checkout');
            const product = database.getProductBySlugOrId(parsedAction.productId);
            if (!product) {
                return await sendFiveButtonStoreMenu(replyTarget, senderName, sock, quoted);
            }
            checkoutSessions.set(stateKey, {
                step: 'awaiting_name',
                productId: product.id,
                variant: product.variants?.[0] || 'Standard',
                quantity: 1,
                startedAt: Date.now()
            });
            return await dispatchMessage(replyTarget, {
                title: `Order: ${product.title}`,
                text: [
                    `🛒 *Quick COD Order — ${product.title}*`,
                    `Price: *${formatPkr(product.discountPrice)}*`,
                    '',
                    'Step 1 of 2: Please reply with your *Full Name* (or type *cancel* to go back):'
                ].join('\n'),
                messageType: 'bot_checkout_ask_name',
                quoted,
                socketOverride: sock
            });
        }

        case 'pay_target': {
            clearCustomerSessions(stateKey);
            const rawTarget = String(parsedAction.targetId || '').trim();
            const target = /^ORD-/i.test(rawTarget) || /^\d{4,}$/.test(rawTarget)
                ? (database.getOrderById(rawTarget) || database.getProductBySlugOrId(rawTarget))
                : database.getProductBySlugOrId(rawTarget);
            const storeUrl = buildStoreBaseUrl(config);
            const payButtons = [
                {
                    id: 'pay_website_cta',
                    text: '💳 Open Payment / Track Link',
                    type: 'cta_url',
                    url: target?.orderId ? `${storeUrl}/track/${target.orderId}` : `${storeUrl}/?tab=checkout`
                },
                { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
                { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' }
            ];
            return await dispatchMessage(replyTarget, {
                title: 'Pay Online / COD Details',
                text: formatPaymentOptionsMessage(config, target),
                buttons: payButtons,
                messageType: 'bot_payment_options',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_pay': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(replyTarget, {
                title: 'Online Payment & COD',
                text: formatPaymentOptionsMessage(config, null),
                buttons: [
                    { id: 'pay_website_cta', text: '🌐 Pay on Website', type: 'cta_url', url: `${storeUrl}/?tab=checkout` },
                    { id: 'menu_categories', text: '🛍️ Browse Categories', type: 'quick_reply' },
                    { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
                    { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' }
                ],
                messageType: 'bot_payment_options',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_offers': {
            clearCustomerSessions(stateKey);
            const offers = database.getProducts({ flashSale: true, sort: 'discount' });
            return await sendProductCardsList(replyTarget, offers, 'Flash Deals & Offered Items', config, sock, quoted);
        }

        case 'menu_featured': {
            clearCustomerSessions(stateKey);
            const featured = database.getProducts({ featured: true });
            return await sendProductCardsList(replyTarget, featured, 'Featured Electronics', config, sock, quoted);
        }

        case 'menu_store': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(replyTarget, {
                title: `${config.storeName} Online Store`,
                text: `🛍️ *${config.storeName} — Online Storefront*\n\nShop online with Cash on Delivery:\n${storeUrl}\n\n• 100% Genuine Branded Electronics\n• Cash on Delivery (COD) Across Pakistan\n• Instant WhatsApp Order Verification`,
                buttons: buildWelcomeMenuButtons(config),
                messageType: 'bot_store_info',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_track': {
            clearCustomerSessions(stateKey, 'track');
            trackSessions.set(stateKey, {
                step: 'awaiting_order_id',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(replyTarget, {
                title: 'Track Your COD Order',
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
            clearCustomerSessions(stateKey, 'inquiry');
            inquirySessions.set(stateKey, {
                step: 'awaiting_description',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(replyTarget, {
                title: 'Contact For Inquiry',
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

        case 'menu_about': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(replyTarget, {
                title: `${config.storeName} — Showroom & Timings`,
                text: formatStoreAboutMessage(config),
                footer: `Helpline: ${config.storePhone || '03299931199'} • ${config.storeCity}`,
                buttons: [
                    { id: 'menu_categories', text: '🛍️ Browse Categories', type: 'quick_reply' },
                    { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' },
                    { id: 'visit_store_url', text: '🌐 Visit Online Store', type: 'cta_url', url: storeUrl }
                ],
                messageType: 'bot_store_about',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_warranty': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(replyTarget, {
                title: 'Brand Warranty & COD Delivery',
                text: formatWarrantyDeliveryMessage(config),
                footer: `${config.storeName} • Nationwide COD`,
                buttons: [
                    { id: 'menu_categories', text: '🛍️ Browse Categories', type: 'quick_reply' },
                    { id: 'almumtaz_offers', text: '🔥 Offered Items', type: 'quick_reply' },
                    { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' },
                    { id: 'visit_store_url', text: '🌐 Visit Online Store', type: 'cta_url', url: storeUrl }
                ],
                messageType: 'bot_warranty_delivery',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_solar': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(replyTarget, {
                title: 'Solar & Hybrid Inverter Guide',
                text: formatSolarAdvisorMessage(config),
                footer: `${config.storeName} • Solar Solutions`,
                buttons: [
                    { id: 'cat_solar-inverters', text: '☀️ View Solar Inverters', type: 'quick_reply' },
                    { id: 'almumtaz_inquiry', text: '📝 Get Custom Solar Quote', type: 'quick_reply' },
                    { id: 'visit_store_url', text: '🌐 Open Solar Catalog', type: 'cta_url', url: `${storeUrl}/?category=solar-inverters` }
                ],
                messageType: 'bot_solar_advisor',
                quoted,
                socketOverride: sock
            });
        }

        case 'greeting_menu':
        default: {
            clearCustomerSessions(stateKey);
            return await sendFiveButtonStoreMenu(replyTarget, senderName, sock, quoted);
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

            const catalogPayload = extractCatalogPayload(msg);
            const rawText = extractTextFromBaileysMessage(msg);
            if (!rawText && !catalogPayload) continue;

            const resolvedJid =
                msg.key.senderPn ||
                msg.key.remoteJidAlt ||
                (typeof sock?.resolveJid === 'function' ? sock.resolveJid(jid) : jid) ||
                jid;

            await processIncomingMessage({
                senderJid: resolvedJid,
                replyJid: jid,
                senderName: msg.pushName || 'Customer',
                rawText,
                catalogPayload,
                sock,
                quoted: msg
            });
        } catch (err) {
            console.error('[whatsapp] Incoming message handler error:', err.message);
        }
    }
}

module.exports = {
    toJid,
    dispatchMessage,
    sendFiveButtonStoreMenu,
    sendOrderConfirmationPrompt,
    sendOrderStatusNotification,
    processOrderDecision,
    processIncomingMessage,
    handleIncomingBaileysUpsert,
    extractTextFromBaileysMessage,
    extractCatalogPayload
};
