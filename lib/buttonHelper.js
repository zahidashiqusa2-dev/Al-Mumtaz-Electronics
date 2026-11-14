'use strict';

const fs = require('fs');
const path = require('path');
const baileys = require('@whiskeysockets/baileys');
const { sendButtons } = require('kango-wa');

const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = baileys;

async function resolveImageMediaInput(imageInput) {
    if (!imageInput) return null;
    if (Buffer.isBuffer(imageInput)) {
        return { image: imageInput };
    }
    if (typeof imageInput === 'object' && (imageInput.url || Buffer.isBuffer(imageInput.image))) {
        return imageInput.image ? imageInput : { image: imageInput };
    }
    const raw = String(imageInput || '').trim();
    if (!raw) return null;

    if (/^https?:\/\//i.test(raw)) {
        return { image: { url: raw } };
    }

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

/**
 * Send a Baileys native Interactive Message (quick_reply buttons, single_select list, cta_url, optional image header)
 * with clean kango-wa & structured text fallback.
 */
async function sendInteractiveMessage(sock, jid, opts = {}, quoted = null) {
    if (!sock || typeof sock.sendMessage !== 'function') {
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
        imageUrl = ''
    } = opts;

    const mainBody = String(body || text || '').trim();
    const nativeFlowButtons = buildNativeFlowButtons({ buttons, lists });

    if (
        nativeFlowButtons.length > 0 &&
        typeof generateWAMessageFromContent === 'function' &&
        typeof sock.relayMessage === 'function' &&
        proto?.Message?.InteractiveMessage
    ) {
        try {
            let headerPayload = {
                title: String(title || '').slice(0, 60),
                subtitle: '',
                hasMediaAttachment: false
            };

            const mediaInput = await resolveImageMediaInput(image || imageUrl);
            if (mediaInput && typeof prepareWAMessageMedia === 'function' && typeof sock.waUploadToServer === 'function') {
                try {
                    const media = await prepareWAMessageMedia(mediaInput, {
                        upload: sock.waUploadToServer
                    });
                    if (media?.imageMessage) {
                        headerPayload = {
                            title: String(title || '').slice(0, 60),
                            subtitle: '',
                            hasMediaAttachment: true,
                            imageMessage: media.imageMessage
                        };
                    }
                } catch (_) {
                    // Continue cleanly without media header if upload fails
                }
            }

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                header: proto.Message.InteractiveMessage.Header.create(headerPayload),
                body: proto.Message.InteractiveMessage.Body.create({
                    text: mainBody
                }),
                footer: proto.Message.InteractiveMessage.Footer.create({
                    text: String(footer || 'Al-Mumtaz Electronics • Hasilpur').slice(0, 60)
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: nativeFlowButtons
                })
            });

            const waMsg = generateWAMessageFromContent(
                jid,
                {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadata: {},
                                deviceListMetadataVersion: 2
                            },
                            interactiveMessage: interactiveMsg
                        }
                    }
                },
                {
                    userJid: sock.user?.id || jid,
                    ...(quoted ? { quoted } : {})
                }
            );

            await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
            return waMsg;
        } catch (_) {
            // Fall through to kango-wa / text fallback below
        }
    }

    // Fallback 1: kango-wa quick reply buttons
    const quickButtons = (Array.isArray(buttons) ? buttons : [])
        .filter((b) => (b?.type || (b?.url ? 'cta_url' : 'quick_reply')) === 'quick_reply')
        .slice(0, 6)
        .map((b, idx) => ({
            id: String(b.id || `btn_${idx + 1}`),
            text: String(b.text || `Option ${idx + 1}`).slice(0, 24)
        }));

    if (quickButtons.length > 0) {
        try {
            const payload = { text: mainBody, footer, buttons: quickButtons };
            const mediaInput = await resolveImageMediaInput(image || imageUrl);
            if (mediaInput?.image) payload.image = mediaInput.image;
            return await sendButtons(sock, jid, payload, quoted ? { quoted } : undefined);
        } catch (_) {}
    }

    // Fallback 2: clean structured text with numbered options & URLs
    const lines = [title ? `*${title}*` : null, mainBody].filter(Boolean);
    const listRows = (Array.isArray(lists) ? lists : [])
        .flatMap((l) => l.sections || [])
        .flatMap((s) => s.rows || []);

    if (listRows.length > 0) {
        lines.push('', '*Options:*');
        listRows.slice(0, 12).forEach((r, i) => {
            lines.push(`${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''} (\`${r.id}\`)`);
        });
    }
    if (Array.isArray(buttons) && buttons.length > 0) {
        lines.push('');
        buttons.forEach((b, idx) => {
            if (b.url) {
                lines.push(`• ${b.text}: ${b.url}`);
            } else {
                lines.push(`${idx + 1}. ${b.text}`);
            }
        });
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
    buildNativeFlowButtons
};
