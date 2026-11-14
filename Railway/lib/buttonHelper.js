'use strict';

const { sendButtons } = require('kango-wa');

async function sendButtonMessage(sock, jid, opts = {}, quoted = null) {
    const {
        text = '',
        footer = 'Al-Mumtaz Electronics • Hasilpur',
        buttons = [],
        image
    } = opts;

    const cleanButtons = Array.isArray(buttons)
        ? buttons.slice(0, 5).map((b, idx) => ({
            id: String(b.id || `btn_${idx + 1}`),
            text: String(b.text || `Option ${idx + 1}`).slice(0, 24)
        }))
        : [];

    if (!sock || typeof sock.sendMessage !== 'function') {
        throw new Error('WhatsApp socket is not connected.');
    }

    if (cleanButtons.length > 0) {
        try {
            const payload = { text, footer, buttons: cleanButtons };
            if (image) payload.image = image;
            return await sendButtons(sock, jid, payload, quoted ? { quoted } : undefined);
        } catch (_) {
            // Fallback cleanly to numbered text menu
        }
    }

    let fallbackText = text;
    if (cleanButtons.length > 0) {
        fallbackText += '\n\n' + cleanButtons.map((b, idx) => `${idx + 1}. ${b.text}`).join('\n');
    }

    return quoted
        ? sock.sendMessage(jid, { text: fallbackText }, { quoted })
        : sock.sendMessage(jid, { text: fallbackText });
}

module.exports = { sendButtonMessage };
