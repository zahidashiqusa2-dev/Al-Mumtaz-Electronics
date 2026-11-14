'use strict';

const axios = require('axios');
const database = require('./database');
const { sendInteractiveMessage } = require('./buttonHelper');
const {
    normalizePakistanWhatsApp,
    normalizeOrderLookupInput,
    formatPkr,
    buildStoreBaseUrl,
    buildSiteApiUrl,
    formatStoreAboutMessage,
    formatWarrantyDeliveryMessage,
    formatSolarAdvisorMessage,
    buildWelcomeStoreMenuLists,
    formatOrderReceiptText,
    formatOrderConfirmationThanksAndShopPrompt,
    formatOrderTrackingMessage,
    formatProductWhatsAppCard,
    formatPaymentOptionsMessage,
    buildOrderConfirmationButtons,
    buildWelcomeMenuButtons,
    buildProductCardButtons,
    parseIncomingBotAction,
    formatAdminInquiryForward
} = require('./storeLogic');

const inquirySessions = new Map();
const trackSessions = new Map();
const searchSessions = new Map();
const checkoutSessions = new Map();
let lastCatalogSyncAt = 0;

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
    if (raw.includes('@s.whatsapp.net')) return raw;
    const normalized = normalizePakistanWhatsApp(raw);
    if (normalized.valid) return normalized.jid;
    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
}

function unwrapBaileysMessageContent(msg) {
    let m = msg?.message;
    if (!m || typeof m !== 'object') return null;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    return m;
}

function extractTextFromBaileysMessage(msg) {
    const m = unwrapBaileysMessageContent(msg);
    if (!m) return '';

    if (m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
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

function apiHeaders(config = {}) {
    const creds = database.getAdminCredentials();
    return {
        'Content-Type': 'application/json',
        ...(config.apiSecretKey ? { Authorization: `Bearer ${config.apiSecretKey}`, 'x-api-secret': config.apiSecretKey } : {}),
        'x-admin-username': creds.username,
        'x-admin-password': creds.password
    };
}

async function syncCatalogFromMainSite() {
    const { config } = database.getAllVariables();
    const apiBase = buildSiteApiUrl(config);
    if (!apiBase) return;
    if (Date.now() - lastCatalogSyncAt < 20000) return;

    try {
        const res = await axios.get(`${apiBase}/store/bootstrap`, { timeout: 6000 });
        if (res.data?.categories || res.data?.products) {
            database.replaceCatalogCache(res.data.categories || [], res.data.products || []);
            lastCatalogSyncAt = Date.now();
        }
    } catch (_) {}
}

async function fetchLiveCategories(config) {
    const apiBase = buildSiteApiUrl(config);
    if (apiBase) {
        try {
            const res = await axios.get(`${apiBase}/categories`, { timeout: 6000 });
            if (Array.isArray(res.data?.categories)) return res.data.categories;
        } catch (_) {}
    }
    return database.getCategories();
}

async function fetchLiveProducts(config, queryParams = {}) {
    const apiBase = buildSiteApiUrl(config);
    if (apiBase) {
        try {
            const url = queryParams.search
                ? `${apiBase}/products/search`
                : `${apiBase}/products`;
            const res = await axios.get(url, {
                params: queryParams.search ? { q: queryParams.search } : queryParams,
                timeout: 6000
            });
            if (Array.isArray(res.data?.products)) return res.data.products;
        } catch (_) {}
    }
    let rows = database.getProducts(queryParams);
    if (queryParams.search) {
        const q = String(queryParams.search).toLowerCase();
        rows = rows.filter((p) => String(p.title || '').toLowerCase().includes(q) || String(p.categorySlug || '').toLowerCase().includes(q));
    }
    return rows;
}

async function fetchLiveProductById(config, productId) {
    const apiBase = buildSiteApiUrl(config);
    if (apiBase) {
        try {
            const res = await axios.get(`${apiBase}/products/${encodeURIComponent(productId)}`, { timeout: 6000 });
            if (res.data?.product) return res.data.product;
        } catch (_) {}
    }
    return database.getProducts().find((p) => Number(p.id) === Number(productId)) || null;
}

function inferCityFromAddress(addressText, config = {}) {
    const lower = String(addressText || '').toLowerCase();
    const known = ['Hasilpur', 'Bahawalpur', 'Vehari', 'Multan', 'Lahore', 'Islamabad', 'Rawalpindi', 'Karachi'];
    for (const c of known) {
        if (lower.includes(c.toLowerCase())) return c;
    }
    return config.storeCity || 'Hasilpur';
}

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
    const digits = jid.split('@')[0];
    const { config } = database.getAllVariables();
    const resolvedFooter = footer || `${config.storeName} • ${config.storeCity}`;
    const storeBaseUrl = buildStoreBaseUrl(config);

    let result = { delivered: false, mode: 'standby_recorded', messageId: '' };

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
                    storeBaseUrl
                }, quoted);
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

async function sendFiveButtonStoreMenu(recipient, customerName = '', sock = null, quoted = null) {
    const { config } = database.getAllVariables();
    const storeUrl = buildStoreBaseUrl(config);
    const greeting = customerName && customerName !== 'Customer'
        ? `Assalam-o-Alaikum *${customerName}*!`
        : 'Assalam-o-Alaikum!';

    const text = [
        `${greeting} Welcome to *${config.storeName}* (${config.storeCity}).`,
        `Shop Online 24/7: ${storeUrl}`,
        '',
        'Choose a button or open *Store Menu* below to shop, search, pay, track orders, or view showroom & solar info:',
        '• Tap *Browse Categories* or *Search Products* to view live items & order in chat',
        '• Send *ORD-2026-9336* or *9336* anytime to track delivery status',
        '• Tap *Contact For Inquiry* to message our showroom team'
    ].join('\n');

    return await dispatchMessage(recipient, {
        title: `${config.storeName} • ${config.storeCity}`,
        text,
        footer: `Helpline: ${config.storePhone || '03299931199'} • ${config.storeCity}`,
        buttons: buildWelcomeMenuButtons(config),
        lists: buildWelcomeStoreMenuLists(config),
        messageType: 'store_welcome_menu',
        quoted,
        socketOverride: sock
    });
}

async function sendProductCardsList(cleanDigits, items, headingText, config, sock = null, quoted = null) {
    if (!Array.isArray(items) || items.length === 0) {
        return await dispatchMessage(cleanDigits, {
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

    await dispatchMessage(cleanDigits, {
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
        await dispatchMessage(cleanDigits, {
            title: p.title,
            text: formatProductWhatsAppCard(p, config),
            imageUrl: p.images?.[0] || '',
            footer: `${config.storeName} • Cash on Delivery`,
            buttons: buildProductCardButtons(p.id, config),
            messageType: 'bot_product_card',
            socketOverride: sock
        });
    }

    return { handled: true, count: cards.length };
}

async function sendOrderConfirmationPrompt(order) {
    const { config } = database.getAllVariables();
    const receiptText = formatOrderReceiptText(order, config);
    const buttons = buildOrderConfirmationButtons(order.orderId);
    const recipient = order.whatsappDigits || order.customerPhone || order.whatsappNumber;

    const dispatchRes = await dispatchMessage(recipient, {
        title: `COD Order #${order.orderId}`,
        text: receiptText,
        footer: `${config.storeName} • Cash on Delivery Verification`,
        buttons,
        messageType: 'cod_order_confirmation'
    });

    return {
        ...dispatchRes,
        receiptText,
        buttons
    };
}

async function forwardOrderDecisionToMainSite({ senderDigits, senderName, rawText, orderId, decision, sock, quoted }) {
    const { config } = database.getAllVariables();
    const followUpButtons = buildWelcomeMenuButtons(config);
    const apiBase = buildSiteApiUrl(config);

    if (apiBase) {
        try {
            if (orderId) {
                const statusPayload = decision === 'Confirmed' ? 'ACCEPTED' : 'CANCELLED';
                const patchRes = await axios.patch(
                    `${apiBase}/orders/${encodeURIComponent(orderId)}/status`,
                    { status: statusPayload },
                    { headers: apiHeaders(config), timeout: 8000 }
                );
                const updated = patchRes.data?.order;
                if (updated) {
                    const replyText = decision === 'Confirmed'
                        ? formatOrderConfirmationThanksAndShopPrompt(updated, config)
                        : [
                            `❌ Your order *#${updated.orderId}* has been *CANCELLED* as requested. No charges apply.`,
                            '',
                            `Would you like to continue shopping at *${config.storeName}*? Choose an option below anytime:`
                        ].join('\n');

                    await dispatchMessage(senderDigits, {
                        title: decision === 'Confirmed' ? `Order #${updated.orderId} Confirmed` : `Order #${updated.orderId} Cancelled`,
                        text: replyText,
                        footer: `${config.storeName} • ${config.storeCity}`,
                        buttons: followUpButtons,
                        lists: buildWelcomeStoreMenuLists(config),
                        messageType: decision === 'Confirmed' ? 'order_confirmed_reply' : 'order_cancelled_reply',
                        quoted,
                        socketOverride: sock
                    });

                    const adminNorm = normalizePakistanWhatsApp(config.adminWhatsappNumber);
                    if (adminNorm.valid) {
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
                    return { found: true, order: updated, replyText, followUpButtons };
                }
            }

            const res = await axios.post(
                `${apiBase}/whatsapp/webhook`,
                { from: senderDigits, senderName, buttonId: rawText, text: rawText },
                { headers: apiHeaders(config), timeout: 10000 }
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
                return { found: outcome.found, order: outcome.order, replyText: outcome.replyText, followUpButtons };
            }
        } catch (_) {}
    }

    const storeUrl = buildStoreBaseUrl(config);
    const fallbackMsg = decision === 'Confirmed'
        ? [
            `✅ *Thank You!* Your order${orderId ? ` *#${orderId}*` : ''} is *CONFIRMED* at *${config.storeName}*.`,
            orderId ? `Live Tracking Link: ${storeUrl}/track/${orderId}` : '',
            '',
            '🛍️ *Would you like to start shopping on WhatsApp?*',
            'Tap any button below to browse items, offers, or track your order:'
        ].filter(Boolean).join('\n')
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
    const storeUrl = buildStoreBaseUrl(config);
    const apiBase = buildSiteApiUrl(config);

    if (!apiBase) {
        return await dispatchMessage(cleanDigits, {
            text: `Order tracking requires SITE_API_URL to be configured on Railway. Tap *Contact For Inquiry* to check order *${query}*.`,
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_track_unavailable',
            quoted,
            socketOverride: sock
        });
    }

    try {
        const res = await axios.get(
            `${apiBase}/orders/${encodeURIComponent(query)}`,
            { headers: apiHeaders(config), timeout: 8000 }
        );
        const order = res.data?.order;
        if (order) {
            return await dispatchMessage(cleanDigits, {
                title: `Order #${order.orderId} Status`,
                text: formatOrderTrackingMessage(order, config),
                footer: `${config.storeName} • Order Tracking`,
                buttons: [
                    { id: 'track_online_url', text: '📦 Track on Website', type: 'cta_url', url: `${storeUrl}/track/${order.orderId}` },
                    ...buildWelcomeMenuButtons(config).slice(0, 4)
                ],
                messageType: 'bot_track_result',
                quoted,
                socketOverride: sock
            });
        }
    } catch (_) {}

    return await dispatchMessage(cleanDigits, {
        title: 'Order Not Found',
        text: [
            `🔍 We could not find an order matching *${query}*.`,
            'Please check your Order ID (for example *ORD-2026-9336* or the 4-digit code *9336*) and try again:'
        ].join('\n'),
        buttons: buildWelcomeMenuButtons(config),
        messageType: 'bot_track_not_found',
        quoted,
        socketOverride: sock
    });
}

async function handleInChatCheckoutStep(cleanDigits, senderName, rawText, session, config, sock, quoted) {
    const text = String(rawText || '').trim();
    if (/^(?:cancel|stop|exit|menu)$/i.test(text)) {
        checkoutSessions.delete(cleanDigits);
        return await sendFiveButtonStoreMenu(cleanDigits, senderName, sock, quoted);
    }

    if (session.step === 'awaiting_name') {
        if (text.length < 2) {
            return await dispatchMessage(cleanDigits, {
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
        return await dispatchMessage(cleanDigits, {
            title: 'Step 2 of 2: Delivery Address',
            text: `Thanks, *${text}*! Now please reply with your *Complete Delivery Address & City* (e.g. *House 14, Model Town, Hasilpur*):`,
            messageType: 'bot_checkout_ask_address',
            quoted,
            socketOverride: sock
        });
    }

    if (session.step === 'awaiting_address') {
        if (text.length < 5) {
            return await dispatchMessage(cleanDigits, {
                text: 'Please share a complete street address and city so our courier can deliver your parcel:',
                messageType: 'bot_checkout_retry_address',
                quoted,
                socketOverride: sock
            });
        }

        checkoutSessions.delete(cleanDigits);
        const city = inferCityFromAddress(text, config);
        const apiBase = buildSiteApiUrl(config);
        if (apiBase) {
            try {
                const res = await axios.post(
                    `${apiBase}/orders`,
                    {
                        productId: session.productId,
                        variant: session.variant || 'Standard',
                        quantity: session.quantity || 1,
                        customerName: session.customerName || senderName || 'WhatsApp Customer',
                        customerPhone: cleanDigits,
                        shippingAddress: text,
                        city,
                        source: 'WHATSAPP_BOT'
                    },
                    { headers: apiHeaders(config), timeout: 10000 }
                );
                if (res.data?.order) {
                    const order = res.data.order;
                    await sendOrderConfirmationPrompt(order);
                    const adminNorm = normalizePakistanWhatsApp(config.adminWhatsappNumber);
                    if (adminNorm.valid) {
                        await dispatchMessage(adminNorm.digits, {
                            text: [
                                `🛍️ *New WhatsApp Bot COD Order — #${order.orderId}*`,
                                `Customer: ${order.customerName} (${order.whatsappNumber})`,
                                `City: ${order.city}`,
                                `Total (COD): ${formatPkr(order.grandTotal)}`
                            ].join('\n'),
                            messageType: 'admin_new_order_alert',
                            socketOverride: sock
                        }).catch(() => {});
                    }
                    return { handled: true, orderCreated: order };
                }
            } catch (_) {}
        }

        return await dispatchMessage(cleanDigits, {
            title: 'Order Request Received',
            text: `Thanks *${session.customerName}*! Your COD request has been logged for *${text}*. Our team will confirm shortly.`,
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_checkout_fallback_ack',
            quoted,
            socketOverride: sock
        });
    }
}

async function processIncomingMessage({ senderJid, senderName = 'Customer', rawText = '', catalogPayload = null, sock = null, quoted = null }) {
    const cleanDigits = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!cleanDigits) return { handled: false };

    const { config } = database.getAllVariables();
    const stateKey = cleanDigits;

    database.logWhatsAppEvent({
        direction: 'inbound',
        recipient: `+${cleanDigits}`,
        messageType: catalogPayload ? `catalog_${catalogPayload.kind}` : 'customer_message',
        summary: String(rawText || '').slice(0, 220) || '(empty)',
        payload: { senderName, rawText, catalogPayload },
        status: 'received'
    });

    if (catalogPayload) {
        clearCustomerSessions(stateKey);
        if (catalogPayload.kind === 'product' && catalogPayload.title) {
            const matched = (await fetchLiveProducts(config, { search: catalogPayload.title })).slice(0, 3);
            if (matched.length > 0) {
                return await sendProductCardsList(cleanDigits, matched, 'WhatsApp Catalog Match', config, sock, quoted);
            }
        }
        return await dispatchMessage(cleanDigits, {
            title: 'WhatsApp Catalog Selection',
            text: `Thanks for sharing an item from our WhatsApp Catalog! Use the options below to order, search, or contact our showroom:`,
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'catalog_ack',
            quoted,
            socketOverride: sock
        });
    }

    const parsedAction = parseIncomingBotAction(rawText);
    if (parsedAction.type === 'order_decision' || parsedAction.type === 'order_decision_latest') {
        clearCustomerSessions(stateKey);
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

    const isExplicitMenuOrAction = [
        'menu_categories', 'category_detail', 'menu_offers', 'menu_featured',
        'menu_store', 'menu_track', 'menu_inquiry', 'menu_search', 'menu_pay',
        'menu_about', 'menu_warranty', 'menu_solar',
        'buy_product', 'pay_target', 'search_query', 'greeting_menu', 'track_order_lookup'
    ].includes(parsedAction.type);

    const pendingCheckout = checkoutSessions.get(stateKey);
    if (pendingCheckout && !isExplicitMenuOrAction) {
        return await handleInChatCheckoutStep(cleanDigits, senderName, rawText, pendingCheckout, config, sock, quoted);
    }

    const pendingSearch = searchSessions.get(stateKey);
    if (pendingSearch && pendingSearch.step === 'awaiting_query' && !isExplicitMenuOrAction) {
        searchSessions.delete(stateKey);
        const query = String(rawText || '').trim();
        const matches = await fetchLiveProducts(config, { search: query });
        return await sendProductCardsList(cleanDigits, matches, `Search Results for "${query}"`, config, sock, quoted);
    }

    const pendingTrack = trackSessions.get(stateKey);
    if (pendingTrack && pendingTrack.step === 'awaiting_order_id' && !isExplicitMenuOrAction) {
        const lookup = normalizeOrderLookupInput(rawText);
        if (lookup.isFullId || lookup.isShortDigits) {
            return await handleRailwayOrderTracking(cleanDigits, lookup.clean, config, sock, quoted);
        }
        return await dispatchMessage(cleanDigits, {
            text: 'Please send your valid Order ID (e.g. *ORD-2026-9336*) or the 4-digit code (e.g. *9336*), or tap *Contact For Inquiry* below.',
            buttons: buildWelcomeMenuButtons(config),
            messageType: 'bot_track_retry',
            quoted,
            socketOverride: sock
        });
    }

    if (parsedAction.type === 'track_order_lookup') {
        clearCustomerSessions(stateKey);
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

        const apiBase = buildSiteApiUrl(config);
        if (apiBase) {
            axios.post(
                `${apiBase}/bridge/inquiry`,
                {
                    senderJid,
                    senderNumber: cleanDigits,
                    senderName: senderName || pendingInquiry.senderName || 'WhatsApp Customer',
                    description,
                    adminNumber: adminDigits
                },
                { headers: apiHeaders(config), timeout: 8000 }
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

    await syncCatalogFromMainSite();

    switch (parsedAction.type) {
        case 'menu_categories': {
            clearCustomerSessions(stateKey);
            const categories = await fetchLiveCategories(config);
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
                            description: `${c.productCount || 0} products available`
                        }))
                    }]
                }]
                : [];
            return await dispatchMessage(cleanDigits, {
                title: `${config.storeName} — Categories`,
                text: `📂 *${config.storeName} — Product Categories*\n\n${catLines.join('\n')}\n\nSelect a category or reply with its code to view products & prices:`,
                lists,
                buttons: [
                    { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
                    { id: 'menu_pay', text: '💳 Pay Now', type: 'quick_reply' },
                    { id: 'visit_store_url', text: '🌐 Visit Store', type: 'cta_url', url: storeUrl }
                ],
                messageType: 'bot_categories',
                quoted,
                socketOverride: sock
            });
        }

        case 'category_detail': {
            clearCustomerSessions(stateKey);
            const items = await fetchLiveProducts(config, { category: parsedAction.slug });
            return await sendProductCardsList(cleanDigits, items, `Category: ${parsedAction.slug}`, config, sock, quoted);
        }

        case 'menu_search': {
            clearCustomerSessions(stateKey, 'search');
            searchSessions.set(stateKey, {
                step: 'awaiting_query',
                senderName,
                startedAt: Date.now()
            });
            return await dispatchMessage(cleanDigits, {
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
            const matches = await fetchLiveProducts(config, { search: parsedAction.query });
            return await sendProductCardsList(cleanDigits, matches, `Search Results for "${parsedAction.query}"`, config, sock, quoted);
        }

        case 'buy_product': {
            clearCustomerSessions(stateKey, 'checkout');
            const product = await fetchLiveProductById(config, parsedAction.productId);
            if (!product) {
                return await sendFiveButtonStoreMenu(cleanDigits, senderName, sock, quoted);
            }
            const defaultVariant = product.variants?.[0] || product.variantOptions?.[0]?.name || 'Standard';
            checkoutSessions.set(stateKey, {
                step: 'awaiting_name',
                productId: product.id,
                variant: defaultVariant,
                quantity: 1,
                startedAt: Date.now()
            });
            return await dispatchMessage(cleanDigits, {
                title: `Order: ${product.title}`,
                text: [
                    `🛒 *Quick COD Order — ${product.title}*`,
                    defaultVariant && defaultVariant !== 'Standard' ? `Selected Variant: *${defaultVariant}*` : null,
                    `Price: *${formatPkr(product.discountPrice)}*`,
                    '',
                    'Step 1 of 2: Please reply with your *Full Name* (or type *cancel* to go back):'
                ].filter(Boolean).join('\n'),
                messageType: 'bot_checkout_ask_name',
                quoted,
                socketOverride: sock
            });
        }

        case 'pay_target': {
            clearCustomerSessions(stateKey);
            const rawTarget = String(parsedAction.targetId || '').trim();
            const apiBase = buildSiteApiUrl(config);
            let target = null;
            if ((/^ORD-/i.test(rawTarget) || /^\d{4,}$/.test(rawTarget)) && apiBase) {
                try {
                    const ordRes = await axios.get(`${apiBase}/orders/${encodeURIComponent(rawTarget)}`, { headers: apiHeaders(config), timeout: 6000 });
                    if (ordRes.data?.order) target = ordRes.data.order;
                } catch (_) {}
            }
            if (!target) {
                target = await fetchLiveProductById(config, rawTarget);
            }
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(cleanDigits, {
                title: 'Pay Online / COD Details',
                text: formatPaymentOptionsMessage(config, target || { orderId: rawTarget }),
                buttons: [
                    {
                        id: 'pay_website_cta',
                        text: '💳 Open Checkout / Pay',
                        type: 'cta_url',
                        url: target?.orderId ? `${storeUrl}/track/${target.orderId}` : `${storeUrl}/?tab=checkout`
                    },
                    { id: 'menu_search', text: '🔍 Search Products', type: 'quick_reply' },
                    { id: 'almumtaz_inquiry', text: '📝 Contact For Inquiry', type: 'quick_reply' }
                ],
                messageType: 'bot_payment_options',
                quoted,
                socketOverride: sock
            });
        }

        case 'menu_pay': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(cleanDigits, {
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
            const offers = await fetchLiveProducts(config, { flashSale: true, sort: 'discount' });
            return await sendProductCardsList(cleanDigits, offers, 'Flash Deals & Offered Items', config, sock, quoted);
        }

        case 'menu_featured': {
            clearCustomerSessions(stateKey);
            const featured = await fetchLiveProducts(config, { featured: true });
            return await sendProductCardsList(cleanDigits, featured, 'Featured Electronics', config, sock, quoted);
        }

        case 'menu_store': {
            clearCustomerSessions(stateKey);
            const storeUrl = buildStoreBaseUrl(config);
            return await dispatchMessage(cleanDigits, {
                title: `${config.storeName} Online Store`,
                text: `🛍️ *${config.storeName} — Online Storefront*\n\nShop online with Cash on Delivery:\n${storeUrl}\n\n• 100% Genuine Branded Electronics\n• Cash on Delivery (COD) Across Pakistan\n• Instant WhatsApp Order Verification`,
                buttons: buildWelcomeMenuButtons(config),
                lists: buildWelcomeStoreMenuLists(config),
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
            return await dispatchMessage(cleanDigits, {
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
            return await dispatchMessage(cleanDigits, {
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
            return await dispatchMessage(cleanDigits, {
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
            return await dispatchMessage(cleanDigits, {
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
            return await dispatchMessage(cleanDigits, {
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

            const catalogPayload = extractCatalogPayload(msg);
            const rawText = extractTextFromBaileysMessage(msg);
            if (!rawText && !catalogPayload) continue;

            await processIncomingMessage({
                senderJid: jid,
                senderName: msg.pushName || 'Customer',
                rawText,
                catalogPayload,
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
    sendOrderConfirmationPrompt,
    processIncomingMessage,
    handleIncomingBaileysUpsert,
    extractTextFromBaileysMessage,
    extractCatalogPayload
};
