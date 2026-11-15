'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const baileys = require('@whiskeysockets/baileys');
const { sendButtons } = require('kango-wa');

const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = baileys;

async function resolveImageMediaInput(imageInput, storeBaseUrl = '') {
    if (!imageInput) return null;
    if (Buffer.isBuffer(imageInput)) {
        return { image: imageInput };
    }
    if (typeof imageInput === 'object' && (imageInput.url || Buffer.isBuffer(imageInput.image))) {
        return imageInput.image ? imageInput : { image: imageInput };
    }
    let raw = String(imageInput || '').trim();
    if (!raw) return null;

    if (!/^https?:\/\//i.test(raw)) {
        const rel = raw.replace(/^\/+/, '');
        const candidates = [
            path.join(__dirname, '..', 'public', rel),
            path.join(__dirname, '..', rel)
        ];
        for (const fp of candidates) {
            try {
                if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
                    return { image: fs.readFileSync(fp) };
                }
            } catch (_) {}
        }
        if (storeBaseUrl) {
            const cleanBase = String(storeBaseUrl).trim().replace(/\/+$/, '');
            raw = `${cleanBase}/${rel}`;
        }
    }

    if (/^https?:\/\//i.test(raw)) {
        try {
            const res = await axios.get(raw, { responseType: 'arraybuffer', timeout: 8000 });
            if (res.data && res.data.byteLength > 0) {
                return { image: Buffer.from(res.data) };
            }
        } catch (_) {}
        return { image: { url: raw } };
    }

    return null;
}

function buildNativeFlowButtons({ buttons = [], lists = [] } = {}) {
    const flowButtons = [];

    for (const list of Array.isArray(lists) ? lists : []) {
        if (!list || !Array.isArray(list.sections) || list.sections.length === 0) continue;
        flowButtons.push({
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
                title: String(list.title || 'Select Option').slice(0, 24),
                sections: list.sections.map((sec) => ({
                    title: String(sec.title || 'Options').slice(0, 24),
                    rows: (sec.rows || []).slice(0, 25).map((r) => ({
                        header: r.header ? String(r.header).slice(0, 24) : '',
                        title: String(r.title || 'Option').slice(0, 24),
                        description: r.description ? String(r.description).slice(0, 72) : '',
                        id: String(r.id || r.title || 'row')
                    }))
                }))
            })
        });
    }

    for (let idx = 0; idx < (Array.isArray(buttons) ? buttons.length : 0); idx += 1) {
        const b = buttons[idx];
        if (!b) continue;
        const type = b.type || (b.url ? 'cta_url' : 'quick_reply');
        const displayText = String(b.text || b.title || `Option ${idx + 1}`).slice(0, 24);

        if (type === 'cta_url' && b.url) {
            flowButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: displayText,
                    url: String(b.url),
                    merchant_url: String(b.url)
                })
            });
        } else {
            flowButtons.push({
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: displayText,
                    id: String(b.id || `btn_${idx + 1}`)
                })
            });
        }
    }

    return flowButtons;
}

function formatKangoButtons(buttons = [], lists = []) {
    const result = [];
    const seenIds = new Set();

    for (let idx = 0; idx < (Array.isArray(buttons) ? buttons.length : 0); idx += 1) {
        const b = buttons[idx];
        if (!b) continue;
        const type = b.type || (b.url ? 'cta_url' : 'quick_reply');
        const displayText = String(b.text || b.title || `Option ${idx + 1}`).slice(0, 24);

        if (type === 'cta_url' && b.url) {
            result.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                    display_text: displayText,
                    url: String(b.url),
                    merchant_url: String(b.url)
                })
            });
        } else {
            const id = String(b.id || `btn_${idx + 1}`);
            seenIds.add(id);
            result.push({
                id,
                text: displayText
            });
        }
    }

    // If lists were supplied and we have room for extra quick-reply buttons (up to 6 total), include top rows
    if (result.length < 6 && Array.isArray(lists) && lists.length > 0) {
        const rows = lists.flatMap((l) => l?.sections || []).flatMap((s) => s?.rows || []);
        for (const r of rows) {
            if (result.length >= 6) break;
            const id = String(r?.id || '').trim();
            const title = String(r?.title || '').trim();
            if (!id || !title || seenIds.has(id)) continue;
            seenIds.add(id);
            result.push({
                id,
                text: title.slice(0, 24)
            });
        }
    }

    return result.slice(0, 6);
}

function appendListMenuToBody(mainBody, lists = []) {
    if (!Array.isArray(lists) || lists.length === 0) return mainBody;
    const rows = lists.flatMap((l) => l?.sections || []).flatMap((s) => s?.rows || []);
    if (rows.length === 0) return mainBody;

    // Avoid duplicating if the body already lists category codes
    if (mainBody.includes('cat_') || mainBody.includes('Quick Menu Shortcuts')) {
        return mainBody;
    }

    const extraLines = [
        mainBody,
        '',
        '📋 *Quick Menu Options (Tap a button below or reply with any option):*',
        '• Reply *1* — 🛍️ Browse Categories',
        '• Reply *2* — 🔥 Offered Items (Flash Sale)',
        '• Reply *3* — ⭐ Featured Electronics',
        '• Reply *5* — 📦 Track My Order',
        '• Reply *6* — 📝 Contact For Inquiry',
        '• Reply *7* — 🏪 Showroom & Timings',
        '• Reply *8* — 🛡️ Warranty & Delivery',
        '• Reply *9* — ☀️ Solar Load Guide'
    ];
    return extraLines.join('\n');
}

/**
 * Send a WhatsApp Interactive Button Message via kango-wa `sendButtons`
 * (which attaches the required `<biz><interactive type="native_flow" v="1"><native_flow name="mixed" v="9"/></interactive></biz>`
 * stanza node so WhatsApp servers deliver interactive buttons reliably to Android, iOS, and Web clients),
 * with automatic image retry and structured text fallback.
 */
async function sendInteractiveMessage(sock, jid, opts = {}, quoted = null) {
    if (!sock || (typeof sock.sendMessage !== 'function' && typeof sock.relayMessage !== 'function')) {
        throw new Error('WhatsApp socket is not connected.');
    }

    const {
        title = '',
        text = '',
        body = '',
        footer = 'Al-Mumtaz Electronics • Hasilpur',
        buttons = [],
        lists = [],
        image = null,
        imageUrl = '',
        storeBaseUrl = ''
    } = opts;

    const rawBody = String(body || text || '').trim();
    const enrichedBody = appendListMenuToBody(rawBody, lists);
    const kangoButtons = formatKangoButtons(buttons, lists);
    const cleanFooter = String(footer || 'Al-Mumtaz Electronics • Hasilpur').slice(0, 60);
    const cleanTitle = String(title || '').slice(0, 60);
    const quotedOpts = quoted ? { quoted } : undefined;

    if (kangoButtons.length > 0 && typeof sock.relayMessage === 'function') {
        const mediaInput = await resolveImageMediaInput(image || imageUrl, storeBaseUrl);
        if (mediaInput?.image) {
            try {
                return await sendButtons(
                    sock,
                    jid,
                    {
                        title: cleanTitle,
                        text: enrichedBody,
                        footer: cleanFooter,
                        image: mediaInput.image,
                        buttons: kangoButtons
                    },
                    quotedOpts
                );
            } catch (_) {
                // Retry without image if media upload fails
            }
        }

        try {
            return await sendButtons(
                sock,
                jid,
                {
                    title: cleanTitle,
                    text: enrichedBody,
                    footer: cleanFooter,
                    buttons: kangoButtons
                },
                quotedOpts
            );
        } catch (_) {
            // Fall through to structured text fallback
        }
    }

    // Structured text fallback (100% guaranteed delivery on every WhatsApp client)
    const lines = [cleanTitle ? `*${cleanTitle}*` : null, enrichedBody].filter(Boolean);
    if (Array.isArray(buttons) && buttons.length > 0) {
        lines.push('');
        buttons.forEach((b, idx) => {
            if (b?.url) {
                lines.push(`🌐 *${b.text || 'Open Link'}:* ${b.url}`);
            } else if (b?.text) {
                lines.push(`${idx + 1}. ${b.text}`);
            }
        });
    }
    if (cleanFooter) {
        lines.push('', `_${cleanFooter}_`);
    }
    const fallbackText = lines.join('\n');

    return quoted
        ? sock.sendMessage(jid, { text: fallbackText }, { quoted })
        : sock.sendMessage(jid, { text: fallbackText });
}

async function sendButtonMessage(sock, jid, opts = {}, quoted = null) {
    return sendInteractiveMessage(sock, jid, opts, quoted);
}

module.exports = {
    sendInteractiveMessage,
    sendButtonMessage,
    buildNativeFlowButtons,
    formatKangoButtons
};
