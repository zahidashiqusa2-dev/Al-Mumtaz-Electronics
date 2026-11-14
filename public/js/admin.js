'use strict';

(function () {
    const { formatPkr, escapeHtml } = window.AlMumtazAPI;
    const TOKEN_KEY = 'almumtaz_admin_token';

    const adminState = {
        authenticated: false,
        username: '',
        activeTab: 'orders',
        overview: null,
        editingProductId: null,
        productImages: [],
        orderSearch: '',
        orderStatusFilter: 'all',
        pendingDeleteOrderId: null,
        pendingDeleteProductId: null,
        pendingDeleteImageId: null
    };

    function getStoredToken() {
        try {
            return localStorage.getItem(TOKEN_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function setStoredToken(token) {
        try {
            if (token) {
                localStorage.setItem(TOKEN_KEY, token);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (_) {}
    }

    function toast(msg, isError = false) {
        const el = document.getElementById('toast-banner');
        if (!el) return;
        el.textContent = msg;
        el.className = `fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded shadow-xl text-sm font-medium border ${
            isError
                ? 'bg-red-700 text-white border-red-800'
                : 'bg-gray-900 text-white border-gray-700'
        }`;
        el.classList.remove('hidden');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => el.classList.add('hidden'), 3600);
    }

    function showAuthView(authenticated, username = '') {
        adminState.authenticated = authenticated;
        adminState.username = username || '';
        const loginView = document.getElementById('admin-login-view');
        const dashView = document.getElementById('admin-dashboard-view');
        const userBadge = document.getElementById('admin-user-badge');

        if (authenticated) {
            loginView?.classList.add('hidden');
            dashView?.classList.remove('hidden');
            if (userBadge) userBadge.textContent = `@${username || 'admin'}`;
        } else {
            dashView?.classList.add('hidden');
            loginView?.classList.remove('hidden');
        }
    }

    async function adminRequest(url, options = {}) {
        const token = getStoredToken();
        const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
        const headers = {
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        const res = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers
        });

        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && url !== '/api/admin/login') {
            setStoredToken('');
            showAuthView(false);
            throw new Error(data.error || 'Session expired. Please sign in again.');
        }
        if (!res.ok) {
            throw new Error(data.error || `Request failed (${res.status})`);
        }
        return data;
    }

    function renderKpis(stats = {}) {
        const grid = document.getElementById('admin-kpi-grid');
        if (!grid) return;

        const cards = [
            { label: 'Total Revenue', value: formatPkr(stats.totalRevenue || 0) },
            { label: 'Total Orders', value: stats.totalOrders || 0 },
            { label: 'Confirmed COD', value: stats.confirmedOrders || 0 },
            { label: 'Pending WhatsApp', value: stats.pendingOrders || 0 },
            { label: 'Catalog Products', value: stats.totalProducts || 0 },
            { label: 'Customer Inquiries', value: stats.totalInquiries || 0 }
        ];

        grid.innerHTML = cards.map((c) => `
            <div class="bg-white border border-gray-200 rounded p-4">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">${escapeHtml(c.label)}</p>
                <p class="font-display text-xl font-extrabold text-gray-950 tabular-nums mt-1">${escapeHtml(String(c.value))}</p>
            </div>
        `).join('');
    }

    function openOrderDetailModal(order) {
        const modal = document.getElementById('order-detail-modal');
        const body = document.getElementById('order-detail-body');
        if (!modal || !body || !order) return;

        const badgeClass =
            order.orderStatus === 'Confirmed' || order.orderStatus === 'Delivered'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : order.orderStatus === 'Cancelled'
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-amber-50 text-amber-800 border-amber-200';

        body.innerHTML = `
            <div class="border-b border-gray-100 pb-4 pr-8 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Order Receipt &amp; Fulfillment</p>
                    <h2 class="font-display text-xl font-extrabold text-gray-950 font-mono">#${escapeHtml(order.orderId)}</h2>
                    <p class="text-xs text-gray-500">Placed: ${escapeHtml(order.orderDate)} · Dispatch Mode: ${escapeHtml(order.whatsappDispatchMode || 'baileys')}</p>
                </div>
                <span class="px-3 py-1 text-xs font-bold border rounded ${badgeClass}">${escapeHtml(order.orderStatus)}</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 border border-gray-200 rounded p-4 text-xs">
                <div class="space-y-1">
                    <p class="font-semibold uppercase text-gray-500">Customer Details</p>
                    <p class="font-bold text-sm text-gray-900">${escapeHtml(order.customerName)}</p>
                    <p class="font-mono text-gray-700">${escapeHtml(order.whatsappNumber)}</p>
                </div>
                <div class="space-y-1">
                    <p class="font-semibold uppercase text-gray-500">Delivery Address</p>
                    <p class="font-semibold text-gray-900">${escapeHtml(order.shippingAddress)}</p>
                    <p class="text-gray-700">City: <strong>${escapeHtml(order.city)}</strong></p>
                    ${order.nearestLandmark ? `<p class="text-gray-600">Landmark: ${escapeHtml(order.nearestLandmark)}</p>` : ''}
                </div>
            </div>

            ${order.orderNotes ? `
                <div class="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                    <strong>Customer Note:</strong> ${escapeHtml(order.orderNotes)}
                </div>
            ` : ''}

            <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Ordered Items</p>
                <div class="border border-gray-200 rounded divide-y divide-gray-100">
                    ${(order.items || []).map((item) => `
                        <div class="p-3 flex items-center justify-between gap-3 text-xs">
                            <div class="flex items-center gap-3 min-w-0">
                                <img src="${escapeHtml(item.image || '/images/product_qled_tv.jpg')}" alt="" class="w-10 h-10 rounded object-cover bg-gray-100 shrink-0" />
                                <div class="min-w-0">
                                    <p class="font-bold text-gray-900 truncate">${escapeHtml(item.title)}</p>
                                    <p class="text-gray-500">${item.variant ? `${escapeHtml(item.variant)} · ` : ''}Qty: ${item.quantity} × ${formatPkr(item.unitPrice || item.discountPrice)}</p>
                                </div>
                            </div>
                            <span class="font-bold tabular-nums text-gray-950 shrink-0">${formatPkr(item.lineTotal)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-gray-50 border border-gray-200 rounded p-4 text-xs space-y-1.5">
                <div class="flex justify-between text-gray-600">
                    <span>Items Subtotal</span>
                    <span class="tabular-nums font-semibold">${formatPkr(order.subtotal)}</span>
                </div>
                <div class="flex justify-between text-emerald-700">
                    <span>Discount Savings</span>
                    <span class="tabular-nums font-semibold">-${formatPkr(order.discountTotal || 0)}</span>
                </div>
                <div class="flex justify-between text-gray-600">
                    <span>COD Delivery Charges</span>
                    <span class="tabular-nums font-semibold">${order.codDeliveryCharges === 0 ? 'FREE' : formatPkr(order.codDeliveryCharges)}</span>
                </div>
                <div class="flex justify-between text-sm font-bold text-gray-950 border-t border-gray-200 pt-2">
                    <span>Grand Total (Cash on Delivery)</span>
                    <span class="tabular-nums text-brand-600">${formatPkr(order.grandTotal)}</span>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');
    }

    function renderOrdersTab(container) {
        const allOrders = adminState.overview?.orders || [];
        const q = adminState.orderSearch.trim().toLowerCase();
        const statusFilter = adminState.orderStatusFilter;

        const filtered = allOrders.filter((o) => {
            if (statusFilter !== 'all' && o.orderStatus !== statusFilter) return false;
            if (!q) return true;
            return (
                String(o.orderId || '').toLowerCase().includes(q) ||
                String(o.customerName || '').toLowerCase().includes(q) ||
                String(o.whatsappNumber || '').toLowerCase().includes(q) ||
                String(o.city || '').toLowerCase().includes(q)
            );
        });

        container.innerHTML = `
            <div class="bg-white border border-gray-200 rounded overflow-hidden">
                <div class="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 class="font-display font-bold text-base text-gray-950">Live Cash on Delivery Orders (${filtered.length} / ${allOrders.length})</h2>
                        <p class="text-xs text-gray-500">Search, inspect receipts, manage status, trigger WhatsApp actions, or delete orders.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <input id="orders-search-input" type="search" value="${escapeHtml(adminState.orderSearch)}" placeholder="Search Order ID, name, phone, city..." class="h-9 px-3 border border-gray-300 rounded text-xs w-56 focus:border-brand-500 focus:outline-none" />
                        <select id="orders-status-filter" class="h-9 px-2.5 border border-gray-300 rounded text-xs bg-white">
                            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                            ${['Pending WhatsApp Confirmation', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'].map((st) =>
                                `<option value="${st}" ${statusFilter === st ? 'selected' : ''}>${st}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                ${filtered.length === 0 ? `
                    <div class="p-8 text-center text-sm text-gray-500">No orders match the current filter.</div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                                <tr>
                                    <th class="px-4 py-3 font-semibold">Order ID</th>
                                    <th class="px-4 py-3 font-semibold">Customer</th>
                                    <th class="px-4 py-3 font-semibold">City &amp; Address</th>
                                    <th class="px-4 py-3 font-semibold">Items</th>
                                    <th class="px-4 py-3 font-semibold">Grand Total</th>
                                    <th class="px-4 py-3 font-semibold">Status</th>
                                    <th class="px-4 py-3 font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">
                                ${filtered.map((o) => {
                                    const badgeClass =
                                        o.orderStatus === 'Confirmed' || o.orderStatus === 'Delivered'
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                            : o.orderStatus === 'Cancelled'
                                            ? 'bg-red-50 text-red-700 border-red-200'
                                            : 'bg-amber-50 text-amber-800 border-amber-200';
                                    const confirmPending = adminState.pendingDeleteOrderId === o.orderId;
                                    return `
                                        <tr class="hover:bg-gray-50/70">
                                            <td class="px-4 py-3 font-mono font-bold text-gray-900 whitespace-nowrap">#${escapeHtml(o.orderId)}</td>
                                            <td class="px-4 py-3">
                                                <p class="font-bold text-gray-900">${escapeHtml(o.customerName)}</p>
                                                <p class="font-mono text-gray-500">${escapeHtml(o.whatsappNumber)}</p>
                                            </td>
                                            <td class="px-4 py-3 max-w-[200px]">
                                                <p class="font-semibold text-gray-900">${escapeHtml(o.city)}</p>
                                                <p class="text-gray-500 truncate">${escapeHtml(o.shippingAddress)}</p>
                                            </td>
                                            <td class="px-4 py-3 tabular-nums whitespace-nowrap">${(o.items || []).reduce((a, b) => a + (b.quantity || 1), 0)} item(s)</td>
                                            <td class="px-4 py-3 font-bold tabular-nums whitespace-nowrap text-gray-950">${formatPkr(o.grandTotal)}</td>
                                            <td class="px-4 py-3">
                                                <select data-order-status="${escapeHtml(o.orderId)}" class="order-status-select h-8 px-2 border rounded text-xs font-semibold ${badgeClass}">
                                                    ${['Pending WhatsApp Confirmation', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'].map((st) =>
                                                        `<option value="${st}" ${o.orderStatus === st ? 'selected' : ''}>${st}</option>`
                                                    ).join('')}
                                                </select>
                                            </td>
                                            <td class="px-4 py-3 whitespace-nowrap">
                                                <div class="flex items-center gap-1.5">
                                                    <button type="button" data-view-order="${escapeHtml(o.orderId)}" class="view-order-btn px-2 py-1 border border-gray-300 bg-white text-gray-800 rounded text-[11px] font-semibold hover:bg-gray-100">Details</button>
                                                    <button type="button" data-wh-confirm="${escapeHtml(o.orderId)}" data-wh-from="${escapeHtml(o.whatsappDigits)}" class="wh-sim-confirm px-2 py-1 bg-wa-600 text-white rounded text-[11px] font-semibold hover:bg-wa-700">Confirm</button>
                                                    <button type="button" data-wh-cancel="${escapeHtml(o.orderId)}" data-wh-from="${escapeHtml(o.whatsappDigits)}" class="wh-sim-cancel px-2 py-1 border border-red-300 text-red-700 rounded text-[11px] font-semibold hover:bg-red-50">Reject</button>
                                                    <button type="button" data-wh-resend="${escapeHtml(o.orderId)}" class="wh-resend px-2 py-1 border border-gray-300 text-gray-700 rounded text-[11px] font-semibold hover:bg-gray-100">Resend</button>
                                                    <button type="button" data-del-order="${escapeHtml(o.orderId)}" class="del-order-btn px-2 py-1 border rounded text-[11px] font-semibold ${confirmPending ? 'bg-red-600 text-white border-red-700' : 'border-gray-300 text-red-600 hover:bg-red-50'}">
                                                        ${confirmPending ? 'Confirm Del' : 'Delete'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        `;

        const searchEl = document.getElementById('orders-search-input');
        searchEl?.addEventListener('input', (e) => {
            adminState.orderSearch = e.target.value;
            renderOrdersTab(container);
            const refreshed = document.getElementById('orders-search-input');
            if (refreshed) {
                refreshed.focus();
                refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length);
            }
        });

        document.getElementById('orders-status-filter')?.addEventListener('change', (e) => {
            adminState.orderStatusFilter = e.target.value;
            renderOrdersTab(container);
        });

        container.querySelectorAll('.view-order-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const ord = allOrders.find((o) => o.orderId === btn.dataset.viewOrder);
                if (ord) openOrderDetailModal(ord);
            });
        });

        container.querySelectorAll('.order-status-select').forEach((sel) => {
            sel.addEventListener('change', async () => {
                try {
                    await adminRequest(`/api/admin/orders/${encodeURIComponent(sel.dataset.orderStatus)}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: sel.value })
                    });
                    toast(`Order #${sel.dataset.orderStatus} updated to ${sel.value}`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        container.querySelectorAll('.wh-sim-confirm').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest('/api/whatsapp/webhook', {
                        method: 'POST',
                        body: JSON.stringify({ buttonId: `confirm_order_${btn.dataset.whConfirm}`, from: btn.dataset.whFrom })
                    });
                    toast(`Confirmed #${btn.dataset.whConfirm} via WhatsApp webhook`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        container.querySelectorAll('.wh-sim-cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest('/api/whatsapp/webhook', {
                        method: 'POST',
                        body: JSON.stringify({ buttonId: `cancel_order_${btn.dataset.whCancel}`, from: btn.dataset.whFrom })
                    });
                    toast(`Cancelled #${btn.dataset.whCancel} via WhatsApp webhook`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        container.querySelectorAll('.wh-resend').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest(`/api/admin/orders/${encodeURIComponent(btn.dataset.whResend)}/resend-whatsapp`, {
                        method: 'POST'
                    });
                    toast(`Re-dispatched WhatsApp receipt for #${btn.dataset.whResend}`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        container.querySelectorAll('.del-order-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const oid = btn.dataset.delOrder;
                if (adminState.pendingDeleteOrderId !== oid) {
                    adminState.pendingDeleteOrderId = oid;
                    renderOrdersTab(container);
                    return;
                }
                try {
                    await adminRequest(`/api/admin/orders/${encodeURIComponent(oid)}`, { method: 'DELETE' });
                    adminState.pendingDeleteOrderId = null;
                    toast(`Order #${oid} deleted`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    function renderProductImagePreviewGrid() {
        const grid = document.getElementById('prod-images-preview-grid');
        if (!grid) return;

        if (adminState.productImages.length === 0) {
            grid.innerHTML = '<p class="col-span-full text-[11px] text-gray-400 italic py-2">No images attached yet. Upload files above or add a studio/URL image below.</p>';
            return;
        }

        grid.innerHTML = adminState.productImages.map((url, idx) => `
            <div class="relative border ${idx === 0 ? 'border-brand-500 ring-1 ring-brand-500/30' : 'border-gray-200'} rounded overflow-hidden bg-gray-50 group">
                <img src="${escapeHtml(url)}" alt="Item image ${idx + 1}" class="w-full h-20 object-cover" />
                ${idx === 0 ? '<span class="absolute top-1 left-1 px-1.5 py-0.5 bg-brand-500 text-white text-[9px] font-bold uppercase rounded-sm">Primary</span>' : ''}
                <div class="flex items-center justify-between gap-1 px-1.5 py-1 bg-white border-t border-gray-200 text-[10px]">
                    ${idx > 0
                        ? `<button type="button" data-img-primary="${idx}" class="prod-img-primary font-semibold text-gray-700 hover:text-brand-600">Set Primary</button>`
                        : '<span class="text-gray-400 font-medium">Cover</span>'}
                    <button type="button" data-img-remove="${idx}" class="prod-img-remove font-bold text-red-600 hover:text-red-800 px-1">×</button>
                </div>
            </div>
        `).join('');

        grid.querySelectorAll('.prod-img-primary').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.imgPrimary);
                const [picked] = adminState.productImages.splice(idx, 1);
                if (picked) adminState.productImages.unshift(picked);
                renderProductImagePreviewGrid();
            });
        });

        grid.querySelectorAll('.prod-img-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.imgRemove);
                adminState.productImages.splice(idx, 1);
                renderProductImagePreviewGrid();
            });
        });
    }

    async function handleMultiImageUpload(files) {
        if (!files || files.length === 0) return;
        const statusEl = document.getElementById('prod-upload-status');
        if (statusEl) {
            statusEl.textContent = `Uploading ${files.length} image(s)...`;
            statusEl.className = 'text-xs font-semibold text-brand-600 mt-1';
        }

        const fd = new FormData();
        for (const f of files) {
            fd.append('images', f);
        }

        try {
            const res = await adminRequest('/api/admin/images/upload', {
                method: 'POST',
                body: fd
            });
            const uploadedUrls = (res.images || []).map((i) => i.url);
            adminState.productImages.push(...uploadedUrls);
            renderProductImagePreviewGrid();

            // Refresh uploaded media gallery in overview silently without resetting form inputs
            if (adminState.overview) {
                adminState.overview.uploadedImages = [
                    ...(res.images || []),
                    ...(adminState.overview.uploadedImages || [])
                ];
                if (res.diagnostics) adminState.overview.mediaDiagnostics = res.diagnostics;
            }
            if (statusEl) {
                statusEl.textContent = `Uploaded ${uploadedUrls.length} image(s) to ${res.diagnostics?.activeBackend === 'cloudinary' ? 'Cloudinary CDN' : 'Database Media Store'}.`;
                statusEl.className = 'text-xs font-semibold text-emerald-700 mt-1';
            }
            toast(`Uploaded ${uploadedUrls.length} image(s) successfully`);
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = err.message;
                statusEl.className = 'text-xs font-semibold text-red-600 mt-1';
            }
            toast(err.message, true);
        }
    }

    function renderProductsTab(container) {
        const products = adminState.overview?.products || [];
        const categories = adminState.overview?.categories || [];
        const uploadedImages = adminState.overview?.uploadedImages || [];
        const mediaDiag = adminState.overview?.mediaDiagnostics || {};
        const editing = adminState.editingProductId
            ? products.find((p) => p.id === adminState.editingProductId)
            : null;

        const studioImages = [
            { label: '4K QLED Smart TV', url: '/images/product_qled_tv.jpg' },
            { label: 'Hybrid Solar Inverter & Battery', url: '/images/product_solar_inverter.jpg' },
            { label: 'Inverter Fridge & Split AC', url: '/images/product_refrigerator_ac.jpg' },
            { label: 'ANC Headphones & Smartwatch', url: '/images/product_audio_accessories.jpg' },
            { label: 'Showroom Hero Showcase', url: '/images/hero_electronics_showcase.jpg' }
        ];

        const backendBadge = mediaDiag.activeBackend === 'cloudinary'
            ? `<span class="px-2.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">Cloudinary CDN Active (${escapeHtml(mediaDiag.cloudinaryCloudName || 'connected')})</span>`
            : '<span class="px-2.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold">SQLite Media Fallback (Set Cloudinary_URI in Variables for Cloud CDN)</span>';

        container.innerHTML = `
            <div class="space-y-6">
                <div class="bg-white border border-gray-200 rounded px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div class="text-xs text-gray-700">
                        <span class="font-bold text-gray-950">Direct Multi-Image Storage Engine:</span>
                        <span class="ml-1.5">${backendBadge}</span>
                    </div>
                    <span class="text-xs text-gray-500 tabular-nums">
                        Uploaded Media Files: <strong>${uploadedImages.length}</strong>
                    </span>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <!-- Product Create / Edit Form -->
                    <div class="lg:col-span-5 space-y-6">
                        <form id="admin-product-form" class="bg-white border border-gray-200 rounded p-5 space-y-3.5">
                            <div class="flex items-center justify-between border-b border-gray-100 pb-2.5">
                                <h3 class="font-display font-bold text-base text-gray-950">${editing ? 'Edit Product' : 'Add New Product'}</h3>
                                ${editing ? '<button id="cancel-edit-prod" type="button" class="text-xs font-semibold text-gray-500 hover:text-gray-900">Cancel Edit</button>' : ''}
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-gray-700 mb-1">Product Title *</label>
                                <input name="title" required value="${escapeHtml(editing?.title || '')}" placeholder="e.g. Haier 50-Inch 4K Google TV" class="w-full h-9 px-3 border border-gray-300 rounded text-sm" />
                            </div>

                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold text-gray-700 mb-1">Category *</label>
                                    <select name="categorySlug" class="w-full h-9 px-2.5 border border-gray-300 rounded text-sm bg-white">
                                        ${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${editing?.categorySlug === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-gray-700 mb-1">SKU</label>
                                    <input name="sku" value="${escapeHtml(editing?.sku || '')}" placeholder="AME-TV-50" class="w-full h-9 px-3 border border-gray-300 rounded text-sm font-mono" />
                                </div>
                            </div>

                            <div class="grid grid-cols-3 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold text-gray-700 mb-1">Original (PKR) *</label>
                                    <input name="originalPrice" type="number" required value="${editing?.originalPrice || ''}" placeholder="150000" class="w-full h-9 px-2.5 border border-gray-300 rounded text-sm tabular-nums" />
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-gray-700 mb-1">Sale Price *</label>
                                    <input name="discountPrice" type="number" required value="${editing?.discountPrice || ''}" placeholder="125000" class="w-full h-9 px-2.5 border border-gray-300 rounded text-sm tabular-nums" />
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-gray-700 mb-1">Stock *</label>
                                    <input name="stock" type="number" required value="${editing?.stock ?? 10}" class="w-full h-9 px-2.5 border border-gray-300 rounded text-sm tabular-nums" />
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-gray-700 mb-1">Brand</label>
                                <input name="brand" value="${escapeHtml(editing?.brand || 'Al-Mumtaz')}" class="w-full h-9 px-3 border border-gray-300 rounded text-sm" />
                            </div>

                            <!-- Direct Multiple Image Uploader -->
                            <div class="border border-gray-200 rounded p-3.5 bg-gray-50/70 space-y-3">
                                <div class="flex items-center justify-between">
                                    <label for="prod-images-input" class="text-xs font-bold text-gray-900">
                                        Direct Multiple Image Upload
                                    </label>
                                    <span class="text-[11px] text-gray-500">Up to 10 images (JPG/PNG/WEBP)</span>
                                </div>

                                <div id="prod-image-dropzone" class="border-2 border-dashed border-gray-300 hover:border-brand-500 rounded bg-white p-4 text-center cursor-pointer transition-colors">
                                    <input id="prod-images-input" type="file" multiple accept="image/*" class="sr-only" />
                                    <label for="prod-images-input" class="cursor-pointer block space-y-1">
                                        <span class="inline-block px-3 py-1.5 bg-gray-900 text-white text-xs font-semibold rounded">
                                            Select Multiple Images
                                        </span>
                                        <p class="text-[11px] text-gray-500">Or drag &amp; drop multiple item photos here to upload to Cloudinary</p>
                                    </label>
                                    <p id="prod-upload-status" class="hidden"></p>
                                </div>

                                <div id="prod-images-preview-grid" class="grid grid-cols-3 gap-2"></div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-gray-200">
                                    <div class="flex gap-1.5">
                                        <select id="studio-asset-select" class="flex-1 h-8 px-2 border border-gray-300 rounded text-[11px] bg-white">
                                            ${studioImages.map((img) => `<option value="${img.url}">${img.label}</option>`).join('')}
                                        </select>
                                        <button id="add-studio-img-btn" type="button" class="h-8 px-2.5 bg-white border border-gray-300 rounded text-[11px] font-semibold text-gray-800 hover:bg-gray-100 shrink-0">+ Asset</button>
                                    </div>
                                    <div class="flex gap-1.5">
                                        <input id="custom-img-url-input" type="url" placeholder="https://... image URL" class="flex-1 h-8 px-2 border border-gray-300 rounded text-[11px] bg-white" />
                                        <button id="add-custom-img-btn" type="button" class="h-8 px-2.5 bg-white border border-gray-300 rounded text-[11px] font-semibold text-gray-800 hover:bg-gray-100 shrink-0">+ URL</button>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-gray-700 mb-1">Variants (comma-separated)</label>
                                <input name="variants" value="${escapeHtml((editing?.variants || ['Standard']).join(', '))}" class="w-full h-9 px-3 border border-gray-300 rounded text-sm" />
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-gray-700 mb-1">Tags (comma-separated)</label>
                                <input name="tags" value="${escapeHtml((editing?.tags || ['Featured']).join(', '))}" placeholder="Featured, Hot, Free Delivery" class="w-full h-9 px-3 border border-gray-300 rounded text-sm" />
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-gray-700 mb-1">Description</label>
                                <textarea name="description" rows="2" class="w-full p-2.5 border border-gray-300 rounded text-sm">${escapeHtml(editing?.description || '')}</textarea>
                            </div>

                            <div class="flex items-center gap-5 pt-1 text-xs font-semibold text-gray-800">
                                <label class="flex items-center gap-2"><input type="checkbox" name="isFeatured" ${editing?.isFeatured ? 'checked' : ''} class="accent-[#E8531A]" /> Featured Item</label>
                                <label class="flex items-center gap-2"><input type="checkbox" name="isFlashSale" ${editing?.isFlashSale ? 'checked' : ''} class="accent-[#E8531A]" /> Flash Deal / Offered</label>
                            </div>

                            <button type="submit" class="w-full h-10 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded">
                                ${editing ? 'Save Product Changes' : 'Add Product to Catalog'}
                            </button>
                        </form>

                        <!-- Category Manager -->
                        <form id="admin-category-form" class="bg-white border border-gray-200 rounded p-5 space-y-3">
                            <h3 class="font-display font-bold text-base text-gray-950 border-b border-gray-100 pb-2">Add Category</h3>
                            <div class="flex gap-2">
                                <input name="name" required placeholder="Category Name" class="flex-1 h-9 px-3 border border-gray-300 rounded text-sm" />
                                <button type="submit" class="h-9 px-4 bg-gray-900 text-white text-xs font-semibold rounded">Add</button>
                            </div>
                            <div class="flex flex-wrap gap-2 pt-2">
                                ${categories.map((c) => `
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 border border-gray-200 rounded text-xs font-medium">
                                        ${escapeHtml(c.name)}
                                        <button type="button" data-del-cat="${c.id}" class="del-cat-btn text-red-600 font-bold hover:text-red-800">×</button>
                                    </span>
                                `).join('')}
                            </div>
                        </form>
                    </div>

                    <!-- Product Catalog Table + Uploaded Images Gallery -->
                    <div class="lg:col-span-7 space-y-6">
                        <div class="bg-white border border-gray-200 rounded overflow-hidden">
                            <div class="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                                <h3 class="font-display font-bold text-base text-gray-950">Catalog Inventory (${products.length})</h3>
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                    <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                                        <tr>
                                            <th class="px-4 py-3 font-semibold">Product</th>
                                            <th class="px-4 py-3 font-semibold">Sale / Orig</th>
                                            <th class="px-4 py-3 font-semibold">Stock</th>
                                            <th class="px-4 py-3 font-semibold">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-100">
                                        ${products.map((p) => {
                                            const confirmDel = adminState.pendingDeleteProductId === p.id;
                                            const imgCount = (p.images || []).length;
                                            return `
                                                <tr>
                                                    <td class="px-4 py-3">
                                                        <div class="flex items-center gap-3">
                                                            <img src="${escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg')}" alt="" class="w-10 h-10 rounded object-cover bg-gray-100 border border-gray-200 shrink-0" />
                                                            <div class="min-w-0">
                                                                <p class="font-bold text-gray-900">${escapeHtml(p.title)}</p>
                                                                <p class="text-[11px] text-gray-500">${escapeHtml(p.sku)} · ${escapeHtml(p.categorySlug)} · ${imgCount} photo${imgCount === 1 ? '' : 's'}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td class="px-4 py-3 tabular-nums">
                                                        <p class="font-bold text-brand-500">${formatPkr(p.discountPrice)} (-${p.discountPercentage}%)</p>
                                                        <p class="text-gray-400 line-through">${formatPkr(p.originalPrice)}</p>
                                                    </td>
                                                    <td class="px-4 py-3 tabular-nums font-semibold">${p.stock}</td>
                                                    <td class="px-4 py-3 whitespace-nowrap space-x-2">
                                                        <button type="button" data-edit-prod="${p.id}" class="edit-prod-btn text-gray-800 font-semibold hover:underline">Edit</button>
                                                        <button type="button" data-del-prod="${p.id}" class="del-prod-btn font-semibold ${confirmDel ? 'px-2 py-0.5 bg-red-600 text-white rounded' : 'text-red-600 hover:underline'}">
                                                            ${confirmDel ? 'Confirm Del' : 'Delete'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Uploaded Images Gallery -->
                        <div class="bg-white border border-gray-200 rounded overflow-hidden">
                            <div class="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                                <h3 class="font-display font-bold text-base text-gray-950">Uploaded Media Library (${uploadedImages.length})</h3>
                                <span class="text-[11px] text-gray-500">Click "+ Attach" to add to active product form</span>
                            </div>
                            ${uploadedImages.length === 0 ? `
                                <p class="p-5 text-xs text-gray-500">No custom images uploaded yet. Use the multi-image uploader on the left.</p>
                            ` : `
                                <div class="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-80 overflow-y-auto">
                                    ${uploadedImages.map((img) => {
                                        const confirmImg = adminState.pendingDeleteImageId === img.id;
                                        return `
                                            <div class="border border-gray-200 rounded overflow-hidden bg-gray-50 text-[11px]">
                                                <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.filename)}" class="w-full h-24 object-cover" />
                                                <div class="p-2 space-y-1 bg-white">
                                                    <p class="font-medium text-gray-900 truncate">${escapeHtml(img.filename)}</p>
                                                    <p class="text-[10px] text-gray-400 font-mono">${escapeHtml(img.storage || 'db')} · ${Math.max(1, Math.round((img.size || 0) / 1024))} KB</p>
                                                    <div class="flex items-center justify-between pt-1">
                                                        <button type="button" data-attach-img="${escapeHtml(img.url)}" class="attach-lib-img font-semibold text-brand-600 hover:underline">+ Attach</button>
                                                        <button type="button" data-del-img="${escapeHtml(img.id)}" class="del-lib-img font-semibold ${confirmImg ? 'text-red-700 underline' : 'text-red-500 hover:underline'}">
                                                            ${confirmImg ? 'Confirm?' : 'Delete'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        `;

        renderProductImagePreviewGrid();

        const fileInput = document.getElementById('prod-images-input');
        const dropzone = document.getElementById('prod-image-dropzone');
        fileInput?.addEventListener('change', (e) => {
            if (e.target.files?.length) {
                handleMultiImageUpload(e.target.files);
                e.target.value = '';
            }
        });
        if (dropzone) {
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('border-brand-500', 'bg-brand-50/40');
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('border-brand-500', 'bg-brand-50/40');
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('border-brand-500', 'bg-brand-50/40');
                if (e.dataTransfer?.files?.length) {
                    handleMultiImageUpload(e.dataTransfer.files);
                }
            });
        }

        document.getElementById('add-studio-img-btn')?.addEventListener('click', () => {
            const url = document.getElementById('studio-asset-select')?.value;
            if (url) {
                adminState.productImages.push(url);
                renderProductImagePreviewGrid();
            }
        });

        document.getElementById('add-custom-img-btn')?.addEventListener('click', () => {
            const inp = document.getElementById('custom-img-url-input');
            const val = inp?.value.trim();
            if (!val) return;
            adminState.productImages.push(val);
            inp.value = '';
            renderProductImagePreviewGrid();
        });

        container.querySelectorAll('.attach-lib-img').forEach((btn) => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.attachImg;
                if (url && !adminState.productImages.includes(url)) {
                    adminState.productImages.push(url);
                    renderProductImagePreviewGrid();
                    toast('Image attached to product form');
                }
            });
        });

        container.querySelectorAll('.del-lib-img').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.delImg;
                if (adminState.pendingDeleteImageId !== id) {
                    adminState.pendingDeleteImageId = id;
                    renderProductsTab(container);
                    return;
                }
                try {
                    await adminRequest(`/api/admin/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    adminState.pendingDeleteImageId = null;
                    toast('Image deleted from media storage');
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        document.getElementById('cancel-edit-prod')?.addEventListener('click', () => {
            adminState.editingProductId = null;
            adminState.productImages = [];
            renderProductsTab(container);
        });

        document.getElementById('admin-product-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const finalImages = adminState.productImages.length > 0
                ? adminState.productImages
                : ['/images/product_qled_tv.jpg'];

            const payload = {
                title: fd.get('title'),
                categorySlug: fd.get('categorySlug'),
                sku: fd.get('sku'),
                originalPrice: Number(fd.get('originalPrice')),
                discountPrice: Number(fd.get('discountPrice')),
                stock: Number(fd.get('stock')),
                brand: fd.get('brand'),
                images: finalImages,
                image: finalImages[0],
                variants: fd.get('variants'),
                tags: fd.get('tags'),
                description: fd.get('description'),
                isFeatured: fd.get('isFeatured') === 'on',
                isFlashSale: fd.get('isFlashSale') === 'on'
            };

            try {
                if (adminState.editingProductId) {
                    await adminRequest(`/api/admin/products/${adminState.editingProductId}`, {
                        method: 'PUT',
                        body: JSON.stringify(payload)
                    });
                    toast('Product updated with multi-image gallery');
                    adminState.editingProductId = null;
                } else {
                    await adminRequest('/api/admin/products', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    toast('Product added to catalog');
                }
                adminState.productImages = [];
                await loadAdminOverview();
            } catch (err) {
                toast(err.message, true);
            }
        });

        document.getElementById('admin-category-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try {
                await adminRequest('/api/admin/categories', {
                    method: 'POST',
                    body: JSON.stringify({ name: fd.get('name') })
                });
                toast('Category created');
                await loadAdminOverview();
            } catch (err) {
                toast(err.message, true);
            }
        });

        container.querySelectorAll('.edit-prod-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const pid = Number(btn.dataset.editProd);
                const prod = products.find((p) => p.id === pid);
                adminState.editingProductId = pid;
                adminState.productImages = [...(prod?.images || [])];
                renderProductsTab(container);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        container.querySelectorAll('.del-prod-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const pid = Number(btn.dataset.delProd);
                if (adminState.pendingDeleteProductId !== pid) {
                    adminState.pendingDeleteProductId = pid;
                    renderProductsTab(container);
                    return;
                }
                try {
                    await adminRequest(`/api/admin/products/${pid}`, { method: 'DELETE' });
                    adminState.pendingDeleteProductId = null;
                    toast('Product deleted');
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

        container.querySelectorAll('.del-cat-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest(`/api/admin/categories/${btn.dataset.delCat}`, { method: 'DELETE' });
                    toast('Category deleted');
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    function renderLinkWhatsAppTab(container) {
        const ws = adminState.overview?.whatsappStatus || {};
        const adminNum = adminState.overview?.config?.adminWhatsappNumber || '923299931199';
        const railwayUrl = ws.railwayUrl || adminState.overview?.config?.railwayUrl || '';
        const connected = ws.connectedSessions || [];
        const allSess = ws.allSessions || [];

        const backendStatusHtml = railwayUrl
            ? (ws.railwayReachable
                ? `<span class="px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">24/7 Railway Backend Connected (${escapeHtml(railwayUrl)})</span>`
                : `<span class="px-2.5 py-1 rounded bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">Railway Backend Unreachable (${escapeHtml(railwayUrl)})</span>`)
            : '<span class="px-2.5 py-1 rounded bg-gray-100 border border-gray-200 text-gray-800 text-xs font-semibold">Built-in Server Bot Active (Add Railway_URL in Variables for 24/7 Railway Host)</span>';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div class="lg:col-span-7 bg-white border border-gray-200 rounded p-6 space-y-5">
                    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
                        <div>
                            <h2 class="font-display text-lg font-bold text-gray-950">Link WhatsApp Number to Website</h2>
                            <p class="text-xs text-gray-500 mt-1">
                                Connect your store WhatsApp number so automated COD receipts, Confirm/Cancel buttons, and Customer Inquiries run live.
                            </p>
                        </div>
                        ${backendStatusHtml}
                    </div>

                    <form id="link-wa-form" class="space-y-3">
                        <div class="flex items-center justify-between">
                            <label for="link-wa-phone-input" class="text-xs font-semibold text-gray-700">
                                WhatsApp Number (with Country Code, e.g. 923299931199)
                            </label>
                            <button id="fill-admin-wa-btn" type="button" class="text-xs font-semibold text-brand-600 hover:underline">
                                Use Admin_Whatsapp (+${escapeHtml(adminNum)})
                            </button>
                        </div>
                        <div class="flex flex-col sm:flex-row gap-2.5">
                            <input
                                id="link-wa-phone-input"
                                required
                                value="${escapeHtml(adminNum)}"
                                placeholder="923299931199"
                                class="flex-1 h-11 px-3.5 border border-gray-300 rounded text-sm font-mono focus:border-wa-600 focus:outline-none"
                            />
                            <button id="link-wa-submit-btn" type="submit" class="h-11 px-6 bg-wa-600 hover:bg-wa-700 text-white text-sm font-semibold rounded shrink-0">
                                Link Number (Get Pairing Code)
                            </button>
                        </div>
                    </form>

                    <div id="link-wa-code-output" class="hidden p-5 bg-emerald-50 border border-emerald-200 rounded text-center space-y-2"></div>

                    <div class="bg-gray-50 border border-gray-200 rounded p-4 text-xs text-gray-700 space-y-1.5">
                        <p class="font-bold text-gray-900">How to Link Your Phone in 15 Seconds:</p>
                        <ol class="list-decimal list-inside space-y-1">
                            <li>Enter your WhatsApp mobile number above and click <strong>Link Number</strong>.</li>
                            <li>Open WhatsApp on your phone → <strong>Settings / ⋮ → Linked Devices → Link a Device</strong>.</li>
                            <li>Tap <strong>Link with phone number instead</strong> at the bottom and enter the 8-digit code shown above.</li>
                            <li>Once linked, this website automatically keeps your WhatsApp bot active 24/7 via silent keep-alive pings.</li>
                        </ol>
                    </div>
                </div>

                <div class="lg:col-span-5 bg-white border border-gray-200 rounded p-6 space-y-4 h-fit">
                    <div class="flex items-center justify-between border-b border-gray-100 pb-3">
                        <h3 class="font-display font-bold text-base text-gray-950">Linked WhatsApp Devices</h3>
                        <span class="px-2.5 py-0.5 rounded text-xs font-semibold ${connected.length ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                            ${connected.length ? `${connected.length} Connected` : 'Not Linked'}
                        </span>
                    </div>

                    <div id="linked-wa-sessions-list" class="space-y-2.5 text-xs">
                        ${allSess.length ? allSess.map((num) => {
                            const isOnline = connected.includes(num);
                            return `
                                <div class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-3.5 py-2.5">
                                    <div>
                                        <p class="font-mono font-bold text-sm text-gray-950">+${escapeHtml(num)}</p>
                                        <p class="text-[11px] font-semibold ${isOnline ? 'text-emerald-700' : 'text-amber-700'}">
                                            ${isOnline ? 'Connected & Receiving Messages' : 'Pairing / Reconnecting...'}
                                        </p>
                                    </div>
                                    <button type="button" data-del-sess="${escapeHtml(num)}" class="del-sess-btn px-3 py-1.5 border border-red-300 text-red-700 rounded text-xs font-semibold hover:bg-red-50">
                                        Unlink
                                    </button>
                                </div>
                            `;
                        }).join('') : '<p class="text-gray-500 py-4 text-center">No WhatsApp number linked yet. Use the form on the left to link your store number.</p>'}
                    </div>
                </div>
            </div>
        `;

        document.getElementById('fill-admin-wa-btn')?.addEventListener('click', () => {
            const inp = document.getElementById('link-wa-phone-input');
            if (inp) inp.value = adminNum;
        });

        document.getElementById('link-wa-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const phone = document.getElementById('link-wa-phone-input')?.value || '';
            const out = document.getElementById('link-wa-code-output');
            const btn = document.getElementById('link-wa-submit-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Requesting Code...';
            }
            if (out) {
                out.classList.remove('hidden');
                out.textContent = 'Contacting WhatsApp pairing servers...';
            }
            try {
                const res = await adminRequest('/api/pair', {
                    method: 'POST',
                    body: JSON.stringify({ phoneNumber: phone })
                });
                if (res.alreadyConnected) {
                    out.innerHTML = `<p class="text-sm font-bold text-emerald-800">${escapeHtml(res.message)}</p>`;
                } else {
                    out.innerHTML = `
                        <p class="text-xs font-semibold text-gray-700">Enter this 8-digit pairing code in WhatsApp → Linked Devices:</p>
                        <p class="font-mono text-3xl font-extrabold tracking-[0.2em] text-wa-700">${escapeHtml(res.code)}</p>
                        <p class="text-[11px] text-gray-500">Waiting for confirmation on your phone...</p>
                    `;
                }
                toast('Pairing code ready');
            } catch (err) {
                if (out) out.innerHTML = `<p class="text-xs font-semibold text-red-700">${escapeHtml(err.message)}</p>`;
                toast(err.message, true);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Link Number (Get Pairing Code)';
                }
            }
        });

        container.querySelectorAll('.del-sess-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest(`/api/whatsapp/session/${encodeURIComponent(btn.dataset.delSess)}`, { method: 'DELETE' });
                    toast('WhatsApp number unlinked');
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    function renderVariablesTab(container) {
        const vars = adminState.overview?.variables || [];
        const mediaDiag = adminState.overview?.mediaDiagnostics || {};
        const map = {};
        for (const v of vars) map[v.key] = v.value;

        container.innerHTML = `
            <form id="admin-variables-form" class="bg-white border border-gray-200 rounded p-6 max-w-4xl space-y-6">
                <div class="border-b border-gray-100 pb-3">
                    <h2 class="font-display text-lg font-bold text-gray-950">Environment &amp; Store Variables</h2>
                    <p class="text-xs text-gray-500 mt-1">
                        Configure <code class="font-mono">Admin_Username</code>, <code class="font-mono">Admin_Password</code>, <code class="font-mono">Admin_Whatsapp</code>, <code class="font-mono">Cloudinary_URI</code>, and <code class="font-mono">Railway_URL</code>.
                    </p>
                </div>

                <!-- Required Admin, Cloudinary & Railway Environment Variables -->
                <div class="bg-gray-50 border border-gray-200 rounded p-4 space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-xs font-bold uppercase tracking-wider text-gray-800">Core Security, Cloudinary &amp; 24/7 Railway Bot Bridge</h3>
                        <span class="text-[11px] font-semibold ${mediaDiag.activeBackend === 'cloudinary' ? 'text-emerald-700' : 'text-amber-700'}">
                            Media Storage: ${mediaDiag.activeBackend === 'cloudinary' ? `Cloudinary (${escapeHtml(mediaDiag.cloudinaryCloudName || 'Active')})` : 'SQLite Fallback (Add Cloudinary_URI)'}
                        </span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-gray-700 mb-1">Admin_Username</label>
                            <input name="Admin_Username" required value="${escapeHtml(map.Admin_Username || 'admin')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm font-mono bg-white" />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-gray-700 mb-1">Admin_Password</label>
                            <input name="Admin_Password" type="password" required value="${escapeHtml(map.Admin_Password || '')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm font-mono bg-white" />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-gray-700 mb-1">Admin_Whatsapp (Inquiry Recipient)</label>
                            <input name="Admin_Whatsapp" required value="${escapeHtml(map.Admin_Whatsapp || '923299931199')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm font-mono bg-white" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">Cloudinary_URI (cloudinary://api_key:api_secret@cloud_name)</label>
                        <input name="Cloudinary_URI" value="${escapeHtml(map.Cloudinary_URI || '')}" placeholder="cloudinary://123456789012345:your_api_secret@your_cloud_name" class="w-full h-10 px-3 border border-gray-300 rounded text-sm font-mono bg-white" />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">Railway_URL (Deployed /Railway Backend URL for 24/7 WhatsApp Bot)</label>
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input id="var-railway-url-input" name="Railway_URL" value="${escapeHtml(map.Railway_URL || '')}" placeholder="https://almumtaz-bot-production.up.railway.app" class="flex-1 h-10 px-3 border border-gray-300 rounded text-sm font-mono bg-white" />
                            <button id="test-railway-btn" type="button" class="h-10 px-4 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded shrink-0">
                                Test Railway Connection
                            </button>
                        </div>
                        <p id="railway-test-status" class="hidden text-xs font-semibold mt-1.5"></p>
                    </div>
                </div>

                <!-- Store & COD Delivery Rates -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">STORE_NAME</label>
                        <input name="STORE_NAME" value="${escapeHtml(map.STORE_NAME || 'Al-Mumtaz Electronics')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">STORE_PUBLIC_URL (For WhatsApp Store Link)</label>
                        <input name="STORE_PUBLIC_URL" value="${escapeHtml(map.STORE_PUBLIC_URL || '')}" placeholder="https://your-storefront-url" class="w-full h-10 px-3 border border-gray-300 rounded text-sm" />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">COD_FLAT_RATE (PKR)</label>
                        <input name="COD_FLAT_RATE" type="number" value="${escapeHtml(map.COD_FLAT_RATE || '250')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm tabular-nums" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">EXPRESS_COD_RATE (PKR)</label>
                        <input name="EXPRESS_COD_RATE" type="number" value="${escapeHtml(map.EXPRESS_COD_RATE || '550')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm tabular-nums" />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-gray-700 mb-1">FREE_DELIVERY_THRESHOLD (PKR)</label>
                        <input name="FREE_DELIVERY_THRESHOLD" type="number" value="${escapeHtml(map.FREE_DELIVERY_THRESHOLD || '35000')}" class="w-full h-10 px-3 border border-gray-300 rounded text-sm tabular-nums" />
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold text-gray-700 mb-1">CITY_RATES_JSON (City-Based COD Shipping Map)</label>
                    <textarea name="CITY_RATES_JSON" rows="3" class="w-full p-3 border border-gray-300 rounded text-xs font-mono">${escapeHtml(map.CITY_RATES_JSON || '{}')}</textarea>
                </div>

                <button type="submit" class="h-10 px-6 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded">
                    Save All Variables
                </button>
            </form>
        `;

        document.getElementById('test-railway-btn')?.addEventListener('click', async () => {
            const urlVal = document.getElementById('var-railway-url-input')?.value || '';
            const statusEl = document.getElementById('railway-test-status');
            if (statusEl) {
                statusEl.textContent = 'Pinging Railway backend /api/health...';
                statusEl.className = 'text-xs font-semibold text-gray-600 mt-1.5';
            }
            try {
                const res = await adminRequest('/api/admin/railway/test', {
                    method: 'POST',
                    body: JSON.stringify({ railwayUrl: urlVal })
                });
                if (statusEl) {
                    statusEl.textContent = `Connected to ${res.railwayUrl} (Uptime: ${res.health?.uptime || 0}s, WhatsApp Sessions: ${res.health?.whatsappConnectedSessions ?? 0})`;
                    statusEl.className = 'text-xs font-semibold text-emerald-700 mt-1.5';
                }
                toast('Railway backend reachable');
            } catch (err) {
                if (statusEl) {
                    statusEl.textContent = err.message;
                    statusEl.className = 'text-xs font-semibold text-red-600 mt-1.5';
                }
                toast(err.message, true);
            }
        });

        document.getElementById('admin-variables-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const variables = {};
            for (const [k, v] of fd.entries()) variables[k] = v;

            try {
                await adminRequest('/api/admin/variables', {
                    method: 'POST',
                    body: JSON.stringify({ variables })
                });
                toast('Environment & store variables saved');
                await loadAdminOverview();
            } catch (err) {
                toast(err.message, true);
            }
        });
    }

    function renderWhatsAppTab(container) {
        const inquiries = adminState.overview?.inquiries || [];
        const logs = adminState.overview?.whatsappLogs || [];
        const adminNum = adminState.overview?.config?.adminWhatsappNumber || '923299931199';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <!-- Left Column: Interactive 5-Button Bot & Inquiry Simulator -->
                <div class="lg:col-span-5 space-y-6">
                    <div class="bg-white border border-gray-200 rounded p-5 space-y-4">
                        <div class="border-b border-gray-100 pb-3">
                            <h3 class="font-display font-bold text-base text-gray-950">5-Button Store Bot &amp; Inquiry Tester</h3>
                            <p class="text-xs text-gray-500 mt-0.5">Test customer messages &amp; inquiry forwarding to Admin_Whatsapp (<span class="font-mono">+${escapeHtml(adminNum)}</span>).</p>
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                            <input id="bot-test-from" value="03001234567" placeholder="Customer Number" class="h-9 px-2.5 border border-gray-300 rounded text-xs font-mono" />
                            <input id="bot-test-name" value="Walk-in Buyer" placeholder="Customer Name" class="h-9 px-2.5 border border-gray-300 rounded text-xs" />
                        </div>

                        <div class="flex flex-wrap gap-1.5">
                            <button type="button" data-sim-msg="Assalam o Alaikum" class="sim-bot-btn px-2.5 py-1.5 bg-gray-900 text-white rounded text-[11px] font-semibold">Send "Hi"</button>
                            <button type="button" data-sim-msg="almumtaz_categories" class="sim-bot-btn px-2.5 py-1.5 border border-gray-300 rounded text-[11px] font-semibold hover:bg-gray-50">Items Categories</button>
                            <button type="button" data-sim-msg="almumtaz_offers" class="sim-bot-btn px-2.5 py-1.5 border border-gray-300 rounded text-[11px] font-semibold hover:bg-gray-50">Offered Items</button>
                            <button type="button" data-sim-msg="almumtaz_featured" class="sim-bot-btn px-2.5 py-1.5 border border-gray-300 rounded text-[11px] font-semibold hover:bg-gray-50">Featured Items</button>
                            <button type="button" data-sim-msg="almumtaz_store" class="sim-bot-btn px-2.5 py-1.5 border border-gray-300 rounded text-[11px] font-semibold hover:bg-gray-50">Browse Online Store</button>
                            <button type="button" data-sim-msg="almumtaz_inquiry" class="sim-bot-btn px-2.5 py-1.5 border border-brand-500 text-brand-700 bg-brand-50 rounded text-[11px] font-semibold">Contact For Inquiry</button>
                        </div>

                        <form id="bot-custom-msg-form" class="flex gap-2">
                            <input id="bot-custom-msg-input" placeholder="Reply with inquiry topic &amp; details..." class="flex-1 h-9 px-3 border border-gray-300 rounded text-xs" />
                            <button type="submit" class="h-9 px-3.5 bg-brand-500 text-white text-xs font-semibold rounded">Send</button>
                        </form>

                        <div id="bot-sim-preview" class="hidden bg-[#EFEAE2] border border-gray-200 rounded p-3 text-xs space-y-2"></div>
                    </div>
                </div>

                <!-- Right Column: Forwarded Inquiries & WhatsApp Audit Logs -->
                <div class="lg:col-span-7 space-y-6">
                    <div class="bg-white border border-gray-200 rounded overflow-hidden">
                        <div class="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                            <h3 class="font-display font-bold text-base text-gray-950">Customer Inquiries Forwarded to Admin (${inquiries.length})</h3>
                        </div>
                        <div class="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                            ${inquiries.map((inq) => `
                                <div class="p-4 text-xs space-y-1">
                                    <div class="flex justify-between font-semibold">
                                        <span class="text-gray-900">${escapeHtml(inq.senderName)} (<span class="font-mono">+${escapeHtml(inq.senderNumber)}</span>)</span>
                                        <span class="text-emerald-700 font-mono">→ Admin +${escapeHtml(inq.adminNumber)}</span>
                                    </div>
                                    <p class="text-gray-700">${escapeHtml(inq.description)}</p>
                                </div>
                            `).join('') || '<p class="p-5 text-xs text-gray-500">No inquiries submitted yet.</p>'}
                        </div>
                    </div>

                    <div class="bg-white border border-gray-200 rounded overflow-hidden">
                        <div class="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                            <h3 class="font-display font-bold text-base text-gray-950">WhatsApp Automation Logs (${logs.length})</h3>
                        </div>
                        <div class="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                            ${logs.map((log) => {
                                const btns = log.payload?.buttons || [];
                                const fullBody = log.payload?.text || log.summary;
                                return `
                                <div class="p-3.5 text-xs space-y-1.5">
                                    <div class="flex items-center justify-between">
                                        <span class="font-semibold ${log.direction === 'inbound' ? 'text-brand-600' : 'text-wa-600'}">
                                            ${escapeHtml(log.direction.toUpperCase())} · ${escapeHtml(log.messageType)} → ${escapeHtml(log.recipient)}
                                        </span>
                                        <span class="text-[11px] text-gray-400 font-mono">${escapeHtml(log.status)}</span>
                                    </div>
                                    <p class="text-gray-700 whitespace-pre-wrap leading-relaxed">${escapeHtml(fullBody)}</p>
                                    ${btns.length ? `<div class="flex flex-wrap gap-1.5 pt-0.5">${btns.map((b) => `<span class="px-2 py-0.5 bg-gray-100 border border-gray-300 rounded text-[10px] font-semibold text-gray-800">${escapeHtml(b.text)}</span>`).join('')}</div>` : ''}
                                </div>
                                `;
                            }).join('') || '<p class="p-5 text-xs text-gray-500">No WhatsApp dispatches logged yet.</p>'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const sendSimulated = async (text) => {
            const from = document.getElementById('bot-test-from').value;
            const senderName = document.getElementById('bot-test-name').value;
            try {
                const res = await adminRequest('/api/whatsapp/simulate-message', {
                    method: 'POST',
                    body: JSON.stringify({ from, senderName, text })
                });
                const preview = document.getElementById('bot-sim-preview');
                const outbound = (res.latestLogs || []).filter((l) => l.direction === 'outbound').slice(0, 2);
                preview.classList.remove('hidden');
                preview.innerHTML = outbound.map((l) => {
                    const btns = l.payload?.buttons || [];
                    return `
                        <div class="bg-white border border-gray-200 rounded p-3 space-y-2">
                            <p class="text-[11px] font-mono text-gray-500">To ${escapeHtml(l.recipient)} (${escapeHtml(l.messageType)})</p>
                            <pre class="whitespace-pre-wrap font-sans text-gray-900">${escapeHtml(l.payload?.text || l.summary)}</pre>
                            ${btns.length ? `<div class="flex flex-wrap gap-1.5 pt-1">${btns.map((b) => `<span class="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-[11px] font-semibold">${escapeHtml(b.text)}</span>`).join('')}</div>` : ''}
                        </div>
                    `;
                }).join('');
                await loadAdminOverview(true);
            } catch (err) {
                toast(err.message, true);
            }
        };

        container.querySelectorAll('.sim-bot-btn').forEach((btn) => {
            btn.addEventListener('click', () => sendSimulated(btn.dataset.simMsg));
        });

        document.getElementById('bot-custom-msg-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const inp = document.getElementById('bot-custom-msg-input');
            if (!inp.value.trim()) return;
            const val = inp.value.trim();
            inp.value = '';
            sendSimulated(val);
        });
    }

    function updateWaHeaderPill(ws = {}) {
        const pill = document.getElementById('admin-wa-link-pill');
        if (!pill) return;
        const connected = ws.connectedSessions || [];
        if (connected.length > 0) {
            pill.textContent = `WhatsApp Linked (+${connected[0]})`;
            pill.className = 'h-9 px-3 border border-emerald-300 bg-emerald-50 text-emerald-800 rounded text-xs font-semibold hover:bg-emerald-100';
        } else {
            pill.textContent = 'Link WhatsApp';
            pill.className = 'h-9 px-3 border border-amber-300 bg-amber-50 text-amber-800 rounded text-xs font-semibold hover:bg-amber-100';
        }
    }

    function renderActiveAdminTab() {
        const container = document.getElementById('admin-tab-content');
        if (!container) return;

        document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
            const active = btn.dataset.adminTab === adminState.activeTab;
            btn.className = active
                ? 'admin-tab-btn h-9 px-4 rounded text-sm font-semibold bg-gray-900 text-white'
                : 'admin-tab-btn h-9 px-4 rounded text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50';
        });

        switch (adminState.activeTab) {
            case 'link-whatsapp':
                renderLinkWhatsAppTab(container);
                break;
            case 'products':
                renderProductsTab(container);
                break;
            case 'variables':
                renderVariablesTab(container);
                break;
            case 'whatsapp':
                renderWhatsAppTab(container);
                break;
            case 'orders':
            default:
                renderOrdersTab(container);
                break;
        }
    }

    async function loadAdminOverview(keepPreview = false) {
        const existingPreviewHtml = keepPreview
            ? document.getElementById('bot-sim-preview')?.innerHTML
            : null;
        const existingPreviewHidden = keepPreview
            ? document.getElementById('bot-sim-preview')?.classList.contains('hidden')
            : true;

        try {
            const data = await adminRequest('/api/admin/overview');
            adminState.overview = data;
            renderKpis(data.stats);
            updateWaHeaderPill(data.whatsappStatus);
            renderActiveAdminTab();

            if (keepPreview && existingPreviewHtml && !existingPreviewHidden) {
                const p = document.getElementById('bot-sim-preview');
                if (p) {
                    p.innerHTML = existingPreviewHtml;
                    p.classList.remove('hidden');
                }
            }
        } catch (err) {
            toast(err.message, true);
        }
    }

    async function bootstrapSession() {
        try {
            const session = await adminRequest('/api/admin/session');
            if (session.authenticated) {
                showAuthView(true, session.username);
                await loadAdminOverview();
            } else {
                showAuthView(false);
            }
        } catch (_) {
            showAuthView(false);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('login-error-msg');
            const submitBtn = document.getElementById('admin-login-submit');
            errEl?.classList.add('hidden');

            const fd = new FormData(e.target);
            const username = String(fd.get('username') || '').trim();
            const password = String(fd.get('password') || '');

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Verifying Credentials...';
            }

            try {
                const res = await adminRequest('/api/admin/login', {
                    method: 'POST',
                    body: JSON.stringify({ username, password })
                });
                setStoredToken(res.token);
                showAuthView(true, res.username);
                toast('Signed in to Admin Portal');
                await loadAdminOverview();
            } catch (err) {
                if (errEl) {
                    errEl.textContent = err.message;
                    errEl.classList.remove('hidden');
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign In to Admin Portal';
                }
            }
        });

        document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
            try {
                await adminRequest('/api/admin/logout', { method: 'POST' });
            } catch (_) {}
            setStoredToken('');
            adminState.overview = null;
            showAuthView(false);
            toast('Signed out');
        });

        document.getElementById('admin-wa-link-pill')?.addEventListener('click', () => {
            adminState.activeTab = 'link-whatsapp';
            renderActiveAdminTab();
        });

        document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.activeTab = btn.dataset.adminTab;
                renderActiveAdminTab();
            });
        });

        document.getElementById('admin-refresh-btn')?.addEventListener('click', () => loadAdminOverview());

        const orderModal = document.getElementById('order-detail-modal');
        document.getElementById('order-detail-close-btn')?.addEventListener('click', () => orderModal?.classList.add('hidden'));
        orderModal?.addEventListener('click', (e) => {
            if (e.target === orderModal) orderModal.classList.add('hidden');
        });

        bootstrapSession();

        // Silent hidden auto-ping every 20 seconds so bot & Railway backend never sleep
        setInterval(() => {
            fetch('/api/keepalive', { cache: 'no-store' }).catch(() => {});
            if (adminState.authenticated && adminState.activeTab === 'link-whatsapp') {
                adminRequest('/api/whatsapp/status').then((ws) => {
                    if (adminState.overview) {
                        adminState.overview.whatsappStatus = ws;
                        updateWaHeaderPill(ws);
                    }
                }).catch(() => {});
            }
        }, 20000);
    });
})();
