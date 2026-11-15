'use strict';

const SEND_DELAY = 700;
const MAX_RETRIES = 3;
const RETRY_BASE = 2500;

class SessionQueue {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.queue = [];
        this.processing = false;
        this.stats = { sent: 0, failed: 0, retried: 0 };
    }

    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject, retries: 0 });
            if (!this.processing) this._drain();
        });
    }

    async _drain() {
        if (this.processing) return;
        this.processing = true;

        try {
            while (this.queue.length > 0) {
                const item = this.queue.shift();
                try {
                    const result = await item.task();
                    this.stats.sent++;
                    item.resolve(result);
                } catch (err) {
                    if (item.retries < MAX_RETRIES) {
                        item.retries++;
                        this.stats.retried++;
                        this.queue.unshift(item);
                        await _sleep(RETRY_BASE * item.retries);
                        continue;
                    }
                    this.stats.failed++;
                    item.reject(err);
                }
                if (this.queue.length > 0) await _sleep(SEND_DELAY);
            }
        } finally {
            this.processing = false;
            if (this.queue.length > 0) this._drain();
        }
    }

    stats_snapshot() {
        return { ...this.stats, pending: this.queue.length, session: this.sessionId };
    }
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const _queues = new Map();
let _lastActiveSocket = null;

function _getQueue(sessionId) {
    const key = String(sessionId || 'main');
    if (!_queues.has(key)) _queues.set(key, new SessionQueue(key));
    return _queues.get(key);
}

function patchSocket(sock, sessionId) {
    const id = sessionId || sock._sessionNumber || 'main';
    const q = _getQueue(id);
    const origSend = sock.sendMessage.bind(sock);
    const origRelay = typeof sock.relayMessage === 'function' ? sock.relayMessage.bind(sock) : null;
    let inQueueTask = false;

    sock.sendMessage = (jid, content, opts) => {
        if (inQueueTask) {
            return origSend(jid, content, opts);
        }
        return q.enqueue(async () => {
            inQueueTask = true;
            try {
                return await origSend(jid, content, opts);
            } finally {
                inQueueTask = false;
            }
        });
    };

    if (origRelay) {
        sock.relayMessage = (jid, message, opts) => {
            if (inQueueTask) {
                return origRelay(jid, message, opts);
            }
            return q.enqueue(async () => {
                inQueueTask = true;
                try {
                    return await origRelay(jid, message, opts);
                } finally {
                    inQueueTask = false;
                }
            });
        };
    }

    sock._queueId = id;
    _lastActiveSocket = sock;
    return sock;
}

function getLastActiveSocket() {
    return _lastActiveSocket;
}

function getStats(sessionId) {
    if (sessionId) return _queues.get(String(sessionId))?.stats_snapshot() || null;
    return Array.from(_queues.values()).map((q) => q.stats_snapshot());
}

module.exports = { patchSocket, getStats, getLastActiveSocket };
