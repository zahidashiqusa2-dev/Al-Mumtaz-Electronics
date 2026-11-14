'use strict';

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const database = require('./database');
const { parseCloudinaryUri } = require('./storeLogic');

let _lastCloudinaryError = '';

function getCloudinaryConfig() {
    const vars = database.getAllVariables().map || {};
    const rawUri = String(
        vars.Cloudinary_URI ||
        process.env.Cloudinary_URI ||
        process.env.CLOUDINARY_URL ||
        ''
    ).trim();

    if (!rawUri) return null;
    const parsed = parseCloudinaryUri(rawUri);
    if (!parsed.valid) {
        _lastCloudinaryError = parsed.error;
        return null;
    }
    _lastCloudinaryError = '';
    return parsed;
}

function generateImageId() {
    return 'img_' + crypto.randomBytes(8).toString('hex');
}

function signCloudinaryParams(params, apiSecret) {
    const sorted = Object.keys(params)
        .filter((k) => params[k] !== undefined && params[k] !== '')
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');
    return crypto.createHash('sha1').update(`${sorted}${apiSecret}`).digest('hex');
}

async function uploadToCloudinary(file, imageId, cfg) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'almumtaz_products';
    const publicId = imageId;
    const signature = signCloudinaryParams({ folder, public_id: publicId, timestamp }, cfg.apiSecret);

    const form = new FormData();
    form.append('file', file.buffer, {
        filename: file.originalname || `${imageId}.jpg`,
        contentType: file.mimetype || 'image/jpeg'
    });
    form.append('api_key', cfg.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('public_id', publicId);
    form.append('signature', signature);

    const endpoint = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`;
    const res = await axios.post(endpoint, form, {
        headers: form.getHeaders(),
        timeout: 25000
    });

    if (!res.data?.secure_url) {
        throw new Error('Cloudinary did not return a secure_url.');
    }
    return {
        secureUrl: res.data.secure_url,
        publicId: res.data.public_id || `${folder}/${publicId}`
    };
}

async function destroyFromCloudinary(publicId, cfg) {
    if (!cfg || !publicId) return;
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = signCloudinaryParams({ public_id: publicId, timestamp }, cfg.apiSecret);
        const endpoint = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`;
        await axios.post(
            endpoint,
            { public_id: publicId, api_key: cfg.apiKey, timestamp, signature },
            { timeout: 10000 }
        );
    } catch (_) {}
}

async function saveUploadedImages(files = []) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Please select at least one image file to upload.');
    }

    const cloudinaryCfg = getCloudinaryConfig();
    const saved = [];

    for (const file of files) {
        if (!file || !file.buffer) continue;
        const contentType = String(file.mimetype || 'image/jpeg');
        if (!contentType.startsWith('image/')) {
            throw new Error(`Unsupported file type "${contentType}". Only image files are allowed.`);
        }

        const imageId = generateImageId();
        const filename = String(file.originalname || `${imageId}.jpg`).replace(/[^\w.-]/g, '_');
        const size = file.size || file.buffer.length;
        let storage = 'sqlite';
        let finalUrl = `/api/images/${imageId}`;

        if (cloudinaryCfg) {
            try {
                const cloudRes = await uploadToCloudinary(file, imageId, cloudinaryCfg);
                storage = 'cloudinary';
                finalUrl = cloudRes.secureUrl;
                _lastCloudinaryError = '';
                database.saveMediaImage(
                    imageId,
                    filename,
                    contentType,
                    size,
                    Buffer.alloc(0),
                    'cloudinary',
                    cloudRes.secureUrl
                );
            } catch (err) {
                _lastCloudinaryError = err.response?.data?.error?.message || err.message;
                console.warn('[mediaStore] Cloudinary upload failed, falling back to SQLite:', _lastCloudinaryError);
            }
        }

        if (storage !== 'cloudinary') {
            database.saveMediaImage(imageId, filename, contentType, size, file.buffer, 'sqlite', '');
        }

        saved.push({
            id: imageId,
            url: finalUrl,
            filename,
            contentType,
            size,
            storage
        });
    }

    return saved;
}

async function getImageById(imageId) {
    const cleanId = String(imageId || '').trim();
    if (!cleanId) return null;

    const local = database.getMediaImage(cleanId);
    if (!local) return null;

    if (local.storage === 'cloudinary' && local.remoteUrl) {
        return {
            id: local.id,
            filename: local.filename,
            contentType: local.contentType,
            size: local.size,
            remoteUrl: local.remoteUrl,
            storage: 'cloudinary'
        };
    }

    return {
        id: local.id,
        filename: local.filename,
        contentType: local.contentType,
        size: local.size,
        data: Buffer.from(local.data),
        storage: local.storage || 'sqlite'
    };
}

async function listImages(limit = 50) {
    const rows = database.listMediaImages(limit);
    return rows.map((r) => ({
        id: r.id,
        url: r.storage === 'cloudinary' && r.remoteUrl ? r.remoteUrl : `/api/images/${r.id}`,
        filename: r.filename,
        contentType: r.contentType,
        size: r.size,
        storage: r.storage || 'sqlite',
        createdAt: r.createdAt
    }));
}

async function deleteImageById(imageId) {
    const cleanId = String(imageId || '').trim();
    if (!cleanId) return false;

    const row = database.getMediaImage(cleanId);
    const cfg = getCloudinaryConfig();
    if (row && row.storage === 'cloudinary' && cfg) {
        await destroyFromCloudinary(`almumtaz_products/${cleanId}`, cfg);
    }
    database.deleteMediaImage(cleanId);
    return true;
}

async function getMediaDiagnostics() {
    const cfg = getCloudinaryConfig();
    const localCount = database.countMediaImages();

    return {
        cloudinaryConfigured: Boolean(cfg),
        cloudinaryCloudName: cfg?.cloudName || null,
        lastCloudinaryError: _lastCloudinaryError || null,
        totalImageCount: localCount,
        activeBackend: cfg && !_lastCloudinaryError ? 'cloudinary' : 'sqlite_fallback'
    };
}

module.exports = {
    saveUploadedImages,
    getImageById,
    listImages,
    deleteImageById,
    getMediaDiagnostics
};
