'use strict';

(function () {
    const { formatPkr, escapeHtml } = window.AlMumtazAPI;
    const TOKEN_KEY = 'almumtaz_admin_token';

    const adminState = {
        authenticated: false,
        username: '',
        activeTab: 'dashboard',
        overview: null,
        filteredAnalytics: null,
        analyticsMode: 'all',
        analyticsCategory: 'all',
        analyticsStatus: 'all',
        editingProductId: null,
        productImages: [],
        orderSearch: '',
        orderStatusFilter: 'all',
        orderCategoryFilter: 'all',
        pendingDeleteOrderId: null,
        pendingDeleteProductId: null,
        pendingDeleteImageId: null,
        navOpen: false,
        navSearch: '',
        activeNavId: 'dashboard',
        productLowStockOnly: false,
        productVariants: [{ name: 'Standard', originalPrice: '', discountPrice: '', stock: '' }]
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
            { label: 'Total Revenue', value: formatPkr(stats.totalRevenue || 0), navId: 'analytics-all', accent: 'text-slate-950' },
            { label: 'Total Orders', value: stats.totalOrders || 0, navId: 'orders-all', accent: 'text-slate-950' },
            { label: 'Confirmed COD', value: stats.confirmedOrders || 0, navId: 'orders-confirmed', accent: 'text-emerald-700' },
            { label: 'Pending WhatsApp', value: stats.pendingOrders || 0, navId: 'orders-pending', accent: 'text-amber-700' },
            { label: 'Catalog Products', value: stats.totalProducts || 0, navId: 'products-inventory', accent: 'text-slate-950' },
            { label: 'Customer Inquiries', value: stats.totalInquiries || 0, navId: 'wa-inquiries', accent: 'text-brand-600' }
        ];

        grid.innerHTML = cards.map((c) => `
            <button type="button" data-kpi-nav="${escapeHtml(c.navId)}" class="admin-kpi-card bg-white border border-slate-200 hover:border-brand-500 rounded-xl p-4 text-left transition-colors group">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-brand-600 transition-colors">${escapeHtml(c.label)}</p>
                <p class="font-display text-xl font-extrabold ${c.accent} tabular-nums mt-1.5">${escapeHtml(String(c.value))}</p>
            </button>
        `).join('');

        grid.querySelectorAll('.admin-kpi-card').forEach((btn) => {
            btn.addEventListener('click', () => executeAdminNavAction(btn.dataset.kpiNav));
        });
    }

    function openOrderDetailModal(order) {
        const modal = document.getElementById('order-detail-modal');
        const body = document.getElementById('order-detail-body');
        if (!modal || !body || !order) return;

        const badgeClass =
            order.orderStatus === 'Confirmed' || order.orderStatus === 'Delivered'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : order.orderStatus === 'Dispatched' || order.orderStatus === 'Shipped'
                ? 'bg-sky-50 text-sky-800 border-sky-200'
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

    function getOrderCategorySlugs(order, products = []) {
        const byId = new Map(products.map((p) => [Number(p.id), p.categorySlug]));
        const bySku = new Map(products.map((p) => [String(p.sku || '').toUpperCase(), p.categorySlug]));
        const slugs = new Set();
        for (const item of order.items || []) {
            const slug = item.categorySlug || byId.get(Number(item.productId)) || bySku.get(String(item.sku || '').toUpperCase());
            if (slug) slugs.add(slug);
        }
        return slugs;
    }

    function renderOrdersTab(container) {
        const allOrders = adminState.overview?.orders || [];
        const products = adminState.overview?.products || [];
        const categories = adminState.overview?.categories || [];
        const q = adminState.orderSearch.trim().toLowerCase();
        const statusFilter = adminState.orderStatusFilter;
        const catFilter = adminState.orderCategoryFilter;

        const filtered = allOrders.filter((o) => {
            if (statusFilter !== 'all') {
                if (statusFilter === 'Dispatched') {
                    if (o.orderStatus !== 'Dispatched' && o.orderStatus !== 'Shipped') return false;
                } else if (o.orderStatus !== statusFilter) {
                    return false;
                }
            }
            if (catFilter !== 'all') {
                const slugs = getOrderCategorySlugs(o, products);
                if (!slugs.has(catFilter)) return false;
            }
            if (!q) return true;
            return (
                String(o.orderId || '').toLowerCase().includes(q) ||
                String(o.customerName || '').toLowerCase().includes(q) ||
                String(o.whatsappNumber || '').toLowerCase().includes(q) ||
                String(o.city || '').toLowerCase().includes(q)
            );
        });

        const statusOptions = ['Pending WhatsApp Confirmation', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'];

        container.innerHTML = `
            <div class="bg-white border border-gray-200 rounded overflow-hidden">
                <div class="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 class="font-display font-bold text-base text-gray-950">Live Cash on Delivery Orders (${filtered.length} / ${allOrders.length})</h2>
                        <p class="text-xs text-gray-500">Search, inspect receipts, manage status, trigger WhatsApp actions, or delete orders.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <input id="orders-search-input" type="search" value="${escapeHtml(adminState.orderSearch)}" placeholder="Search Order ID, name, phone, city..." class="h-9 px-3 border border-gray-300 rounded text-xs w-52 focus:border-brand-500 focus:outline-none" />
                        <select id="orders-category-filter" aria-label="Filter orders by category" class="h-9 px-2.5 border border-gray-300 rounded text-xs bg-white">
                            <option value="all" ${catFilter === 'all' ? 'selected' : ''}>All Categories</option>
                            ${categories.map((c) =>
                                `<option value="${escapeHtml(c.slug)}" ${catFilter === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
                            ).join('')}
                        </select>
                        <select id="orders-status-filter" aria-label="Filter orders by status" class="h-9 px-2.5 border border-gray-300 rounded text-xs bg-white">
                            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                            ${statusOptions.map((st) =>
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
                                            : o.orderStatus === 'Dispatched' || o.orderStatus === 'Shipped'
                                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                                            : o.orderStatus === 'Cancelled'
                                            ? 'bg-red-50 text-red-700 border-red-200'
                                            : 'bg-amber-50 text-amber-800 border-amber-200';
                                    const confirmPending = adminState.pendingDeleteOrderId === o.orderId;
                                    const rowStatusList = o.orderStatus === 'Shipped'
                                        ? [...statusOptions, 'Shipped']
                                        : statusOptions;
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
                                                    ${rowStatusList.map((st) =>
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

        document.getElementById('orders-category-filter')?.addEventListener('change', (e) => {
            adminState.orderCategoryFilter = e.target.value;
            renderOrdersTab(container);
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

    function renderVariantPricingRows() {
        const wrap = document.getElementById('prod-variants-rows');
        if (!wrap) return;
        const rows = Array.isArray(adminState.productVariants) && adminState.productVariants.length > 0
            ? adminState.productVariants
            : [{ name: 'Standard', originalPrice: '', discountPrice: '', stock: '' }];
        adminState.productVariants = rows;

        wrap.innerHTML = rows.map((v, idx) => `
            <div class="bg-white border border-gray-200 rounded p-2.5 space-y-2">
                <div class="flex items-center gap-1.5">
                    <div class="flex-1 min-w-0">
                        <label class="block text-[10px] font-bold uppercase text-gray-500 mb-0.5">Variant Name</label>
                        <input
                            type="text"
                            data-var-idx="${idx}"
                            data-var-field="name"
                            value="${escapeHtml(v.name || '')}"
                            placeholder="e.g. 55-Inch QLED"
                            class="var-row-input w-full h-8 px-2.5 border border-gray-300 rounded text-xs"
                        />
                    </div>
                    <button
                        type="button"
                        data-var-remove="${idx}"
                        ${rows.length <= 1 ? 'disabled' : ''}
                        aria-label="Remove variant"
                        class="var-row-remove mt-4 w-7 h-8 rounded text-xs font-bold shrink-0 ${rows.length <= 1 ? 'text-gray-300 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}"
                    >×</button>
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-gray-500 mb-0.5">Original (PKR)</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="originalPrice"
                            value="${escapeHtml(v.originalPrice ?? '')}"
                            placeholder="150000"
                            class="var-row-input w-full h-8 px-2 border border-gray-300 rounded text-xs tabular-nums"
                        />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-gray-500 mb-0.5">Sale (PKR)</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="discountPrice"
                            value="${escapeHtml(v.discountPrice ?? '')}"
                            placeholder="125000"
                            class="var-row-input w-full h-8 px-2 border border-gray-300 rounded text-xs tabular-nums"
                        />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-gray-500 mb-0.5">Stock</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="stock"
                            value="${escapeHtml(v.stock ?? '')}"
                            placeholder="10"
                            class="var-row-input w-full h-8 px-2 border border-gray-300 rounded text-xs tabular-nums"
                        />
                    </div>
                </div>
            </div>
        `).join('');

        wrap.querySelectorAll('.var-row-input').forEach((inp) => {
            inp.addEventListener('input', () => {
                const idx = Number(inp.dataset.varIdx);
                const field = inp.dataset.varField;
                if (adminState.productVariants[idx]) {
                    adminState.productVariants[idx][field] = inp.value;
                }
            });
        });

        wrap.querySelectorAll('.var-row-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (adminState.productVariants.length <= 1) return;
                adminState.productVariants.splice(Number(btn.dataset.varRemove), 1);
                renderVariantPricingRows();
            });
        });
    }

    function renderProductsTab(container) {
        const products = adminState.overview?.products || [];
        const categories = adminState.overview?.categories || [];
        const uploadedImages = adminState.overview?.uploadedImages || [];
        const mediaDiag = adminState.overview?.mediaDiagnostics || {};
        const editing = adminState.editingProductId
            ? products.find((p) => p.id === adminState.editingProductId)
            : null;
        const visibleProducts = adminState.productLowStockOnly
            ? products.filter((p) => Number(p.stock) <= 12)
            : products;

        const studioImages = [
            { label: '4K QLED Smart TV', url: '/images/product_qled_tv.jpg' },
            { label: 'Hybrid Solar Inverter & Battery', url: '/images/product_solar_inverter.jpg' },
            { label: 'Inverter Fridge & Split AC', url: '/images/product_refrigerator_ac.jpg' },
            { label: 'ANC Headphones & Smartwatch', url: '/images/product_audio_accessories.jpg' },
            { label: 'Showroom Hero Showcase', url: '/images/hero_electronics_showcase.jpg' }
        ];

        const backendBadge = mediaDiag.activeBackend === 'cloudinary'
            ? `<span class="inline-block px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold leading-snug">Cloudinary CDN Active (${escapeHtml(mediaDiag.cloudinaryCloudName || 'connected')})</span>`
            : '<span class="inline-block px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold leading-snug">SQLite Media Fallback (Set Cloudinary_URI in Variables for Cloud CDN)</span>';

        container.innerHTML = `
            <div class="space-y-6">
                <div class="bg-white border border-gray-200 rounded px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div class="text-xs text-gray-700 flex flex-wrap items-center gap-2 min-w-0">
                        <span class="font-bold text-gray-950">Direct Multi-Image Storage Engine:</span>
                        ${backendBadge}
                    </div>
                    <span class="text-xs text-gray-500 tabular-nums shrink-0">
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

                            <!-- Dynamic Variants & Per-Variant Pricing -->
                            <div id="admin-variants-box" class="border border-gray-200 rounded p-3.5 bg-gray-50/70 space-y-2.5">
                                <div class="flex items-center justify-between gap-2">
                                    <div>
                                        <p class="text-xs font-bold text-gray-900">Variants &amp; Per-Variant Prices (PKR)</p>
                                        <p class="text-[11px] text-gray-500">Set different Original &amp; Sale prices and stock for each variant.</p>
                                    </div>
                                    <button id="add-variant-row-btn" type="button" class="h-7 px-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded text-[11px] font-semibold whitespace-nowrap">
                                        + Add Variant Price
                                    </button>
                                </div>
                                <div id="prod-variants-rows" class="space-y-2"></div>
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
                    <div id="admin-catalog-inventory-box" class="lg:col-span-7 space-y-6">
                        <div class="bg-white border border-gray-200 rounded overflow-hidden">
                            <div class="px-5 py-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                                <h3 class="font-display font-bold text-base text-gray-950">
                                    Catalog Inventory (${visibleProducts.length}${adminState.productLowStockOnly ? ' Low Stock' : ''})
                                </h3>
                                <button id="toggle-low-stock-btn" type="button" class="h-8 px-3 rounded text-xs font-semibold border ${adminState.productLowStockOnly ? 'bg-amber-600 text-white border-amber-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}">
                                    ${adminState.productLowStockOnly ? 'Showing Low Stock (≤12) · Show All' : 'Low Stock Alerts (≤12)'}
                                </button>
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                    <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                                        <tr>
                                            <th class="px-4 py-3 font-semibold">Product</th>
                                            <th class="px-4 py-3 font-semibold">Sale / Orig &amp; Variants</th>
                                            <th class="px-4 py-3 font-semibold">Stock</th>
                                            <th class="px-4 py-3 font-semibold">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-gray-100">
                                        ${visibleProducts.map((p) => {
                                            const confirmDel = adminState.pendingDeleteProductId === p.id;
                                            const imgCount = (p.images || []).length;
                                            const vOpts = Array.isArray(p.variantOptions) ? p.variantOptions : [];
                                            const prices = vOpts.map((v) => Number(v.discountPrice)).filter((n) => n > 0);
                                            const minP = prices.length ? Math.min(...prices) : p.discountPrice;
                                            const maxP = prices.length ? Math.max(...prices) : p.discountPrice;
                                            const hasRange = prices.length > 1 && minP !== maxP;
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
                                                        <p class="font-bold text-brand-500">
                                                            ${hasRange ? `${formatPkr(minP)} – ${formatPkr(maxP)}` : `${formatPkr(p.discountPrice)} (-${p.discountPercentage}%)`}
                                                        </p>
                                                        <p class="text-gray-400 line-through">${formatPkr(p.originalPrice)}</p>
                                                        ${vOpts.length > 1 ? `<p class="text-[10px] text-gray-500 font-medium">${vOpts.length} variants configured</p>` : ''}
                                                    </td>
                                                    <td class="px-4 py-3 tabular-nums font-semibold">
                                                        <span class="${Number(p.stock) <= 10 ? 'text-amber-700 font-bold' : 'text-gray-900'}">${p.stock}</span>
                                                    </td>
                                                    <td class="px-4 py-3 whitespace-nowrap space-x-2">
                                                        <button type="button" data-restock-prod="${p.id}" class="restock-prod-btn text-emerald-700 font-semibold hover:underline">+5 Stock</button>
                                                        <button type="button" data-edit-prod="${p.id}" class="edit-prod-btn text-gray-800 font-semibold hover:underline">Edit</button>
                                                        <button type="button" data-del-prod="${p.id}" class="del-prod-btn font-semibold ${confirmDel ? 'px-2 py-0.5 bg-red-600 text-white rounded' : 'text-red-600 hover:underline'}">
                                                            ${confirmDel ? 'Confirm Del' : 'Delete'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('') || '<tr><td colspan="4" class="p-6 text-center text-gray-500">No products match this inventory filter.</td></tr>'}
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
        renderVariantPricingRows();

        document.getElementById('add-variant-row-btn')?.addEventListener('click', () => {
            const form = document.getElementById('admin-product-form');
            const origVal = form?.querySelector('input[name="originalPrice"]')?.value || '';
            const discVal = form?.querySelector('input[name="discountPrice"]')?.value || '';
            const stockVal = form?.querySelector('input[name="stock"]')?.value || '';
            adminState.productVariants.push({
                name: '',
                originalPrice: origVal,
                discountPrice: discVal,
                stock: stockVal
            });
            renderVariantPricingRows();
        });

        document.getElementById('toggle-low-stock-btn')?.addEventListener('click', () => {
            adminState.productLowStockOnly = !adminState.productLowStockOnly;
            renderProductsTab(container);
        });

        container.querySelectorAll('.restock-prod-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const pid = Number(btn.dataset.restockProd);
                const prod = products.find((p) => p.id === pid);
                if (!prod) return;
                const nextStock = (Number(prod.stock) || 0) + 5;
                try {
                    await adminRequest(`/api/admin/products/${pid}`, {
                        method: 'PUT',
                        body: JSON.stringify({ stock: nextStock })
                    });
                    toast(`Updated ${prod.title} stock to ${nextStock}`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });

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
            adminState.productVariants = [{ name: 'Standard', originalPrice: '', discountPrice: '', stock: '' }];
            renderProductsTab(container);
        });

        document.getElementById('admin-product-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const finalImages = adminState.productImages.length > 0
                ? adminState.productImages
                : ['/images/product_qled_tv.jpg'];

            const baseOrig = Number(fd.get('originalPrice'));
            const baseDisc = Number(fd.get('discountPrice'));
            const baseStock = Number(fd.get('stock'));

            const domVariantRows = Array.from(document.querySelectorAll('#prod-variants-rows > div')).map((rowEl) => ({
                name: rowEl.querySelector('[data-var-field="name"]')?.value || '',
                originalPrice: rowEl.querySelector('[data-var-field="originalPrice"]')?.value || '',
                discountPrice: rowEl.querySelector('[data-var-field="discountPrice"]')?.value || '',
                stock: rowEl.querySelector('[data-var-field="stock"]')?.value ?? ''
            }));
            const variantSource = domVariantRows.length > 0 ? domVariantRows : (adminState.productVariants || []);

            const cleanedVariants = variantSource
                .map((v) => ({
                    name: String(v.name || '').trim(),
                    originalPrice: Number(v.originalPrice) > 0 ? Number(v.originalPrice) : baseOrig,
                    discountPrice: Number(v.discountPrice) > 0 ? Number(v.discountPrice) : baseDisc,
                    stock: v.stock !== '' && v.stock !== undefined ? Math.max(0, parseInt(v.stock, 10) || 0) : baseStock
                }))
                .filter((v) => v.name);

            const finalVariants = cleanedVariants.length > 0
                ? cleanedVariants
                : [{ name: 'Standard', originalPrice: baseOrig, discountPrice: baseDisc, stock: baseStock }];

            const payload = {
                title: fd.get('title'),
                categorySlug: fd.get('categorySlug'),
                sku: fd.get('sku'),
                originalPrice: baseOrig,
                discountPrice: baseDisc,
                stock: baseStock,
                brand: fd.get('brand'),
                images: finalImages,
                image: finalImages[0],
                variants: finalVariants.map((v) => v.name),
                variantPricing: finalVariants,
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
                    toast('Product & variant prices updated');
                    adminState.editingProductId = null;
                } else {
                    await adminRequest('/api/admin/products', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    toast('Product added with variant prices');
                }
                adminState.productImages = [];
                adminState.productVariants = [{ name: 'Standard', originalPrice: '', discountPrice: '', stock: '' }];
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
                if (Array.isArray(prod?.variantOptions) && prod.variantOptions.length > 0) {
                    adminState.productVariants = prod.variantOptions.map((v) => ({
                        name: v.name,
                        originalPrice: v.originalPrice ?? prod.originalPrice,
                        discountPrice: v.discountPrice ?? prod.discountPrice,
                        stock: v.stock ?? prod.stock
                    }));
                } else if (Array.isArray(prod?.variants) && prod.variants.length > 0) {
                    adminState.productVariants = prod.variants.map((v) => ({
                        name: v,
                        originalPrice: prod.originalPrice,
                        discountPrice: prod.discountPrice,
                        stock: prod.stock
                    }));
                } else {
                    adminState.productVariants = [{
                        name: 'Standard',
                        originalPrice: prod?.originalPrice || '',
                        discountPrice: prod?.discountPrice || '',
                        stock: prod?.stock ?? ''
                    }];
                }
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

    function updateWaHeaderPill() {
        // Header stays clean with a single Navigation button; WhatsApp link status renders inside the Dashboard Hub and Link WhatsApp workspace.
    }

    async function refreshFilteredAnalytics(container) {
        try {
            const params = new URLSearchParams();
            if (adminState.analyticsCategory !== 'all') params.set('category', adminState.analyticsCategory);
            if (adminState.analyticsStatus !== 'all') params.set('status', adminState.analyticsStatus);
            const qs = params.toString();
            const res = await adminRequest(`/api/admin/analytics${qs ? `?${qs}` : ''}`);
            adminState.filteredAnalytics = res.analytics;
        } catch (err) {
            toast(err.message, true);
        }
        renderAnalyticsTab(container);
    }

    function renderAnalyticsTab(container) {
        const baseAnalytics = adminState.overview?.analytics;
        const activeFilterActive = adminState.analyticsCategory !== 'all' || adminState.analyticsStatus !== 'all';
        const analytics = (activeFilterActive && adminState.filteredAnalytics) ? adminState.filteredAnalytics : baseAnalytics;
        const categories = adminState.overview?.categories || [];

        if (!analytics) {
            container.innerHTML = '<div class="bg-white border border-gray-200 rounded p-8 text-center text-sm text-gray-500">Analytics data unavailable. Click Refresh to load.</div>';
            return;
        }

        const summary = analytics.summary || {};
        const byStatus = analytics.byStatus || [];
        const byCategories = analytics.byCategories || [];
        const byCity = analytics.byCity || [];
        const topProducts = analytics.topProducts || [];

        const statusStyleMap = {
            'Pending WhatsApp Confirmation': { border: 'border-amber-200', bg: 'bg-amber-50/70', bar: 'bg-amber-500', text: 'text-amber-900', pill: 'text-amber-700' },
            Confirmed: { border: 'border-emerald-200', bg: 'bg-emerald-50/70', bar: 'bg-emerald-600', text: 'text-emerald-950', pill: 'text-emerald-700' },
            Dispatched: { border: 'border-sky-200', bg: 'bg-sky-50/70', bar: 'bg-sky-600', text: 'text-sky-950', pill: 'text-sky-700' },
            Delivered: { border: 'border-teal-200', bg: 'bg-teal-50/70', bar: 'bg-teal-600', text: 'text-teal-950', pill: 'text-teal-700' },
            Cancelled: { border: 'border-red-200', bg: 'bg-red-50/70', bar: 'bg-red-600', text: 'text-red-950', pill: 'text-red-700' }
        };

        const modeBtnClass = (mode) =>
            adminState.analyticsMode === mode
                ? 'analytics-mode-btn h-9 px-4 rounded text-xs font-semibold bg-gray-900 text-white'
                : 'analytics-mode-btn h-9 px-4 rounded text-xs font-semibold bg-white border border-gray-300 text-gray-800 hover:bg-gray-50';

        const statusCardsHtml = `
            <div class="bg-white border border-gray-200 rounded p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 class="font-display font-bold text-base text-gray-950">Order Lifecycle Breakdown</h3>
                        <p class="text-xs text-gray-500">Click any status button (Confirmed Orders, Dispatched, Delivered, Pending, Cancelled) to filter analytics.</p>
                    </div>
                    ${adminState.analyticsStatus !== 'all' ? `
                        <button type="button" id="analytics-jump-status-orders" class="h-8 px-3 bg-gray-900 text-white rounded text-xs font-semibold hover:bg-gray-800">
                            Open "${escapeHtml(adminState.analyticsStatus)}" in Live Orders →
                        </button>
                    ` : ''}
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    ${byStatus.map((st) => {
                        const style = statusStyleMap[st.key] || statusStyleMap.Confirmed;
                        const selected = adminState.analyticsStatus === st.key;
                        return `
                            <button
                                type="button"
                                data-analytics-status="${escapeHtml(st.key)}"
                                class="analytics-status-btn text-left p-4 rounded border transition-colors ${selected ? 'ring-2 ring-brand-500 border-brand-500 bg-brand-50/40' : `${style.border} ${style.bg} hover:border-gray-400`}"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-[11px] font-bold uppercase tracking-wider ${style.pill}">${escapeHtml(st.label)}</span>
                                    <span class="text-[11px] font-mono font-semibold text-gray-600 tabular-nums">${st.sharePct}%</span>
                                </div>
                                <p class="font-display text-2xl font-extrabold text-gray-950 tabular-nums mt-1.5">${st.count}</p>
                                <p class="text-xs font-semibold text-gray-700 tabular-nums mt-0.5">${formatPkr(st.revenue)}</p>
                                <div class="w-full h-1.5 bg-white/90 rounded overflow-hidden mt-2.5 border border-black/5">
                                    <div class="h-full ${style.bar}" style="width: ${Math.max(st.count > 0 ? 6 : 0, st.sharePct)}%"></div>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        const byCategoriesHtml = `
            <div class="bg-white border border-gray-200 rounded overflow-hidden">
                <div class="px-5 py-4 border-b border-gray-200 space-y-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 class="font-display font-bold text-base text-gray-950">Analytics By Categories</h3>
                            <p class="text-xs text-gray-500">Compare order statuses, units sold, catalog stock, and PKR revenue across each electronics category.</p>
                        </div>
                        ${adminState.analyticsCategory !== 'all' ? `
                            <button type="button" id="analytics-jump-cat-orders" class="h-8 px-3 bg-brand-500 hover:bg-brand-600 text-white rounded text-xs font-semibold">
                                View Category Orders →
                            </button>
                        ` : ''}
                    </div>
                    ${(() => {
                        const filterCats = (baseAnalytics?.byCategories && baseAnalytics.byCategories.length)
                            ? baseAnalytics.byCategories
                            : categories;
                        return `
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            data-analytics-cat="all"
                            class="analytics-cat-btn h-8 px-3 rounded text-xs font-semibold ${adminState.analyticsCategory === 'all' ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}"
                        >
                            All Categories (${filterCats.length})
                        </button>
                        ${filterCats.map((cat) => `
                            <button
                                type="button"
                                data-analytics-cat="${escapeHtml(cat.slug)}"
                                class="analytics-cat-btn h-8 px-3 rounded text-xs font-semibold ${adminState.analyticsCategory === cat.slug ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}"
                            >
                                ${escapeHtml(cat.name)}
                            </button>
                        `).join('')}
                    </div>`;
                    })()}
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-gray-50 border-b border-gray-200 text-gray-600 uppercase">
                            <tr>
                                <th class="px-4 py-3 font-semibold">Category</th>
                                <th class="px-4 py-3 font-semibold">Items / Stock</th>
                                <th class="px-4 py-3 font-semibold">Units Sold</th>
                                <th class="px-4 py-3 font-semibold">Confirmed</th>
                                <th class="px-4 py-3 font-semibold">Dispatched</th>
                                <th class="px-4 py-3 font-semibold">Delivered</th>
                                <th class="px-4 py-3 font-semibold">Pending / Canc</th>
                                <th class="px-4 py-3 font-semibold">Revenue &amp; Share</th>
                                <th class="px-4 py-3 font-semibold">Orders</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${byCategories.map((cat) => {
                                const isSelected = adminState.analyticsCategory === cat.slug;
                                return `
                                    <tr class="${isSelected ? 'bg-brand-50/40' : 'hover:bg-gray-50/70'}">
                                        <td class="px-4 py-3">
                                            <p class="font-bold text-gray-950">${escapeHtml(cat.name)}</p>
                                            <p class="text-[11px] font-mono text-gray-400">${escapeHtml(cat.slug)}</p>
                                        </td>
                                        <td class="px-4 py-3 tabular-nums text-gray-700">${cat.productCount} SKUs · ${cat.totalStock} stock</td>
                                        <td class="px-4 py-3 tabular-nums font-bold text-gray-900">${cat.unitsSold}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-emerald-700">${cat.confirmedOrders}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-sky-700">${cat.dispatchedOrders}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-teal-700">${cat.deliveredOrders}</td>
                                        <td class="px-4 py-3 tabular-nums text-gray-600">${cat.pendingOrders} / <span class="text-red-600">${cat.cancelledOrders}</span></td>
                                        <td class="px-4 py-3 min-w-[160px]">
                                            <div class="flex items-center justify-between gap-2 tabular-nums">
                                                <span class="font-bold text-gray-950">${formatPkr(cat.revenue)}</span>
                                                <span class="text-[11px] text-gray-500">${cat.revenueSharePct}%</span>
                                            </div>
                                            <div class="w-full h-1.5 bg-gray-100 rounded overflow-hidden mt-1">
                                                <div class="h-full bg-brand-500" style="width: ${Math.max(cat.revenue > 0 ? 5 : 0, cat.revenueSharePct)}%"></div>
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            <button type="button" data-drill-cat="${escapeHtml(cat.slug)}" class="drill-cat-orders-btn px-2.5 py-1 border border-gray-300 bg-white hover:bg-gray-100 rounded text-[11px] font-semibold text-gray-800">
                                                View (${cat.totalOrders})
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('') || '<tr><td colspan="9" class="p-6 text-center text-gray-500">No category metrics available.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const secondaryInsightsHtml = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-white border border-gray-200 rounded overflow-hidden">
                    <div class="px-5 py-3.5 border-b border-gray-200">
                        <h3 class="font-display font-bold text-base text-gray-950">Top Electronics by Revenue</h3>
                    </div>
                    <div class="divide-y divide-gray-100">
                        ${topProducts.map((p, idx) => `
                            <div class="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                                <div class="min-w-0">
                                    <p class="font-bold text-gray-900 truncate">${idx + 1}. ${escapeHtml(p.title)}</p>
                                    <p class="text-[11px] text-gray-500">${escapeHtml(p.categoryName)} · ${p.unitsSold} unit(s) sold</p>
                                </div>
                                <span class="font-bold text-brand-600 tabular-nums shrink-0">${formatPkr(p.revenue)}</span>
                            </div>
                        `).join('') || '<p class="p-5 text-xs text-gray-500">No active order item sales recorded for this filter yet.</p>'}
                    </div>
                </div>

                <div class="bg-white border border-gray-200 rounded overflow-hidden">
                    <div class="px-5 py-3.5 border-b border-gray-200">
                        <h3 class="font-display font-bold text-base text-gray-950">Delivery Cities Performance</h3>
                    </div>
                    <div class="divide-y divide-gray-100">
                        ${byCity.map((c) => `
                            <div class="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                                <div>
                                    <p class="font-bold text-gray-900">${escapeHtml(c.city)}</p>
                                    <p class="text-[11px] text-gray-500">${c.orderCount} order(s) · ${c.deliveredCount} delivered</p>
                                </div>
                                <span class="font-bold text-gray-950 tabular-nums">${formatPkr(c.revenue)}</span>
                            </div>
                        `).join('') || '<p class="p-5 text-xs text-gray-500">No city order metrics for this filter yet.</p>'}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="space-y-6">
                <!-- Analytics Header & Mode Controls -->
                <div class="bg-white border border-gray-200 rounded p-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="font-display font-bold text-lg text-gray-950">Store Analytics &amp; Fulfillment Pipeline</h2>
                        <p class="text-xs text-gray-500 mt-0.5">
                            Live breakdown across Confirmed Orders, Dispatched, Delivered, Pending WhatsApp, Cancelled, and Product Categories.
                        </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" id="analytics-mode-categories" data-analytics-mode="categories" class="${modeBtnClass('categories')}">
                            By Categories
                        </button>
                        <button type="button" id="analytics-mode-status" data-analytics-mode="status" class="${modeBtnClass('status')}">
                            By Order Status
                        </button>
                        <button type="button" id="analytics-mode-all" data-analytics-mode="all" class="${modeBtnClass('all')}">
                            All Analytics
                        </button>
                        ${activeFilterActive ? `
                            <button type="button" id="analytics-reset-filters" class="h-9 px-3 rounded text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50">
                                Reset Filters
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Summary Metric Cards -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                    <div class="bg-white border border-gray-200 rounded p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Active Gross Revenue</p>
                        <p class="font-display text-xl font-extrabold text-gray-950 tabular-nums mt-1">${formatPkr(summary.grossRevenue || 0)}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5 tabular-nums">${summary.totalOrders || 0} total orders · ${summary.totalUnitsSold || 0} units</p>
                    </div>
                    <div class="bg-white border border-gray-200 rounded p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Confirmed + Dispatched + Delivered</p>
                        <p class="font-display text-xl font-extrabold text-emerald-700 tabular-nums mt-1">${summary.confirmedPipelineOrders || 0} Orders</p>
                        <p class="text-[11px] text-gray-500 mt-0.5 tabular-nums">${formatPkr(summary.confirmedPipelineRevenue || 0)} pipeline value</p>
                    </div>
                    <div class="bg-white border border-gray-200 rounded p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Delivered Revenue</p>
                        <p class="font-display text-xl font-extrabold text-teal-700 tabular-nums mt-1">${formatPkr(summary.deliveredRevenue || 0)}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5 tabular-nums">${summary.deliveredOrders || 0} delivered · ${summary.dispatchedOrders || 0} dispatched</p>
                    </div>
                    <div class="bg-white border border-gray-200 rounded p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Avg Order Value &amp; Confirmation</p>
                        <p class="font-display text-xl font-extrabold text-brand-600 tabular-nums mt-1">${formatPkr(summary.averageOrderValue || 0)}</p>
                        <p class="text-[11px] text-gray-500 mt-0.5 tabular-nums">${summary.confirmationRate || 0}% confirmation rate</p>
                    </div>
                </div>

                ${adminState.analyticsMode === 'categories' ? byCategoriesHtml + statusCardsHtml : ''}
                ${adminState.analyticsMode === 'status' ? statusCardsHtml + secondaryInsightsHtml : ''}
                ${adminState.analyticsMode === 'all' ? statusCardsHtml + byCategoriesHtml + secondaryInsightsHtml : ''}
            </div>
        `;

        container.querySelectorAll('.analytics-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.analyticsMode = btn.dataset.analyticsMode || 'all';
                renderAnalyticsTab(container);
            });
        });

        document.getElementById('analytics-reset-filters')?.addEventListener('click', () => {
            adminState.analyticsCategory = 'all';
            adminState.analyticsStatus = 'all';
            adminState.filteredAnalytics = null;
            renderAnalyticsTab(container);
        });

        container.querySelectorAll('.analytics-status-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const st = btn.dataset.analyticsStatus;
                adminState.analyticsStatus = adminState.analyticsStatus === st ? 'all' : st;
                refreshFilteredAnalytics(container);
            });
        });

        container.querySelectorAll('.analytics-cat-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.analyticsCategory = btn.dataset.analyticsCat || 'all';
                refreshFilteredAnalytics(container);
            });
        });

        container.querySelectorAll('.drill-cat-orders-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.orderCategoryFilter = btn.dataset.drillCat || 'all';
                adminState.orderStatusFilter = adminState.analyticsStatus || 'all';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
            });
        });

        document.getElementById('analytics-jump-status-orders')?.addEventListener('click', () => {
            adminState.orderStatusFilter = adminState.analyticsStatus || 'all';
            adminState.orderCategoryFilter = adminState.analyticsCategory || 'all';
            adminState.activeTab = 'orders';
            renderActiveAdminTab();
        });

        document.getElementById('analytics-jump-cat-orders')?.addEventListener('click', () => {
            adminState.orderCategoryFilter = adminState.analyticsCategory || 'all';
            adminState.orderStatusFilter = adminState.analyticsStatus || 'all';
            adminState.activeTab = 'orders';
            renderActiveAdminTab();
        });
    }

    function exportOrdersCsv() {
        const orders = adminState.overview?.orders || [];
        if (orders.length === 0) {
            toast('No orders available to export.', true);
            return;
        }
        const csvEscape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const header = ['Order ID', 'Customer Name', 'WhatsApp', 'City', 'Shipping Address', 'Items & Variants', 'Subtotal', 'Discount', 'COD Fee', 'Grand Total', 'Status', 'Order Date'];
        const lines = [header.map(csvEscape).join(',')];
        for (const o of orders) {
            const itemSummary = (o.items || []).map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} x${i.quantity}`).join(' | ');
            lines.push([
                o.orderId,
                o.customerName,
                o.whatsappNumber,
                o.city,
                o.shippingAddress,
                itemSummary,
                o.subtotal,
                o.discountTotal || 0,
                o.codDeliveryCharges || 0,
                o.grandTotal,
                o.orderStatus,
                o.orderDate
            ].map(csvEscape).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `almumtaz-cod-orders-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast(`Exported ${orders.length} order(s) to CSV`);
    }

    function renderDashboardTab(container) {
        const overview = adminState.overview || {};
        const orders = overview.orders || [];
        const ws = overview.whatsappStatus || {};
        const mediaDiag = overview.mediaDiagnostics || {};
        const cfg = overview.config || {};
        const connected = ws.connectedSessions || [];
        const railwayUrl = ws.railwayUrl || cfg.railwayUrl || '';
        const groups = getAdminNavigationGroups();
        const totalFeatures = groups.reduce((acc, g) => acc + g.items.length, 0);

        const groupIcons = {
            'Orders & Fulfillment': '<svg class="w-4 h-4 text-brand-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
            'Analytics & Reports': '<svg class="w-4 h-4 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13h4v8H3v-8zm7-6h4v14h-4V7zm7-4h4v18h-4V3z"/></svg>',
            'Catalog, Variants & Media': '<svg class="w-4 h-4 text-indigo-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10"/></svg>',
            'WhatsApp Bot & Railway 24/7': '<svg class="w-4 h-4 text-wa-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>',
            'Store Settings & System': '<svg class="w-4 h-4 text-slate-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>'
        };

        const latestOrders = orders.slice(0, 5);

        container.innerHTML = `
            <div class="space-y-6">
                <!-- Feature Hub Utility Bar -->
                <div class="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                        <h2 class="font-display font-bold text-base text-slate-950">Feature Hub (${totalFeatures} Modules)</h2>
                        <span class="text-xs font-medium text-slate-500">
                            WhatsApp: <strong class="${connected.length ? 'text-emerald-700' : 'text-amber-700'}">${connected.length ? `+${escapeHtml(connected[0])}` : 'Not Linked'}</strong>
                            · Media: <strong class="text-slate-800">${mediaDiag.activeBackend === 'cloudinary' ? 'Cloudinary' : 'SQLite'}</strong>
                            · Host: <strong class="text-slate-800">${railwayUrl ? (ws.railwayReachable ? 'Railway Online' : 'Railway Offline') : 'Local Server'}</strong>
                        </span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" id="dash-export-csv-btn" class="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-800 whitespace-nowrap transition-colors">
                            Export Orders CSV
                        </button>
                        <button type="button" id="dash-refresh-btn" class="h-8 px-3 bg-slate-950 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition-colors">
                            Refresh Data
                        </button>
                    </div>
                </div>

                <!-- Categorized Feature Access Buttons -->
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${groups.map((g) => `
                        <section class="bg-white border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col">
                            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                                <div class="flex items-center gap-2 min-w-0">
                                    ${groupIcons[g.group] || ''}
                                    <h3 class="font-display font-bold text-sm text-slate-950 truncate">${escapeHtml(g.group)}</h3>
                                </div>
                                <span class="text-[11px] font-mono font-semibold text-slate-400 tabular-nums shrink-0">${g.items.length}</span>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 content-start">
                                ${g.items.map((item) => `
                                    <button
                                        type="button"
                                        data-dash-action="${escapeHtml(item.id)}"
                                        class="dash-feature-btn text-left p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-brand-500 transition-colors group"
                                    >
                                        <span class="block text-xs font-bold text-slate-900 group-hover:text-brand-600 leading-snug">${escapeHtml(item.label)}</span>
                                        <span class="block text-[11px] text-slate-500 leading-tight mt-0.5 line-clamp-1">${escapeHtml(item.desc)}</span>
                                    </button>
                                `).join('')}
                            </div>
                        </section>
                    `).join('')}
                </div>

                <!-- Live Operational Glance: Recent COD Orders + Store Readiness -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div class="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div class="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
                            <h3 class="font-display font-bold text-sm text-slate-950">Latest Cash on Delivery Orders</h3>
                            <button type="button" data-dash-action="orders-all" class="dash-feature-btn text-xs font-semibold text-brand-600 hover:underline whitespace-nowrap">
                                Open Full Queue →
                            </button>
                        </div>
                        ${latestOrders.length === 0 ? `
                            <p class="p-6 text-xs text-slate-500 text-center">No COD orders recorded yet.</p>
                        ` : `
                            <div class="divide-y divide-slate-100">
                                ${latestOrders.map((o) => {
                                    const badgeClass =
                                        o.orderStatus === 'Confirmed' || o.orderStatus === 'Delivered'
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                            : o.orderStatus === 'Dispatched' || o.orderStatus === 'Shipped'
                                            ? 'bg-sky-50 text-sky-800 border-sky-200'
                                            : o.orderStatus === 'Cancelled'
                                            ? 'bg-red-50 text-red-700 border-red-200'
                                            : 'bg-amber-50 text-amber-800 border-amber-200';
                                    return `
                                        <div class="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50/70">
                                            <div class="min-w-0">
                                                <div class="flex items-center gap-2">
                                                    <span class="font-mono font-bold text-slate-950">#${escapeHtml(o.orderId)}</span>
                                                    <span class="px-2 py-0.5 text-[10px] font-semibold border rounded ${badgeClass}">${escapeHtml(o.orderStatus)}</span>
                                                </div>
                                                <p class="text-slate-600 truncate mt-0.5">${escapeHtml(o.customerName)} · ${escapeHtml(o.city)} · <span class="font-mono">${escapeHtml(o.whatsappNumber)}</span></p>
                                            </div>
                                            <div class="flex items-center gap-2 shrink-0">
                                                <span class="font-bold tabular-nums text-slate-950">${formatPkr(o.grandTotal)}</span>
                                                <button type="button" data-dash-order-view="${escapeHtml(o.orderId)}" class="dash-view-order-btn h-7 px-2.5 border border-slate-300 bg-white hover:bg-slate-100 rounded text-[11px] font-semibold text-slate-800">Details</button>
                                                ${o.orderStatus === 'Pending WhatsApp Confirmation' ? `
                                                    <button type="button" data-dash-confirm="${escapeHtml(o.orderId)}" data-dash-from="${escapeHtml(o.whatsappDigits)}" class="dash-confirm-order-btn h-7 px-2.5 bg-wa-600 hover:bg-wa-700 text-white rounded text-[11px] font-semibold">Confirm</button>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>

                    <div class="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3.5 h-fit">
                        <h3 class="font-display font-bold text-sm text-slate-950 border-b border-slate-100 pb-2.5">Store System Readiness</h3>
                        <div class="space-y-2.5 text-xs">
                            <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900">WhatsApp Link &amp; 24/7 Bot</p>
                                    <p class="text-slate-500 truncate">${connected.length ? `Connected: +${escapeHtml(connected[0])}` : 'Pair store phone via 8-digit code'}</p>
                                </div>
                                <button type="button" data-dash-action="wa-link" class="dash-feature-btn h-8 px-3 bg-wa-600 hover:bg-wa-700 text-white rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0">
                                    ${connected.length ? 'Manage' : 'Link Phone'}
                                </button>
                            </div>

                            <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900">Product Multi-Image Storage</p>
                                    <p class="text-slate-500 truncate">${mediaDiag.activeBackend === 'cloudinary' ? `Cloudinary CDN (${escapeHtml(mediaDiag.cloudinaryCloudName || 'Active')})` : 'SQLite Media Fallback'}</p>
                                </div>
                                <button type="button" data-dash-action="products-add" class="dash-feature-btn h-8 px-3 bg-slate-950 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0">
                                    + Add Item
                                </button>
                            </div>

                            <div class="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900">Railway Bridge &amp; Variables</p>
                                    <p class="text-slate-500 truncate">${railwayUrl ? escapeHtml(railwayUrl) : 'Built-in server mode active'}</p>
                                </div>
                                <button type="button" data-dash-action="vars-security" class="dash-feature-btn h-8 px-3 border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0">
                                    Configure
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.querySelectorAll('.dash-feature-btn').forEach((btn) => {
            btn.addEventListener('click', () => executeAdminNavAction(btn.dataset.dashAction));
        });

        document.getElementById('dash-export-csv-btn')?.addEventListener('click', () => exportOrdersCsv());
        document.getElementById('dash-refresh-btn')?.addEventListener('click', () => loadAdminOverview());

        container.querySelectorAll('.dash-view-order-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const ord = orders.find((o) => o.orderId === btn.dataset.dashOrderView);
                if (ord) openOrderDetailModal(ord);
            });
        });

        container.querySelectorAll('.dash-confirm-order-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest('/api/whatsapp/webhook', {
                        method: 'POST',
                        body: JSON.stringify({ buttonId: `confirm_order_${btn.dataset.dashConfirm}`, from: btn.dataset.dashFrom })
                    });
                    toast(`Confirmed #${btn.dataset.dashConfirm}`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    function getAdminNavigationGroups() {
        const orders = adminState.overview?.orders || [];
        const products = adminState.overview?.products || [];
        const inquiries = adminState.overview?.inquiries || [];
        const pendingCount = orders.filter((o) => o.orderStatus === 'Pending WhatsApp Confirmation').length;
        const confirmedCount = orders.filter((o) => o.orderStatus === 'Confirmed').length;
        const dispatchedCount = orders.filter((o) => o.orderStatus === 'Dispatched' || o.orderStatus === 'Shipped').length;
        const deliveredCount = orders.filter((o) => o.orderStatus === 'Delivered').length;
        const cancelledCount = orders.filter((o) => o.orderStatus === 'Cancelled').length;
        const lowStockCount = products.filter((p) => Number(p.stock) <= 12).length;

        return [
            {
                group: 'Orders & Fulfillment',
                items: [
                    { id: 'orders-all', label: `All Live Orders (${orders.length})`, desc: 'Full COD order queue & search' },
                    { id: 'orders-pending', label: `Pending WhatsApp (${pendingCount})`, desc: 'Awaiting buyer WhatsApp confirm' },
                    { id: 'orders-confirmed', label: `Confirmed Orders (${confirmedCount})`, desc: 'Verified COD orders ready to pack' },
                    { id: 'orders-dispatched', label: `Dispatched Orders (${dispatchedCount})`, desc: 'Shipped & in-transit parcels' },
                    { id: 'orders-delivered', label: `Delivered Orders (${deliveredCount})`, desc: 'Completed COD deliveries' },
                    { id: 'orders-cancelled', label: `Cancelled Orders (${cancelledCount})`, desc: 'Rejected or cancelled orders' }
                ]
            },
            {
                group: 'Analytics & Reports',
                items: [
                    { id: 'analytics-all', label: 'Full Store Analytics', desc: 'Complete revenue & pipeline overview' },
                    { id: 'analytics-categories', label: 'Analytics By Categories', desc: 'Department sales, stock & share' },
                    { id: 'analytics-status', label: 'Analytics By Order Status', desc: 'Confirmed, Dispatched & Delivered' },
                    { id: 'orders-export-csv', label: 'Export Orders CSV', desc: 'Download COD orders spreadsheet' }
                ]
            },
            {
                group: 'Catalog, Variants & Media',
                items: [
                    { id: 'products-add', label: 'Add Product & Variant Prices', desc: 'Create item with per-variant PKR prices' },
                    { id: 'products-inventory', label: `Catalog Inventory (${products.length})`, desc: 'Edit items, variants & prices' },
                    { id: 'products-lowstock', label: `Low Stock Alerts (${lowStockCount})`, desc: 'Filter low inventory & +5 restock' },
                    { id: 'products-categories', label: 'Categories Manager', desc: 'Add or remove store departments' },
                    { id: 'products-media', label: 'Multi-Image Media Library', desc: 'Cloudinary & SQLite photo manager' }
                ]
            },
            {
                group: 'WhatsApp Bot & Railway 24/7',
                items: [
                    { id: 'wa-link', label: 'Link WhatsApp Number', desc: 'Pair phone via 8-digit code' },
                    { id: 'wa-sessions', label: 'Active Linked Devices', desc: 'Check connected WhatsApp bots' },
                    { id: 'wa-bot-tester', label: '5-Button Bot Simulator', desc: 'Test Categories, Offers & Inquiry' },
                    { id: 'wa-inquiries', label: `Customer Inquiries (${inquiries.length})`, desc: 'View inquiries sent to Admin_Whatsapp' },
                    { id: 'wa-logs', label: 'WhatsApp Automation Logs', desc: 'Audit live inbound/outbound bot logs' }
                ]
            },
            {
                group: 'Store Settings & System',
                items: [
                    { id: 'vars-security', label: 'Security & Env Variables', desc: 'Admin credentials, Cloudinary & keys' },
                    { id: 'vars-cod-rates', label: 'City COD Delivery Rates', desc: 'Hasilpur & nationwide COD fees' },
                    { id: 'vars-test-railway', label: 'Test Railway 24/7 Bridge', desc: 'Live ping to Railway_URL health' },
                    { id: 'system-refresh', label: 'Refresh All Store Data', desc: 'Sync orders, inventory & bot status' }
                ]
            }
        ];
    }

    function toggleAdminNavigation(forceState = null) {
        adminState.navOpen = forceState !== null ? Boolean(forceState) : !adminState.navOpen;
        const drawer = document.getElementById('admin-nav-drawer');
        const toggleBtn = document.getElementById('admin-nav-toggle-btn');
        if (drawer) drawer.classList.toggle('hidden', !adminState.navOpen);
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', adminState.navOpen ? 'true' : 'false');
        if (adminState.navOpen) renderAdminNavigation();
    }

    async function executeAdminNavAction(navId) {
        adminState.activeNavId = navId;
        switch (navId) {
            case 'dashboard':
                adminState.activeTab = 'dashboard';
                renderActiveAdminTab();
                break;
            case 'orders-all':
                adminState.orderStatusFilter = 'all';
                adminState.orderCategoryFilter = 'all';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'orders-pending':
                adminState.orderStatusFilter = 'Pending WhatsApp Confirmation';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'orders-confirmed':
                adminState.orderStatusFilter = 'Confirmed';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'orders-dispatched':
                adminState.orderStatusFilter = 'Dispatched';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'orders-delivered':
                adminState.orderStatusFilter = 'Delivered';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'orders-cancelled':
                adminState.orderStatusFilter = 'Cancelled';
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
                break;
            case 'analytics-all':
                adminState.analyticsMode = 'all';
                adminState.activeTab = 'analytics';
                renderActiveAdminTab();
                break;
            case 'analytics-categories':
                adminState.analyticsMode = 'categories';
                adminState.activeTab = 'analytics';
                renderActiveAdminTab();
                break;
            case 'analytics-status':
                adminState.analyticsMode = 'status';
                adminState.activeTab = 'analytics';
                renderActiveAdminTab();
                break;
            case 'orders-export-csv':
                exportOrdersCsv();
                break;
            case 'products-add':
                adminState.editingProductId = null;
                adminState.productImages = [];
                adminState.productVariants = [{ name: 'Standard', originalPrice: '', discountPrice: '', stock: '' }];
                adminState.productLowStockOnly = false;
                adminState.activeTab = 'products';
                renderActiveAdminTab();
                document.getElementById('admin-product-form')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'products-inventory':
                adminState.productLowStockOnly = false;
                adminState.activeTab = 'products';
                renderActiveAdminTab();
                document.getElementById('admin-catalog-inventory-box')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'products-lowstock':
                adminState.productLowStockOnly = true;
                adminState.activeTab = 'products';
                renderActiveAdminTab();
                document.getElementById('admin-catalog-inventory-box')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'products-categories':
                adminState.activeTab = 'products';
                renderActiveAdminTab();
                document.getElementById('admin-category-form')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'products-media':
                adminState.activeTab = 'products';
                renderActiveAdminTab();
                document.getElementById('prod-image-dropzone')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'wa-link':
                adminState.activeTab = 'link-whatsapp';
                renderActiveAdminTab();
                break;
            case 'wa-sessions':
                adminState.activeTab = 'link-whatsapp';
                renderActiveAdminTab();
                document.getElementById('linked-wa-sessions-list')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'wa-bot-tester':
                adminState.activeTab = 'whatsapp';
                renderActiveAdminTab();
                break;
            case 'wa-inquiries':
                adminState.activeTab = 'whatsapp';
                renderActiveAdminTab();
                break;
            case 'wa-logs':
                adminState.activeTab = 'whatsapp';
                renderActiveAdminTab();
                break;
            case 'vars-security':
                adminState.activeTab = 'variables';
                renderActiveAdminTab();
                break;
            case 'vars-cod-rates':
                adminState.activeTab = 'variables';
                renderActiveAdminTab();
                document.querySelector('textarea[name="CITY_RATES_JSON"]')?.scrollIntoView({ behavior: 'smooth' });
                break;
            case 'vars-test-railway':
                adminState.activeTab = 'variables';
                renderActiveAdminTab();
                document.getElementById('test-railway-btn')?.click();
                break;
            case 'system-refresh':
                await loadAdminOverview();
                toast('Store data & analytics refreshed');
                break;
            default:
                break;
        }
        toggleAdminNavigation(false);
    }

    function renderAdminNavigation() {
        const inner = document.getElementById('admin-nav-drawer-inner');
        if (!inner) return;
        const groups = getAdminNavigationGroups();
        const q = adminState.navSearch.trim().toLowerCase();
        const totalButtons = groups.reduce((acc, g) => acc + g.items.length, 0);

        const filteredGroups = groups
            .map((g) => ({
                ...g,
                items: q
                    ? g.items.filter((it) => it.label.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q) || g.group.toLowerCase().includes(q))
                    : g.items
            }))
            .filter((g) => g.items.length > 0);

        inner.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                    <h2 class="font-display font-bold text-base text-white">Admin Navigation Directory (${totalButtons} Features)</h2>
                    <p class="text-xs text-slate-400">Jump directly to any order queue, category analytics view, variant price tool, WhatsApp bot utility, or cloud setting.</p>
                </div>
                <div class="flex items-center gap-2">
                    <button id="admin-nav-dashboard-btn" type="button" class="h-8 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-white whitespace-nowrap">
                        Dashboard Hub
                    </button>
                    <input
                        id="admin-nav-search"
                        type="search"
                        value="${escapeHtml(adminState.navSearch)}"
                        placeholder="Search navigation features..."
                        class="h-8 px-3 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-400 w-52 focus:border-brand-500 focus:outline-none"
                    />
                    <button id="admin-nav-close-btn" type="button" class="h-8 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 whitespace-nowrap">
                        Close ✕
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                ${filteredGroups.map((g) => `
                    <div class="space-y-2">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-1">${escapeHtml(g.group)}</p>
                        <div class="flex flex-col gap-1.5">
                            ${g.items.map((item) => {
                                const isActive = adminState.activeNavId === item.id;
                                return `
                                    <button
                                        type="button"
                                        data-nav-action="${escapeHtml(item.id)}"
                                        class="admin-nav-feature-btn text-left px-3 py-2 rounded-lg border transition-colors ${
                                            isActive
                                                ? 'border-brand-500 bg-brand-500/20 text-white'
                                                : 'border-slate-700 bg-slate-800/80 hover:bg-slate-800 hover:border-brand-500 text-white'
                                        }"
                                    >
                                        <span class="block text-xs font-bold leading-snug">${escapeHtml(item.label)}</span>
                                        <span class="block text-[10px] text-slate-400 leading-tight mt-0.5">${escapeHtml(item.desc)}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('') || '<p class="col-span-full text-xs text-slate-400 py-4 text-center">No navigation features match your search.</p>'}
            </div>
        `;

        const searchEl = document.getElementById('admin-nav-search');
        searchEl?.addEventListener('input', (e) => {
            adminState.navSearch = e.target.value;
            renderAdminNavigation();
            const refreshed = document.getElementById('admin-nav-search');
            if (refreshed) {
                refreshed.focus();
                refreshed.setSelectionRange(refreshed.value.length, refreshed.value.length);
            }
        });

        document.getElementById('admin-nav-dashboard-btn')?.addEventListener('click', () => executeAdminNavAction('dashboard'));
        document.getElementById('admin-nav-close-btn')?.addEventListener('click', () => toggleAdminNavigation(false));

        inner.querySelectorAll('.admin-nav-feature-btn').forEach((btn) => {
            btn.addEventListener('click', () => executeAdminNavAction(btn.dataset.navAction));
        });
    }

    function getWorkspaceTitle() {
        const map = {
            orders: 'Dashboard / Live Cash on Delivery Orders',
            analytics: 'Dashboard / Store Analytics & Fulfillment Pipeline',
            products: 'Dashboard / Catalog, Per-Variant Pricing & Media',
            'link-whatsapp': 'Dashboard / Link WhatsApp Number (24/7 Bot)',
            variables: 'Dashboard / Variables, Cloudinary & Railway URL',
            whatsapp: 'Dashboard / 5-Button Bot Simulator, Inquiries & Logs'
        };
        return map[adminState.activeTab] || 'Dashboard / Workspace';
    }

    function renderActiveAdminTab() {
        const container = document.getElementById('admin-tab-content');
        if (!container) return;

        const workspaceBar = document.getElementById('admin-workspace-bar');
        const workspaceTitle = document.getElementById('admin-workspace-title');
        const isDashboard = adminState.activeTab === 'dashboard';

        if (workspaceBar) workspaceBar.classList.toggle('hidden', isDashboard);
        if (workspaceTitle && !isDashboard) workspaceTitle.textContent = getWorkspaceTitle();

        switch (adminState.activeTab) {
            case 'dashboard':
                renderDashboardTab(container);
                break;
            case 'analytics':
                renderAnalyticsTab(container);
                break;
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
            if (adminState.navOpen) renderAdminNavigation();
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
                toast('Signed in to Admin Dashboard');
                await loadAdminOverview();
            } catch (err) {
                if (errEl) {
                    errEl.textContent = err.message;
                    errEl.classList.remove('hidden');
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign In to Dashboard';
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

        document.getElementById('admin-home-btn')?.addEventListener('click', () => {
            adminState.activeTab = 'dashboard';
            adminState.activeNavId = 'dashboard';
            toggleAdminNavigation(false);
            renderActiveAdminTab();
        });

        document.getElementById('admin-back-dashboard-btn')?.addEventListener('click', () => {
            adminState.activeTab = 'dashboard';
            adminState.activeNavId = 'dashboard';
            toggleAdminNavigation(false);
            renderActiveAdminTab();
        });

        document.getElementById('admin-nav-toggle-btn')?.addEventListener('click', () => {
            toggleAdminNavigation();
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
                    }
                }).catch(() => {});
            }
        }, 20000);
    });
})();
