'use strict';

(function () {
    const { formatPkr, escapeHtml } = window.AlMumtazAPI;
    const TOKEN_KEY = 'almumtaz_admin_token';

    const adminState = {
        authenticated: false,
        username: '',
        activeTab: 'orders',
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
        orderPriceFilter: 'all',
        orderSortBy: 'newest',
        selectedOrderId: null,
        checkedOrderIds: new Set(),
        pendingDeleteOrderId: null,
        pendingDeleteProductId: null,
        pendingDeleteImageId: null,
        navOpen: false,
        navSearch: '',
        activeNavId: 'orders-all',
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
        el.className = `fixed bottom-5 right-5 z-[60] max-w-sm px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border ${
            isError
                ? 'bg-red-700 text-white border-red-800'
                : 'bg-[#11151C] text-white border-slate-700'
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
            if (userBadge) userBadge.textContent = username || 'admin';
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

    function getInitials(name) {
        const parts = String(name || 'Guest').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return 'AM';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function getAvatarTone(seedStr) {
        const tones = [
            'bg-amber-100 text-amber-900 border-amber-200',
            'bg-sky-100 text-sky-900 border-sky-200',
            'bg-emerald-100 text-emerald-900 border-emerald-200',
            'bg-rose-100 text-rose-900 border-rose-200',
            'bg-indigo-100 text-indigo-900 border-indigo-200',
            'bg-orange-100 text-orange-900 border-orange-200'
        ];
        let hash = 0;
        const str = String(seedStr || '');
        for (let i = 0; i < str.length; i += 1) {
            hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        }
        return tones[hash % tones.length];
    }

    function getOrderStatusPillMeta(status) {
        switch (status) {
            case 'Confirmed':
                return {
                    label: 'Confirmed',
                    cls: 'bg-[#E3F5E8] text-[#116B3A] border-[#C6EBD2]'
                };
            case 'Dispatched':
            case 'Shipped':
                return {
                    label: 'Dispatched',
                    cls: 'bg-[#FDE6D2] text-[#A2460B] border-[#FAD0AE]'
                };
            case 'Delivered':
                return {
                    label: 'Delivered',
                    cls: 'bg-[#B7F2C9] text-[#0D5B2B] border-[#93E7AE]'
                };
            case 'Cancelled':
                return {
                    label: 'Cancelled',
                    cls: 'bg-red-100 text-red-800 border-red-200'
                };
            default:
                return {
                    label: 'Pending WA',
                    cls: 'bg-[#FEF08A] text-[#715505] border-[#FDE047]'
                };
        }
    }

    function formatShortOrderDate(dateStr) {
        if (!dateStr) return 'Recent';
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return String(dateStr).slice(0, 12);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatDetailedOrderDate(dateStr) {
        if (!dateStr) return 'Just now';
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return String(dateStr);
        return d.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function setSidebarMobileOpen(isOpen) {
        const sidebar = document.getElementById('admin-sidebar');
        const backdrop = document.getElementById('admin-mobile-sidebar-backdrop');
        if (!sidebar || !backdrop) return;
        sidebar.classList.toggle('-translate-x-full', !isOpen);
        backdrop.classList.toggle('hidden', !isOpen);
    }

    function syncSidebarActiveUI() {
        const headingEl = document.getElementById('admin-page-heading');
        const titles = {
            orders: 'Orders',
            dashboard: 'Dashboard',
            products: 'Products',
            inquiries: 'Customers & Inquiries',
            analytics: 'Analytics',
            whatsapp: 'Notification & Bot',
            'link-whatsapp': 'Link WhatsApp',
            variables: 'Settings & Vars'
        };
        if (headingEl) {
            headingEl.textContent = titles[adminState.activeTab] || 'Admin Console';
        }

        document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
            const active = btn.dataset.sidebarTab === adminState.activeTab;
            btn.classList.toggle('bg-white', active);
            btn.classList.toggle('text-slate-950', active);
            btn.classList.toggle('font-semibold', active);
            btn.classList.toggle('shadow-sm', active);
            btn.classList.toggle('text-slate-400', !active);
            btn.classList.toggle('hover:text-white', !active);
            btn.classList.toggle('hover:bg-white/5', !active);
        });
    }

    function openOrderDetailModal(order) {
        const modal = document.getElementById('order-detail-modal');
        const body = document.getElementById('order-detail-body');
        if (!modal || !body || !order) return;

        const pill = getOrderStatusPillMeta(order.orderStatus);
        const shortCode = String(order.orderId || '').split('-').pop() || order.orderId;

        body.innerHTML = `
            <div class="border-b border-slate-100 pb-4 pr-8 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Order Receipt &amp; Fulfillment</p>
                    <h2 class="font-display text-xl font-extrabold text-slate-950 font-mono">#${escapeHtml(order.orderId)}</h2>
                    <p class="text-xs text-slate-500">Placed: ${escapeHtml(formatDetailedOrderDate(order.orderDate))} · Quick Code: ${escapeHtml(shortCode)} · Mode: ${escapeHtml(order.whatsappDispatchMode || 'baileys')}</p>
                </div>
                <span class="px-3 py-1 text-xs font-bold border rounded-full ${pill.cls}">${escapeHtml(order.orderStatus)}</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
                <div class="space-y-1">
                    <p class="font-semibold uppercase text-slate-500">Customer Details</p>
                    <p class="font-bold text-sm text-slate-900">${escapeHtml(order.customerName)}</p>
                    <p class="font-mono text-slate-700">${escapeHtml(order.whatsappNumber)}</p>
                </div>
                <div class="space-y-1">
                    <p class="font-semibold uppercase text-slate-500">Delivery Address</p>
                    <p class="font-semibold text-slate-900">${escapeHtml(order.shippingAddress)}</p>
                    <p class="text-slate-700">City: <strong>${escapeHtml(order.city)}</strong></p>
                    ${order.nearestLandmark ? `<p class="text-slate-600">Landmark: ${escapeHtml(order.nearestLandmark)}</p>` : ''}
                </div>
            </div>

            ${order.orderNotes ? `
                <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
                    <strong>Customer Note:</strong> ${escapeHtml(order.orderNotes)}
                </div>
            ` : ''}

            <div class="space-y-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Ordered Items</p>
                <div class="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                    ${(order.items || []).map((item) => `
                        <div class="p-3 flex items-center justify-between gap-3 text-xs bg-white">
                            <div class="flex items-center gap-3 min-w-0">
                                <img src="${escapeHtml(item.image || '/images/product_qled_tv.jpg')}" alt="" class="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" />
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900 truncate">${escapeHtml(item.title)}</p>
                                    <p class="text-slate-500">${item.variant ? `${escapeHtml(item.variant)} · ` : ''}Qty: ${item.quantity} × ${formatPkr(item.unitPrice || item.discountPrice)}</p>
                                </div>
                            </div>
                            <span class="font-bold tabular-nums text-slate-950 shrink-0">${formatPkr(item.lineTotal)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-1.5">
                <div class="flex justify-between text-slate-600">
                    <span>Items Subtotal</span>
                    <span class="tabular-nums font-semibold">${formatPkr(order.subtotal)}</span>
                </div>
                <div class="flex justify-between text-emerald-700">
                    <span>Discount Savings</span>
                    <span class="tabular-nums font-semibold">-${formatPkr(order.discountTotal || 0)}</span>
                </div>
                <div class="flex justify-between text-slate-600">
                    <span>COD Delivery Charges</span>
                    <span class="tabular-nums font-semibold">${order.codDeliveryCharges === 0 ? 'FREE' : formatPkr(order.codDeliveryCharges)}</span>
                </div>
                <div class="flex justify-between text-sm font-bold text-slate-950 border-t border-slate-200 pt-2">
                    <span>Grand Total (Cash on Delivery)</span>
                    <span class="tabular-nums text-brand-600">${formatPkr(order.grandTotal)}</span>
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
                <a href="/track/${encodeURIComponent(order.orderId)}" target="_blank" rel="noopener" class="h-9 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center">
                    Open Public Tracker →
                </a>
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
        const priceFilter = adminState.orderPriceFilter;

        let filtered = allOrders.filter((o) => {
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
            const total = Number(o.grandTotal || 0);
            if (priceFilter === 'under50' && total >= 50000) return false;
            if (priceFilter === '50to150' && (total < 50000 || total > 150000)) return false;
            if (priceFilter === 'over150' && total <= 150000) return false;

            if (!q) return true;
            return (
                String(o.orderId || '').toLowerCase().includes(q) ||
                String(o.customerName || '').toLowerCase().includes(q) ||
                String(o.whatsappNumber || '').toLowerCase().includes(q) ||
                String(o.city || '').toLowerCase().includes(q)
            );
        });

        if (adminState.orderSortBy === 'oldest') {
            filtered = [...filtered].sort((a, b) => String(a.orderDate || '').localeCompare(String(b.orderDate || '')));
        } else if (adminState.orderSortBy === 'highest') {
            filtered = [...filtered].sort((a, b) => Number(b.grandTotal || 0) - Number(a.grandTotal || 0));
        } else if (adminState.orderSortBy === 'lowest') {
            filtered = [...filtered].sort((a, b) => Number(a.grandTotal || 0) - Number(b.grandTotal || 0));
        }

        if (!adminState.selectedOrderId && filtered.length > 0) {
            adminState.selectedOrderId = filtered[0].orderId;
        }
        const selectedOrder =
            filtered.find((o) => o.orderId === adminState.selectedOrderId) ||
            allOrders.find((o) => o.orderId === adminState.selectedOrderId) ||
            filtered[0] ||
            null;

        const statusOptions = ['Pending WhatsApp Confirmation', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'];
        const allFilteredChecked =
            filtered.length > 0 && filtered.every((o) => adminState.checkedOrderIds.has(o.orderId));

        const renderInspectorHtml = (ord) => {
            if (!ord) {
                return `
                    <aside class="w-full xl:w-[340px] shrink-0 bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-3 h-fit">
                        <div class="w-12 h-12 rounded-full bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
                            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                        </div>
                        <p class="font-display font-bold text-sm text-slate-900">No Order Selected</p>
                        <p class="text-xs text-slate-500">Click any order row from the table to inspect buyer details, ordered items, and WhatsApp actions.</p>
                    </aside>
                `;
            }

            const pill = getOrderStatusPillMeta(ord.orderStatus);
            const initials = getInitials(ord.customerName);
            const avatarTone = getAvatarTone(ord.customerName);
            const confirmPending = adminState.pendingDeleteOrderId === ord.orderId;
            const rowStatusList = ord.orderStatus === 'Shipped' ? [...statusOptions, 'Shipped'] : statusOptions;
            const isPendingWa = ord.orderStatus === 'Pending WhatsApp Confirmation';
            const canCancel = ord.orderStatus !== 'Cancelled' && ord.orderStatus !== 'Delivered';
            const nextStatus =
                ord.orderStatus === 'Confirmed'
                    ? 'Dispatched'
                    : ord.orderStatus === 'Dispatched' || ord.orderStatus === 'Shipped'
                    ? 'Delivered'
                    : '';

            return `
                <aside id="order-inspector-panel" class="w-full xl:w-[340px] shrink-0 bg-white border border-slate-200 rounded-2xl p-5 space-y-5 h-fit shadow-xs">
                    <!-- Inspector Header -->
                    <div class="flex items-start justify-between gap-2">
                        <div class="space-y-1.5 min-w-0">
                            <h3 class="font-display font-bold text-base text-slate-950 font-mono truncate">Order #${escapeHtml(ord.orderId)}</h3>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${pill.cls}">${escapeHtml(pill.label)}</span>
                                <span class="text-[11px] text-slate-500">${escapeHtml(formatDetailedOrderDate(ord.orderDate))}</span>
                            </div>
                        </div>
                        <button type="button" id="inspector-close-btn" aria-label="Open full receipt" title="Open full receipt modal" class="w-8 h-8 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center shrink-0">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
                        </button>
                    </div>

                    <!-- Customer Profile & 3 Circular Quick Actions -->
                    <div class="border-y border-slate-100 py-5 text-center space-y-3">
                        <div class="w-14 h-14 rounded-full border mx-auto flex items-center justify-center font-display font-extrabold text-base ${avatarTone}">
                            ${escapeHtml(initials)}
                        </div>
                        <div>
                            <p class="font-display font-bold text-sm text-slate-950">${escapeHtml(ord.customerName)}</p>
                            <p class="text-xs font-mono text-slate-500 mt-0.5">${escapeHtml(ord.whatsappNumber)} · ${escapeHtml(ord.city)}</p>
                        </div>
                        <div class="flex items-center justify-center gap-2.5 pt-1">
                            <button type="button" data-wh-resend="${escapeHtml(ord.orderId)}" title="Resend WhatsApp Receipt" aria-label="Resend WhatsApp Receipt" class="wh-resend w-10 h-10 rounded-full bg-[#F7F8FA] hover:bg-slate-200 border border-slate-200 text-slate-800 flex items-center justify-center transition-colors">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                            </button>
                            <a href="tel:${escapeHtml(ord.whatsappNumber)}" title="Call Customer" aria-label="Call Customer" class="w-10 h-10 rounded-full bg-[#F7F8FA] hover:bg-slate-200 border border-slate-200 text-slate-800 flex items-center justify-center transition-colors">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                            </a>
                            <button type="button" data-view-order="${escapeHtml(ord.orderId)}" title="Open Full Receipt" aria-label="Open Full Receipt" class="view-order-btn w-10 h-10 rounded-full bg-[#F7F8FA] hover:bg-slate-200 border border-slate-200 text-slate-800 flex items-center justify-center transition-colors">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                            </button>
                        </div>
                    </div>

                    <!-- Order Items List -->
                    <div class="space-y-3">
                        <div class="flex items-center justify-between">
                            <p class="text-xs font-bold text-slate-900">Order items</p>
                            <span class="text-[11px] text-slate-400 tabular-nums">${(ord.items || []).reduce((a, b) => a + (b.quantity || 1), 0)} unit(s)</span>
                        </div>
                        <div class="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                            ${(ord.items || []).map((item) => `
                                <div class="flex items-center gap-3">
                                    <img src="${escapeHtml(item.image || '/images/product_qled_tv.jpg')}" alt="" class="w-11 h-11 rounded-xl object-cover bg-slate-100 border border-slate-200 shrink-0" />
                                    <div class="min-w-0 flex-1">
                                        <p class="text-xs font-semibold text-slate-900 truncate">${escapeHtml(item.title)}</p>
                                        <p class="text-[11px] text-slate-500 truncate">${item.variant ? `${escapeHtml(item.variant)} · ` : ''}Qty ${item.quantity}</p>
                                        <p class="text-xs font-bold text-slate-950 tabular-nums mt-0.5">${formatPkr(item.lineTotal)}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Delivery & Total -->
                    <div class="border-t border-slate-100 pt-3.5 space-y-2">
                        <div class="text-[11px] text-slate-500 leading-relaxed">
                            <span class="font-semibold text-slate-700">Ship to:</span> ${escapeHtml(ord.shippingAddress)}, ${escapeHtml(ord.city)}
                        </div>
                        <div class="flex items-baseline justify-between pt-1">
                            <span class="text-xs font-medium text-slate-500">Total</span>
                            <span class="font-display font-extrabold text-xl text-slate-950 tabular-nums">${formatPkr(ord.grandTotal)}</span>
                        </div>
                    </div>

                    <!-- Status Dropdown & Delete -->
                    <div class="flex items-center gap-2">
                        <select data-order-status="${escapeHtml(ord.orderId)}" aria-label="Update order status" class="order-status-select flex-1 h-9 px-2.5 border border-slate-200 bg-[#F7F8FA] rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:border-slate-400">
                            ${rowStatusList.map((st) => `<option value="${st}" ${ord.orderStatus === st ? 'selected' : ''}>${st}</option>`).join('')}
                        </select>
                        <button type="button" data-del-order="${escapeHtml(ord.orderId)}" class="del-order-btn h-9 px-3 border rounded-xl text-xs font-semibold transition-colors ${confirmPending ? 'bg-red-600 text-white border-red-700' : 'border-slate-200 text-red-600 hover:bg-red-50'}">
                            ${confirmPending ? 'Confirm?' : 'Delete'}
                        </button>
                    </div>

                    <!-- Dual ProfitPulse CTA Buttons (Obsidian + Warm Yellow) -->
                    <div class="grid grid-cols-2 gap-2.5 pt-1">
                        ${isPendingWa ? `
                            <button type="button" data-wh-confirm="${escapeHtml(ord.orderId)}" data-wh-from="${escapeHtml(ord.whatsappDigits)}" class="wh-sim-confirm h-11 px-3 rounded-xl bg-[#11151C] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors">
                                <span>Confirm</span>
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            </button>
                        ` : nextStatus ? `
                            <button type="button" data-quick-advance="${escapeHtml(ord.orderId)}" data-next-status="${escapeHtml(nextStatus)}" class="quick-advance-btn h-11 px-3 rounded-xl bg-[#11151C] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors">
                                <span>Mark ${escapeHtml(nextStatus)}</span>
                            </button>
                        ` : `
                            <button type="button" data-view-order="${escapeHtml(ord.orderId)}" class="view-order-btn h-11 px-3 rounded-xl bg-[#11151C] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors">
                                <span>Receipt</span>
                            </button>
                        `}

                        ${canCancel ? `
                            <button type="button" data-wh-cancel="${escapeHtml(ord.orderId)}" data-wh-from="${escapeHtml(ord.whatsappDigits)}" class="wh-sim-cancel h-11 px-3 rounded-xl bg-[#FEF08A] hover:bg-[#FDE047] text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors">
                                <span>Reject</span>
                                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
                            </button>
                        ` : `
                            <button type="button" data-wh-resend="${escapeHtml(ord.orderId)}" class="wh-resend h-11 px-3 rounded-xl bg-[#FEF08A] hover:bg-[#FDE047] text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors">
                                <span>Resend WA</span>
                            </button>
                        `}
                    </div>
                </aside>
            `;
        };

        container.innerHTML = `
            <div class="flex flex-col xl:flex-row gap-5 items-start">
                <!-- Center Orders Table Column -->
                <div class="flex-1 min-w-0 w-full space-y-4">
                    <!-- Filter Pill Bar -->
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <select id="orders-status-filter" aria-label="Filter orders by status" class="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none">
                                <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Any status</option>
                                ${statusOptions.map((st) => `<option value="${st}" ${statusFilter === st ? 'selected' : ''}>${st}</option>`).join('')}
                            </select>

                            <select id="orders-category-filter" aria-label="Filter orders by category" class="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none">
                                <option value="all" ${catFilter === 'all' ? 'selected' : ''}>All categories</option>
                                ${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${catFilter === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                            </select>

                            <select id="orders-price-filter" aria-label="Filter orders by price range" class="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none">
                                <option value="all" ${priceFilter === 'all' ? 'selected' : ''}>Rs. 1k – Rs. 500k+</option>
                                <option value="under50" ${priceFilter === 'under50' ? 'selected' : ''}>Under Rs. 50,000</option>
                                <option value="50to150" ${priceFilter === '50to150' ? 'selected' : ''}>Rs. 50k – Rs. 150k</option>
                                <option value="over150" ${priceFilter === 'over150' ? 'selected' : ''}>Over Rs. 150,000</option>
                            </select>
                        </div>

                        <div class="flex flex-wrap items-center gap-1.5">
                            <input id="orders-search-input" type="search" value="${escapeHtml(adminState.orderSearch)}" placeholder="Search #ORD, buyer..." class="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 w-36 sm:w-44 focus:border-slate-400 focus:outline-none" />
                            <select id="orders-sort-select" aria-label="Sort orders" class="h-8 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none">
                                <option value="newest" ${adminState.orderSortBy === 'newest' ? 'selected' : ''}>Sort by Date</option>
                                <option value="oldest" ${adminState.orderSortBy === 'oldest' ? 'selected' : ''}>Oldest First</option>
                                <option value="highest" ${adminState.orderSortBy === 'highest' ? 'selected' : ''}>Highest Total</option>
                                <option value="lowest" ${adminState.orderSortBy === 'lowest' ? 'selected' : ''}>Lowest Total</option>
                            </select>
                            <button id="orders-export-btn" type="button" class="h-8 px-3 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-800 whitespace-nowrap">
                                Export CSV
                            </button>
                        </div>
                    </div>

                    ${adminState.checkedOrderIds.size > 0 ? `
                        <div class="bg-[#11151C] text-white rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span class="font-semibold">${adminState.checkedOrderIds.size} order(s) selected</span>
                            <div class="flex items-center gap-2">
                                <button type="button" id="bulk-confirm-orders-btn" class="h-7 px-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold">Confirm Selected</button>
                                <button type="button" id="bulk-clear-orders-btn" class="h-7 px-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold">Clear</button>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Clean ProfitPulse Table Card -->
                    <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                        ${filtered.length === 0 ? `
                            <div class="p-10 text-center space-y-2">
                                <p class="font-display font-bold text-sm text-slate-900">No orders match the current filter.</p>
                                <button type="button" id="orders-clear-filters-btn" class="h-8 px-3.5 bg-[#11151C] text-white rounded-lg text-xs font-semibold">Reset Filters</button>
                            </div>
                        ` : `
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                    <thead class="border-b border-slate-100 text-slate-400">
                                        <tr>
                                            <th class="pl-4 pr-2 py-3.5 w-9">
                                                <input id="orders-select-all" type="checkbox" ${allFilteredChecked ? 'checked' : ''} aria-label="Select all orders" class="w-4 h-4 accent-[#11151C] rounded cursor-pointer" />
                                            </th>
                                            <th class="px-3 py-3.5 font-medium">Order</th>
                                            <th class="px-3 py-3.5 font-medium">Customer</th>
                                            <th class="px-3 py-3.5 font-medium">Status</th>
                                            <th class="px-3 py-3.5 font-medium">Total</th>
                                            <th class="px-3 py-3.5 font-medium">Date</th>
                                            <th class="pl-2 pr-4 py-3.5 font-medium text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100">
                                        ${filtered.map((o) => {
                                            const pill = getOrderStatusPillMeta(o.orderStatus);
                                            const isSelected = selectedOrder && selectedOrder.orderId === o.orderId;
                                            const isChecked = adminState.checkedOrderIds.has(o.orderId);
                                            const initials = getInitials(o.customerName);
                                            const avatarTone = getAvatarTone(o.customerName);
                                            return `
                                                <tr data-select-order="${escapeHtml(o.orderId)}" class="order-row cursor-pointer transition-all ${isSelected ? 'bg-slate-50 ring-1 ring-inset ring-slate-300 shadow-[0_2px_10px_rgba(15,23,42,0.06)]' : 'hover:bg-slate-50/80'}">
                                                    <td class="pl-4 pr-2 py-3.5 ${isSelected ? 'border-l-2 border-l-[#11151C]' : ''}" onclick="event.stopPropagation()">
                                                        <input type="checkbox" data-check-order="${escapeHtml(o.orderId)}" ${isChecked ? 'checked' : ''} aria-label="Select order ${escapeHtml(o.orderId)}" class="order-row-checkbox w-4 h-4 accent-[#11151C] rounded cursor-pointer" />
                                                    </td>
                                                    <td class="px-3 py-3.5 font-mono font-bold text-slate-950 whitespace-nowrap">#${escapeHtml(o.orderId)}</td>
                                                    <td class="px-3 py-3.5">
                                                        <div class="flex items-center gap-2.5 min-w-0">
                                                            <span class="w-7 h-7 rounded-full border text-[10px] font-bold flex items-center justify-center shrink-0 ${avatarTone}">${escapeHtml(initials)}</span>
                                                            <div class="min-w-0">
                                                                <p class="font-semibold text-slate-900 truncate max-w-[140px]">${escapeHtml(o.customerName)}</p>
                                                                <p class="text-[11px] font-mono text-slate-400 truncate">${escapeHtml(o.city)}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td class="px-3 py-3.5 whitespace-nowrap">
                                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${pill.cls}">${escapeHtml(pill.label)}</span>
                                                    </td>
                                                    <td class="px-3 py-3.5 font-bold tabular-nums whitespace-nowrap text-slate-950">${formatPkr(o.grandTotal)}</td>
                                                    <td class="px-3 py-3.5 text-slate-500 whitespace-nowrap">${escapeHtml(formatShortOrderDate(o.orderDate))}</td>
                                                    <td class="pl-2 pr-4 py-3.5 text-right whitespace-nowrap" onclick="event.stopPropagation()">
                                                        <button type="button" data-view-order="${escapeHtml(o.orderId)}" aria-label="Open order ${escapeHtml(o.orderId)} receipt" class="view-order-btn w-7 h-7 rounded-lg hover:bg-slate-200/80 text-slate-500 hover:text-slate-900 inline-flex items-center justify-center font-bold">
                                                            ⋯
                                                        </button>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        `}
                    </div>
                </div>

                <!-- Right Docked Order Inspector -->
                ${renderInspectorHtml(selectedOrder)}
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
        document.getElementById('orders-price-filter')?.addEventListener('change', (e) => {
            adminState.orderPriceFilter = e.target.value;
            renderOrdersTab(container);
        });
        document.getElementById('orders-sort-select')?.addEventListener('change', (e) => {
            adminState.orderSortBy = e.target.value;
            renderOrdersTab(container);
        });
        document.getElementById('orders-export-btn')?.addEventListener('click', () => exportOrdersCsv());

        document.getElementById('orders-clear-filters-btn')?.addEventListener('click', () => {
            adminState.orderSearch = '';
            adminState.orderStatusFilter = 'all';
            adminState.orderCategoryFilter = 'all';
            adminState.orderPriceFilter = 'all';
            renderOrdersTab(container);
        });

        document.getElementById('orders-select-all')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                filtered.forEach((o) => adminState.checkedOrderIds.add(o.orderId));
            } else {
                filtered.forEach((o) => adminState.checkedOrderIds.delete(o.orderId));
            }
            renderOrdersTab(container);
        });

        container.querySelectorAll('.order-row-checkbox').forEach((chk) => {
            chk.addEventListener('change', () => {
                const oid = chk.dataset.checkOrder;
                if (chk.checked) adminState.checkedOrderIds.add(oid);
                else adminState.checkedOrderIds.delete(oid);
                renderOrdersTab(container);
            });
        });

        document.getElementById('bulk-clear-orders-btn')?.addEventListener('click', () => {
            adminState.checkedOrderIds.clear();
            renderOrdersTab(container);
        });

        document.getElementById('bulk-confirm-orders-btn')?.addEventListener('click', async () => {
            const ids = Array.from(adminState.checkedOrderIds);
            try {
                for (const oid of ids) {
                    const ord = allOrders.find((o) => o.orderId === oid);
                    if (ord && ord.orderStatus === 'Pending WhatsApp Confirmation') {
                        await adminRequest('/api/whatsapp/webhook', {
                            method: 'POST',
                            body: JSON.stringify({ buttonId: `confirm_order_${oid}`, from: ord.whatsappDigits })
                        });
                    }
                }
                adminState.checkedOrderIds.clear();
                toast(`Confirmed ${ids.length} selected order(s)`);
                await loadAdminOverview();
            } catch (err) {
                toast(err.message, true);
            }
        });

        container.querySelectorAll('.order-row').forEach((row) => {
            row.addEventListener('click', () => {
                adminState.selectedOrderId = row.dataset.selectOrder;
                adminState.pendingDeleteOrderId = null;
                renderOrdersTab(container);
                if (window.innerWidth < 1280) {
                    document.getElementById('order-inspector-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });

        document.getElementById('inspector-close-btn')?.addEventListener('click', () => {
            if (selectedOrder) openOrderDetailModal(selectedOrder);
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

        container.querySelectorAll('.quick-advance-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await adminRequest(`/api/admin/orders/${encodeURIComponent(btn.dataset.quickAdvance)}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: btn.dataset.nextStatus })
                    });
                    toast(`Order #${btn.dataset.quickAdvance} marked ${btn.dataset.nextStatus}`);
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
                    toast(`Confirmed #${btn.dataset.whConfirm} via WhatsApp`);
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
                    toast(`Cancelled #${btn.dataset.whCancel}`);
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
                    if (adminState.selectedOrderId === oid) adminState.selectedOrderId = null;
                    toast(`Order #${oid} deleted`);
                    await loadAdminOverview();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    }

    function renderCustomersInquiriesTab(container) {
        const orders = adminState.overview?.orders || [];
        const inquiries = adminState.overview?.inquiries || [];

        const customerMap = new Map();
        for (const o of orders) {
            const key = o.whatsappDigits || o.whatsappNumber || o.customerName;
            if (!customerMap.has(key)) {
                customerMap.set(key, {
                    name: o.customerName,
                    phone: o.whatsappNumber,
                    city: o.city,
                    orders: 0,
                    totalSpend: 0,
                    lastOrderId: o.orderId,
                    lastOrderDate: o.orderDate
                });
            }
            const entry = customerMap.get(key);
            entry.orders += 1;
            if (o.orderStatus !== 'Cancelled') {
                entry.totalSpend += Number(o.grandTotal || 0);
            }
        }
        const customers = Array.from(customerMap.values()).sort((a, b) => b.totalSpend - a.totalSpend);

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                    <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h2 class="font-display font-bold text-base text-slate-950">Verified Store Customers (${customers.length})</h2>
                            <p class="text-xs text-slate-500">Aggregated from Cash on Delivery &amp; WhatsApp orders.</p>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="border-b border-slate-100 text-slate-400">
                                <tr>
                                    <th class="px-4 py-3 font-medium">Customer</th>
                                    <th class="px-4 py-3 font-medium">City</th>
                                    <th class="px-4 py-3 font-medium">Orders</th>
                                    <th class="px-4 py-3 font-medium">Active Spend</th>
                                    <th class="px-4 py-3 font-medium">Latest Order</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${customers.map((c) => `
                                    <tr class="hover:bg-slate-50">
                                        <td class="px-4 py-3">
                                            <div class="flex items-center gap-2.5">
                                                <span class="w-7 h-7 rounded-full border text-[10px] font-bold flex items-center justify-center shrink-0 ${getAvatarTone(c.name)}">${escapeHtml(getInitials(c.name))}</span>
                                                <div>
                                                    <p class="font-bold text-slate-900">${escapeHtml(c.name)}</p>
                                                    <p class="font-mono text-[11px] text-slate-500">${escapeHtml(c.phone)}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 text-slate-700">${escapeHtml(c.city)}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold">${c.orders}</td>
                                        <td class="px-4 py-3 tabular-nums font-bold text-slate-950">${formatPkr(c.totalSpend)}</td>
                                        <td class="px-4 py-3">
                                            <button type="button" data-jump-order="${escapeHtml(c.lastOrderId)}" class="jump-cust-order font-mono text-brand-600 hover:underline font-semibold">#${escapeHtml(c.lastOrderId)}</button>
                                        </td>
                                    </tr>
                                `).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-500">No customer orders recorded yet.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs h-fit">
                    <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                        <div>
                            <h2 class="font-display font-bold text-base text-slate-950">WhatsApp Inquiries (${inquiries.length})</h2>
                            <p class="text-xs text-slate-500">Customer inquiries forwarded to Admin_Whatsapp.</p>
                        </div>
                    </div>
                    <div class="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                        ${inquiries.map((inq) => `
                            <div class="p-4 text-xs space-y-1.5 hover:bg-slate-50">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="font-bold text-slate-900">${escapeHtml(inq.senderName)}</span>
                                    <span class="font-mono text-[11px] text-emerald-700">+${escapeHtml(inq.senderNumber)}</span>
                                </div>
                                <p class="text-slate-700 leading-relaxed">${escapeHtml(inq.description)}</p>
                                <p class="text-[10px] font-mono text-slate-400">Forwarded to +${escapeHtml(inq.adminNumber)} · ${escapeHtml(formatDetailedOrderDate(inq.createdAt))}</p>
                            </div>
                        `).join('') || '<p class="p-8 text-center text-xs text-slate-500">No inquiries submitted yet.</p>'}
                    </div>
                </div>
            </div>
        `;

        container.querySelectorAll('.jump-cust-order').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.selectedOrderId = btn.dataset.jumpOrder;
                adminState.activeTab = 'orders';
                renderActiveAdminTab();
            });
        });
    }

    function renderProductImagePreviewGrid() {
        const grid = document.getElementById('prod-images-preview-grid');
        if (!grid) return;

        if (adminState.productImages.length === 0) {
            grid.innerHTML = '<p class="col-span-full text-[11px] text-slate-400 italic py-2">No images attached yet. Upload files above or add a studio/URL image below.</p>';
            return;
        }

        grid.innerHTML = adminState.productImages.map((url, idx) => `
            <div class="relative border ${idx === 0 ? 'border-brand-500 ring-1 ring-brand-500/30' : 'border-slate-200'} rounded-xl overflow-hidden bg-slate-50 group">
                <img src="${escapeHtml(url)}" alt="Item image ${idx + 1}" class="w-full h-20 object-cover" />
                ${idx === 0 ? '<span class="absolute top-1 left-1 px-1.5 py-0.5 bg-brand-500 text-white text-[9px] font-bold uppercase rounded">Primary</span>' : ''}
                <div class="flex items-center justify-between gap-1 px-1.5 py-1 bg-white border-t border-slate-200 text-[10px]">
                    ${idx > 0
                        ? `<button type="button" data-img-primary="${idx}" class="prod-img-primary font-semibold text-slate-700 hover:text-brand-600">Set Primary</button>`
                        : '<span class="text-slate-400 font-medium">Cover</span>'}
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
            <div class="bg-white border border-slate-200 rounded-xl p-2.5 space-y-2">
                <div class="flex items-center gap-1.5">
                    <div class="flex-1 min-w-0">
                        <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Variant Name</label>
                        <input
                            type="text"
                            data-var-idx="${idx}"
                            data-var-field="name"
                            value="${escapeHtml(v.name || '')}"
                            placeholder="e.g. 55-Inch QLED"
                            class="var-row-input w-full h-8 px-2.5 border border-slate-300 rounded-lg text-xs"
                        />
                    </div>
                    <button
                        type="button"
                        data-var-remove="${idx}"
                        ${rows.length <= 1 ? 'disabled' : ''}
                        aria-label="Remove variant"
                        class="var-row-remove mt-4 w-7 h-8 rounded-lg text-xs font-bold shrink-0 ${rows.length <= 1 ? 'text-slate-300 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'}"
                    >×</button>
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Original (PKR)</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="originalPrice"
                            value="${escapeHtml(v.originalPrice ?? '')}"
                            placeholder="150000"
                            class="var-row-input w-full h-8 px-2 border border-slate-300 rounded-lg text-xs tabular-nums"
                        />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Sale (PKR)</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="discountPrice"
                            value="${escapeHtml(v.discountPrice ?? '')}"
                            placeholder="125000"
                            class="var-row-input w-full h-8 px-2 border border-slate-300 rounded-lg text-xs tabular-nums"
                        />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Stock</label>
                        <input
                            type="number"
                            data-var-idx="${idx}"
                            data-var-field="stock"
                            value="${escapeHtml(v.stock ?? '')}"
                            placeholder="10"
                            class="var-row-input w-full h-8 px-2 border border-slate-300 rounded-lg text-xs tabular-nums"
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
            ? `<span class="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold leading-snug">Cloudinary CDN Active (${escapeHtml(mediaDiag.cloudinaryCloudName || 'connected')})</span>`
            : '<span class="inline-block px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold leading-snug">SQLite Media Fallback (Set Cloudinary_URI in Settings for Cloud CDN)</span>';

        container.innerHTML = `
            <div class="space-y-5">
                <div class="bg-white border border-slate-200 rounded-2xl px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div class="text-xs text-slate-700 flex flex-wrap items-center gap-2 min-w-0">
                        <span class="font-bold text-slate-950">Direct Multi-Image Storage Engine:</span>
                        ${backendBadge}
                    </div>
                    <span class="text-xs text-slate-500 tabular-nums shrink-0">
                        Uploaded Media Files: <strong>${uploadedImages.length}</strong>
                    </span>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <!-- Product Create / Edit Form -->
                    <div class="lg:col-span-5 space-y-5">
                        <form id="admin-product-form" class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5">
                            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                                <h3 class="font-display font-bold text-base text-slate-950">${editing ? 'Edit Product' : 'Add New Product'}</h3>
                                ${editing ? '<button id="cancel-edit-prod" type="button" class="text-xs font-semibold text-slate-500 hover:text-slate-900">Cancel Edit</button>' : ''}
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-slate-700 mb-1">Product Title *</label>
                                <input name="title" required value="${escapeHtml(editing?.title || '')}" placeholder="e.g. Haier 50-Inch 4K Google TV" class="w-full h-9 px-3 border border-slate-300 rounded-xl text-sm" />
                            </div>

                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Category *</label>
                                    <select name="categorySlug" class="w-full h-9 px-2.5 border border-slate-300 rounded-xl text-sm bg-white">
                                        ${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${editing?.categorySlug === c.slug ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">SKU</label>
                                    <input name="sku" value="${escapeHtml(editing?.sku || '')}" placeholder="AME-TV-50" class="w-full h-9 px-3 border border-slate-300 rounded-xl text-sm font-mono" />
                                </div>
                            </div>

                            <div class="grid grid-cols-3 gap-3">
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Original (PKR) *</label>
                                    <input name="originalPrice" type="number" required value="${editing?.originalPrice || ''}" placeholder="150000" class="w-full h-9 px-2.5 border border-slate-300 rounded-xl text-sm tabular-nums" />
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Sale Price *</label>
                                    <input name="discountPrice" type="number" required value="${editing?.discountPrice || ''}" placeholder="125000" class="w-full h-9 px-2.5 border border-slate-300 rounded-xl text-sm tabular-nums" />
                                </div>
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1">Stock *</label>
                                    <input name="stock" type="number" required value="${editing?.stock ?? 10}" class="w-full h-9 px-2.5 border border-slate-300 rounded-xl text-sm tabular-nums" />
                                </div>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-slate-700 mb-1">Brand</label>
                                <input name="brand" value="${escapeHtml(editing?.brand || 'Al-Mumtaz')}" class="w-full h-9 px-3 border border-slate-300 rounded-xl text-sm" />
                            </div>

                            <!-- Direct Multiple Image Uploader -->
                            <div class="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 space-y-3">
                                <div class="flex items-center justify-between">
                                    <label for="prod-images-input" class="text-xs font-bold text-slate-900">
                                        Direct Multiple Image Upload
                                    </label>
                                    <span class="text-[11px] text-slate-500">Up to 10 images</span>
                                </div>

                                <div id="prod-image-dropzone" class="border-2 border-dashed border-slate-300 hover:border-brand-500 rounded-xl bg-white p-4 text-center cursor-pointer transition-colors">
                                    <input id="prod-images-input" type="file" multiple accept="image/*" class="sr-only" />
                                    <label for="prod-images-input" class="cursor-pointer block space-y-1">
                                        <span class="inline-block px-3 py-1.5 bg-[#11151C] text-white text-xs font-semibold rounded-lg">
                                            Select Multiple Images
                                        </span>
                                        <p class="text-[11px] text-slate-500">Or drag &amp; drop multiple item photos here to upload</p>
                                    </label>
                                    <p id="prod-upload-status" class="hidden"></p>
                                </div>

                                <div id="prod-images-preview-grid" class="grid grid-cols-3 gap-2"></div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-200">
                                    <div class="flex gap-1.5">
                                        <select id="studio-asset-select" class="flex-1 h-8 px-2 border border-slate-300 rounded-lg text-[11px] bg-white">
                                            ${studioImages.map((img) => `<option value="${img.url}">${img.label}</option>`).join('')}
                                        </select>
                                        <button id="add-studio-img-btn" type="button" class="h-8 px-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-800 hover:bg-slate-100 shrink-0">+ Asset</button>
                                    </div>
                                    <div class="flex gap-1.5">
                                        <input id="custom-img-url-input" type="url" placeholder="https://... image URL" class="flex-1 h-8 px-2 border border-slate-300 rounded-lg text-[11px] bg-white" />
                                        <button id="add-custom-img-btn" type="button" class="h-8 px-2.5 bg-white border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-800 hover:bg-slate-100 shrink-0">+ URL</button>
                                    </div>
                                </div>
                            </div>

                            <!-- Dynamic Variants & Per-Variant Pricing -->
                            <div id="admin-variants-box" class="border border-slate-200 rounded-xl p-3.5 bg-slate-50/70 space-y-2.5">
                                <div class="flex items-center justify-between gap-2">
                                    <div>
                                        <p class="text-xs font-bold text-slate-900">Variants &amp; Per-Variant Prices (PKR)</p>
                                        <p class="text-[11px] text-slate-500">Set different Original &amp; Sale prices and stock for each variant.</p>
                                    </div>
                                    <button id="add-variant-row-btn" type="button" class="h-7 px-2.5 bg-[#11151C] hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold whitespace-nowrap">
                                        + Add Variant
                                    </button>
                                </div>
                                <div id="prod-variants-rows" class="space-y-2"></div>
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-slate-700 mb-1">Tags (comma-separated)</label>
                                <input name="tags" value="${escapeHtml((editing?.tags || ['Featured']).join(', '))}" placeholder="Featured, Hot, Free Delivery" class="w-full h-9 px-3 border border-slate-300 rounded-xl text-sm" />
                            </div>

                            <div>
                                <label class="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                                <textarea name="description" rows="2" class="w-full p-2.5 border border-slate-300 rounded-xl text-sm">${escapeHtml(editing?.description || '')}</textarea>
                            </div>

                            <div class="flex items-center gap-5 pt-1 text-xs font-semibold text-slate-800">
                                <label class="flex items-center gap-2"><input type="checkbox" name="isFeatured" ${editing?.isFeatured ? 'checked' : ''} class="accent-[#E8531A]" /> Featured Item</label>
                                <label class="flex items-center gap-2"><input type="checkbox" name="isFlashSale" ${editing?.isFlashSale ? 'checked' : ''} class="accent-[#E8531A]" /> Flash Deal / Offered</label>
                            </div>

                            <button type="submit" class="w-full h-10 bg-[#11151C] hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors">
                                ${editing ? 'Save Product Changes' : 'Add Product to Catalog'}
                            </button>
                        </form>

                        <!-- Category Manager -->
                        <form id="admin-category-form" class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                            <h3 class="font-display font-bold text-base text-slate-950 border-b border-slate-100 pb-2">Add Category</h3>
                            <div class="flex gap-2">
                                <input name="name" required placeholder="Category Name" class="flex-1 h-9 px-3 border border-slate-300 rounded-xl text-sm" />
                                <button type="submit" class="h-9 px-4 bg-[#11151C] text-white text-xs font-semibold rounded-xl">Add</button>
                            </div>
                            <div class="flex flex-wrap gap-2 pt-2">
                                ${categories.map((c) => `
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium">
                                        ${escapeHtml(c.name)}
                                        <button type="button" data-del-cat="${c.id}" class="del-cat-btn text-red-600 font-bold hover:text-red-800">×</button>
                                    </span>
                                `).join('')}
                            </div>
                        </form>
                    </div>

                    <!-- Product Catalog Table + Uploaded Images Gallery -->
                    <div id="admin-catalog-inventory-box" class="lg:col-span-7 space-y-5">
                        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                            <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                <h3 class="font-display font-bold text-base text-slate-950">
                                    Catalog Inventory (${visibleProducts.length}${adminState.productLowStockOnly ? ' Low Stock' : ''})
                                </h3>
                                <button id="toggle-low-stock-btn" type="button" class="h-8 px-3 rounded-xl text-xs font-semibold border ${adminState.productLowStockOnly ? 'bg-amber-600 text-white border-amber-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}">
                                    ${adminState.productLowStockOnly ? 'Showing Low Stock (≤12) · Show All' : 'Low Stock Alerts (≤12)'}
                                </button>
                            </div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left text-xs">
                                    <thead class="bg-slate-50 border-b border-slate-100 text-slate-500">
                                        <tr>
                                            <th class="px-4 py-3 font-medium">Product</th>
                                            <th class="px-4 py-3 font-medium">Sale / Orig &amp; Variants</th>
                                            <th class="px-4 py-3 font-medium">Stock</th>
                                            <th class="px-4 py-3 font-medium">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100">
                                        ${visibleProducts.map((p) => {
                                            const confirmDel = adminState.pendingDeleteProductId === p.id;
                                            const imgCount = (p.images || []).length;
                                            const vOpts = Array.isArray(p.variantOptions) ? p.variantOptions : [];
                                            const prices = vOpts.map((v) => Number(v.discountPrice)).filter((n) => n > 0);
                                            const minP = prices.length ? Math.min(...prices) : p.discountPrice;
                                            const maxP = prices.length ? Math.max(...prices) : p.discountPrice;
                                            const hasRange = prices.length > 1 && minP !== maxP;
                                            return `
                                                <tr class="hover:bg-slate-50/70">
                                                    <td class="px-4 py-3">
                                                        <div class="flex items-center gap-3">
                                                            <img src="${escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg')}" alt="" class="w-10 h-10 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0" />
                                                            <div class="min-w-0">
                                                                <p class="font-bold text-slate-900">${escapeHtml(p.title)}</p>
                                                                <p class="text-[11px] text-slate-500">${escapeHtml(p.sku)} · ${escapeHtml(p.categorySlug)} · ${imgCount} photo${imgCount === 1 ? '' : 's'}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td class="px-4 py-3 tabular-nums">
                                                        <p class="font-bold text-brand-500">
                                                            ${hasRange ? `${formatPkr(minP)} – ${formatPkr(maxP)}` : `${formatPkr(p.discountPrice)} (-${p.discountPercentage}%)`}
                                                        </p>
                                                        <p class="text-slate-400 line-through">${formatPkr(p.originalPrice)}</p>
                                                        ${vOpts.length > 1 ? `<p class="text-[10px] text-slate-500 font-medium">${vOpts.length} variants configured</p>` : ''}
                                                    </td>
                                                    <td class="px-4 py-3 tabular-nums font-semibold">
                                                        <span class="${Number(p.stock) <= 10 ? 'text-amber-700 font-bold' : 'text-slate-900'}">${p.stock}</span>
                                                    </td>
                                                    <td class="px-4 py-3 whitespace-nowrap space-x-2">
                                                        <button type="button" data-restock-prod="${p.id}" class="restock-prod-btn text-emerald-700 font-semibold hover:underline">+5 Stock</button>
                                                        <button type="button" data-edit-prod="${p.id}" class="edit-prod-btn text-slate-800 font-semibold hover:underline">Edit</button>
                                                        <button type="button" data-del-prod="${p.id}" class="del-prod-btn font-semibold ${confirmDel ? 'px-2 py-0.5 bg-red-600 text-white rounded' : 'text-red-600 hover:underline'}">
                                                            ${confirmDel ? 'Confirm Del' : 'Delete'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('') || '<tr><td colspan="4" class="p-6 text-center text-slate-500">No products match this inventory filter.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Uploaded Images Gallery -->
                        <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                            <div class="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                                <h3 class="font-display font-bold text-base text-slate-950">Uploaded Media Library (${uploadedImages.length})</h3>
                                <span class="text-[11px] text-slate-500">Click "+ Attach" to add to active product form</span>
                            </div>
                            ${uploadedImages.length === 0 ? `
                                <p class="p-5 text-xs text-slate-500">No custom images uploaded yet. Use the multi-image uploader on the left.</p>
                            ` : `
                                <div class="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-80 overflow-y-auto">
                                    ${uploadedImages.map((img) => {
                                        const confirmImg = adminState.pendingDeleteImageId === img.id;
                                        return `
                                            <div class="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 text-[11px]">
                                                <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.filename)}" class="w-full h-24 object-cover" />
                                                <div class="p-2 space-y-1 bg-white">
                                                    <p class="font-medium text-slate-900 truncate">${escapeHtml(img.filename)}</p>
                                                    <p class="text-[10px] text-slate-400 font-mono">${escapeHtml(img.storage || 'db')} · ${Math.max(1, Math.round((img.size || 0) / 1024))} KB</p>
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
                ? `<span class="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">24/7 Railway Backend Connected (${escapeHtml(railwayUrl)})</span>`
                : `<span class="px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">Railway Backend Unreachable (${escapeHtml(railwayUrl)})</span>`)
            : '<span class="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-xs font-semibold">Built-in Server Bot Active (Add Railway_URL for 24/7 Railway Host)</span>';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                        <div>
                            <h2 class="font-display text-lg font-bold text-slate-950">Link WhatsApp Number to Website</h2>
                            <p class="text-xs text-slate-500 mt-1">
                                Connect your store WhatsApp number so automated COD receipts, Confirm/Cancel buttons, live product cards, and Order Tracking run live.
                            </p>
                        </div>
                        ${backendStatusHtml}
                    </div>

                    <form id="link-wa-form" class="space-y-3">
                        <div class="flex items-center justify-between">
                            <label for="link-wa-phone-input" class="text-xs font-semibold text-slate-700">
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
                                class="flex-1 h-11 px-3.5 border border-slate-300 rounded-xl text-sm font-mono focus:border-wa-600 focus:outline-none"
                            />
                            <button id="link-wa-submit-btn" type="submit" class="h-11 px-6 bg-wa-600 hover:bg-wa-700 text-white text-sm font-semibold rounded-xl shrink-0">
                                Link Number (Get Pairing Code)
                            </button>
                        </div>
                    </form>

                    <div id="link-wa-code-output" class="hidden p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2"></div>

                    <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-1.5">
                        <p class="font-bold text-slate-900">How to Link Your Phone in 15 Seconds:</p>
                        <ol class="list-decimal list-inside space-y-1">
                            <li>Enter your WhatsApp mobile number above and click <strong>Link Number</strong>.</li>
                            <li>Open WhatsApp on your phone → <strong>Settings / ⋮ → Linked Devices → Link a Device</strong>.</li>
                            <li>Tap <strong>Link with phone number instead</strong> at the bottom and enter the 8-digit code shown above.</li>
                            <li>Once linked, this website automatically keeps your WhatsApp bot active 24/7 via silent keep-alive pings.</li>
                        </ol>
                    </div>
                </div>

                <div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4 h-fit">
                    <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h3 class="font-display font-bold text-base text-slate-950">Linked WhatsApp Devices</h3>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${connected.length ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}">
                            ${connected.length ? `${connected.length} Connected` : 'Not Linked'}
                        </span>
                    </div>

                    <div id="linked-wa-sessions-list" class="space-y-2.5 text-xs">
                        ${allSess.length ? allSess.map((num) => {
                            const isOnline = connected.includes(num);
                            return `
                                <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                                    <div>
                                        <p class="font-mono font-bold text-sm text-slate-950">+${escapeHtml(num)}</p>
                                        <p class="text-[11px] font-semibold ${isOnline ? 'text-emerald-700' : 'text-amber-700'}">
                                            ${isOnline ? 'Connected & Receiving Messages' : 'Pairing / Reconnecting...'}
                                        </p>
                                    </div>
                                    <button type="button" data-del-sess="${escapeHtml(num)}" class="del-sess-btn px-3 py-1.5 border border-red-300 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-50">
                                        Unlink
                                    </button>
                                </div>
                            `;
                        }).join('') : '<p class="text-slate-500 py-4 text-center">No WhatsApp number linked yet. Use the form on the left to link your store number.</p>'}
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
                        <p class="text-xs font-semibold text-slate-700">Enter this 8-digit pairing code in WhatsApp → Linked Devices:</p>
                        <p class="font-mono text-3xl font-extrabold tracking-[0.2em] text-wa-700">${escapeHtml(res.code)}</p>
                        <p class="text-[11px] text-slate-500">Waiting for confirmation on your phone...</p>
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
            <form id="admin-variables-form" class="bg-white border border-slate-200 rounded-2xl p-6 max-w-4xl space-y-6">
                <div class="border-b border-slate-100 pb-3">
                    <h2 class="font-display text-lg font-bold text-slate-950">Environment &amp; Store Variables</h2>
                    <p class="text-xs text-slate-500 mt-1">
                        Configure <code class="font-mono">Admin_Username</code>, <code class="font-mono">Admin_Password</code>, <code class="font-mono">Admin_Whatsapp</code>, <code class="font-mono">Cloudinary_URI</code>, <code class="font-mono">Railway_URL</code>, <code class="font-mono">STORE_PUBLIC_URL</code>, and <code class="font-mono">API_SECRET_KEY</code>.
                    </p>
                </div>

                <!-- Required Admin, Cloudinary & Railway Environment Variables -->
                <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800">Core Security, Cloudinary &amp; 24/7 Railway Bot Bridge</h3>
                        <span class="text-[11px] font-semibold ${mediaDiag.activeBackend === 'cloudinary' ? 'text-emerald-700' : 'text-amber-700'}">
                            Media Storage: ${mediaDiag.activeBackend === 'cloudinary' ? `Cloudinary (${escapeHtml(mediaDiag.cloudinaryCloudName || 'Active')})` : 'SQLite Fallback (Add Cloudinary_URI)'}
                        </span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-slate-700 mb-1">Admin_Username</label>
                            <input name="Admin_Username" required value="${escapeHtml(map.Admin_Username || 'admin')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-slate-700 mb-1">Admin_Password</label>
                            <input name="Admin_Password" type="password" required value="${escapeHtml(map.Admin_Password || '')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-slate-700 mb-1">Admin_Whatsapp (Inquiry Recipient)</label>
                            <input name="Admin_Whatsapp" required value="${escapeHtml(map.Admin_Whatsapp || '923299931199')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-slate-700 mb-1">Cloudinary_URI</label>
                            <input name="Cloudinary_URI" value="${escapeHtml(map.Cloudinary_URI || '')}" placeholder="cloudinary://api_key:api_secret@cloud_name" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-slate-700 mb-1">API_SECRET_KEY (Bot &amp; Webhook Token)</label>
                            <input name="API_SECRET_KEY" value="${escapeHtml(map.API_SECRET_KEY || '')}" placeholder="almumtaz-bot-secret" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">Railway_URL (Deployed /Railway Backend URL for 24/7 WhatsApp Bot)</label>
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input id="var-railway-url-input" name="Railway_URL" value="${escapeHtml(map.Railway_URL || '')}" placeholder="https://almumtaz-bot-production.up.railway.app" class="flex-1 h-10 px-3 border border-slate-300 rounded-xl text-sm font-mono bg-white" />
                            <button id="test-railway-btn" type="button" class="h-10 px-4 bg-[#11151C] hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shrink-0">
                                Test Railway Connection
                            </button>
                        </div>
                        <p id="railway-test-status" class="hidden text-xs font-semibold mt-1.5"></p>
                    </div>
                </div>

                <!-- Store, Payment Info & COD Delivery Rates -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">STORE_NAME</label>
                        <input name="STORE_NAME" value="${escapeHtml(map.STORE_NAME || 'Al-Mumtaz Electronics')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">STORE_PUBLIC_URL / STORE_URL (For Tracking &amp; Bot Links)</label>
                        <input name="STORE_PUBLIC_URL" value="${escapeHtml(map.STORE_PUBLIC_URL || '')}" placeholder="https://your-storefront-url" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm" />
                    </div>

                    <div class="sm:col-span-2">
                        <label class="block text-xs font-semibold text-slate-700 mb-1">STORE_PAYMENT_INFO (Shown on Bot "Pay Now" Action)</label>
                        <input name="STORE_PAYMENT_INFO" value="${escapeHtml(map.STORE_PAYMENT_INFO || '')}" placeholder="EasyPaisa / JazzCash: 0329-9931199 (Al-Mumtaz Electronics Hasilpur)" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm" />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">COD_FLAT_RATE (PKR)</label>
                        <input name="COD_FLAT_RATE" type="number" value="${escapeHtml(map.COD_FLAT_RATE || '250')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm tabular-nums" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">EXPRESS_COD_RATE (PKR)</label>
                        <input name="EXPRESS_COD_RATE" type="number" value="${escapeHtml(map.EXPRESS_COD_RATE || '550')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm tabular-nums" />
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">FREE_DELIVERY_THRESHOLD (PKR)</label>
                        <input name="FREE_DELIVERY_THRESHOLD" type="number" value="${escapeHtml(map.FREE_DELIVERY_THRESHOLD || '35000')}" class="w-full h-10 px-3 border border-slate-300 rounded-xl text-sm tabular-nums" />
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold text-slate-700 mb-1">CITY_RATES_JSON (City-Based COD Shipping Map)</label>
                    <textarea name="CITY_RATES_JSON" rows="3" class="w-full p-3 border border-slate-300 rounded-xl text-xs font-mono">${escapeHtml(map.CITY_RATES_JSON || '{}')}</textarea>
                </div>

                <button type="submit" class="h-10 px-6 bg-[#11151C] hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors">
                    Save All Variables
                </button>
            </form>
        `;

        document.getElementById('test-railway-btn')?.addEventListener('click', async () => {
            const urlVal = document.getElementById('var-railway-url-input')?.value || '';
            const statusEl = document.getElementById('railway-test-status');
            if (statusEl) {
                statusEl.textContent = 'Pinging Railway backend /api/health...';
                statusEl.className = 'text-xs font-semibold text-slate-600 mt-1.5';
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
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <!-- Left Column: Interactive Store Bot & Inquiry Simulator -->
                <div class="lg:col-span-5 space-y-5">
                    <div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                        <div class="border-b border-slate-100 pb-3">
                            <h3 class="font-display font-bold text-base text-slate-950">Interactive Store Bot &amp; Inquiry Tester</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Test live categories, product search, in-chat COD checkout, Pay Now, Track Order &amp; Inquiries to Admin_Whatsapp (<span class="font-mono">+${escapeHtml(adminNum)}</span>).</p>
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                            <input id="bot-test-from" value="03001234567" placeholder="Customer Number" class="h-9 px-2.5 border border-slate-300 rounded-xl text-xs font-mono" />
                            <input id="bot-test-name" value="Walk-in Buyer" placeholder="Customer Name" class="h-9 px-2.5 border border-slate-300 rounded-xl text-xs" />
                        </div>

                        <div class="flex flex-wrap gap-1.5">
                            <button type="button" data-sim-msg="Assalam o Alaikum" class="sim-bot-btn px-2.5 py-1.5 bg-[#11151C] text-white rounded-lg text-[11px] font-semibold">Send "Hi / Salam"</button>
                            <button type="button" data-sim-msg="menu_categories" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Browse Categories</button>
                            <button type="button" data-sim-msg="menu_search" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Search Products</button>
                            <button type="button" data-sim-msg="menu_track" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Track My Order</button>
                            <button type="button" data-sim-msg="menu_pay" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Pay Now</button>
                            <button type="button" data-sim-msg="almumtaz_offers" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Offered Items</button>
                            <button type="button" data-sim-msg="almumtaz_featured" class="sim-bot-btn px-2.5 py-1.5 border border-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-50">Featured Items</button>
                            <button type="button" data-sim-msg="almumtaz_inquiry" class="sim-bot-btn px-2.5 py-1.5 border border-brand-500 text-brand-700 bg-brand-50 rounded-lg text-[11px] font-semibold">Contact For Inquiry</button>
                        </div>

                        <form id="bot-custom-msg-form" class="flex gap-2">
                            <input id="bot-custom-msg-input" placeholder="Type search query, ORD-2026-..., or inquiry..." class="flex-1 h-9 px-3 border border-slate-300 rounded-xl text-xs" />
                            <button type="submit" class="h-9 px-3.5 bg-[#11151C] text-white text-xs font-semibold rounded-xl">Send</button>
                        </form>

                        <div id="bot-sim-preview" class="hidden bg-[#EFEAE2] border border-slate-200 rounded-xl p-3 text-xs space-y-2"></div>
                    </div>
                </div>

                <!-- Right Column: Forwarded Inquiries & WhatsApp Audit Logs -->
                <div class="lg:col-span-7 space-y-5">
                    <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <div class="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                            <h3 class="font-display font-bold text-base text-slate-950">Customer Inquiries Forwarded to Admin (${inquiries.length})</h3>
                        </div>
                        <div class="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                            ${inquiries.map((inq) => `
                                <div class="p-4 text-xs space-y-1">
                                    <div class="flex justify-between font-semibold">
                                        <span class="text-slate-900">${escapeHtml(inq.senderName)} (<span class="font-mono">+${escapeHtml(inq.senderNumber)}</span>)</span>
                                        <span class="text-emerald-700 font-mono">→ Admin +${escapeHtml(inq.adminNumber)}</span>
                                    </div>
                                    <p class="text-slate-700">${escapeHtml(inq.description)}</p>
                                </div>
                            `).join('') || '<p class="p-5 text-xs text-slate-500">No inquiries submitted yet.</p>'}
                        </div>
                    </div>

                    <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <div class="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                            <h3 class="font-display font-bold text-base text-slate-950">WhatsApp Automation Logs (${logs.length})</h3>
                        </div>
                        <div class="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                            ${logs.map((log) => {
                                const btns = log.payload?.buttons || [];
                                const lists = log.payload?.lists || [];
                                const listRows = lists.flatMap((s) =>
                                    Array.isArray(s.sections)
                                        ? s.sections.flatMap((sec) => sec.rows || [])
                                        : (s.rows || [])
                                );
                                const fullBody = log.payload?.text || log.summary;
                                return `
                                <div class="p-3.5 text-xs space-y-1.5">
                                    <div class="flex items-center justify-between">
                                        <span class="font-semibold ${log.direction === 'inbound' ? 'text-brand-600' : 'text-wa-600'}">
                                            ${escapeHtml(log.direction.toUpperCase())} · ${escapeHtml(log.messageType)} → ${escapeHtml(log.recipient)}
                                        </span>
                                        <span class="text-[11px] text-slate-400 font-mono">${escapeHtml(log.status)}</span>
                                    </div>
                                    ${log.payload?.title ? `<p class="font-bold text-slate-900">${escapeHtml(log.payload.title)}</p>` : ''}
                                    <p class="text-slate-700 whitespace-pre-wrap leading-relaxed">${escapeHtml(fullBody)}</p>
                                    ${listRows.length ? `<div class="flex flex-wrap gap-1 pt-0.5">${listRows.map((r) => `<span class="px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-[10px] font-semibold text-amber-900">${escapeHtml(r.title)}</span>`).join('')}</div>` : ''}
                                    ${btns.length ? `<div class="flex flex-wrap gap-1.5 pt-0.5">${btns.map((b) => `<span class="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-semibold text-slate-800">${escapeHtml(b.text)}</span>`).join('')}</div>` : ''}
                                </div>
                                `;
                            }).join('') || '<p class="p-5 text-xs text-slate-500">No WhatsApp dispatches logged yet.</p>'}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const bindPreviewActions = (previewEl) => {
            previewEl?.querySelectorAll('[data-sim-reply]').forEach((btn) => {
                btn.addEventListener('click', () => sendSimulated(btn.dataset.simReply));
            });
        };

        const extractListRows = (lists = []) =>
            lists.flatMap((s) =>
                Array.isArray(s.sections)
                    ? s.sections.flatMap((sec) => sec.rows || [])
                    : (s.rows || [])
            );

        const sendSimulated = async (text) => {
            const from = document.getElementById('bot-test-from').value;
            const senderName = document.getElementById('bot-test-name').value;
            const preview = document.getElementById('bot-sim-preview');
            if (preview) {
                preview.classList.remove('hidden');
                preview.innerHTML = `<div class="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-500 font-medium">Processing interactive bot reply...</div>`;
            }
            try {
                const res = await adminRequest('/api/whatsapp/simulate-message', {
                    method: 'POST',
                    body: JSON.stringify({ from, senderName, text })
                });
                const outbound = (res.latestLogs || []).filter((l) => l.direction === 'outbound').slice(0, 4);
                preview.classList.remove('hidden');
                preview.innerHTML = outbound.map((l) => {
                    const btns = l.payload?.buttons || [];
                    const listRows = extractListRows(l.payload?.lists || []);
                    return `
                        <div class="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                            <p class="text-[11px] font-mono text-slate-500">To ${escapeHtml(l.recipient)} (${escapeHtml(l.messageType)})</p>
                            ${l.payload?.title ? `<p class="font-display font-bold text-slate-950">${escapeHtml(l.payload.title)}</p>` : ''}
                            <pre class="whitespace-pre-wrap font-sans text-slate-900">${escapeHtml(l.payload?.text || l.summary)}</pre>
                            ${listRows.length ? `
                                <div class="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                                    ${listRows.map((r) => `<button type="button" data-sim-reply="${escapeHtml(r.rowId || r.id || '')}" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg text-[11px] font-semibold text-amber-950">${escapeHtml(r.title)}</button>`).join('')}
                                </div>
                            ` : ''}
                            ${btns.length ? `
                                <div class="flex flex-wrap gap-1.5 pt-1">
                                    ${btns.map((b) => b.type === 'cta_url'
                                        ? `<a href="${escapeHtml(b.url || '#')}" target="_blank" rel="noopener" class="px-2.5 py-1 bg-sky-50 border border-sky-200 text-sky-900 rounded-lg text-[11px] font-semibold inline-block">${escapeHtml(b.text)} ↗</a>`
                                        : `<button type="button" data-sim-reply="${escapeHtml(b.id)}" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-[11px] font-semibold text-slate-900">${escapeHtml(b.text)}</button>`
                                    ).join('')}
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
                await loadAdminOverview(true);
                bindPreviewActions(document.getElementById('bot-sim-preview'));
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
            container.innerHTML = '<div class="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">Analytics data unavailable. Click Refresh to load.</div>';
            return;
        }

        const summary = analytics.summary || {};
        const byStatus = analytics.byStatus || [];
        const byCategories = analytics.byCategories || [];
        const byCity = analytics.byCity || [];
        const topProducts = analytics.topProducts || [];

        const statusStyleMap = {
            'Pending WhatsApp Confirmation': { border: 'border-amber-200', bg: 'bg-amber-50/70', bar: 'bg-amber-500', pill: 'text-amber-700' },
            Confirmed: { border: 'border-emerald-200', bg: 'bg-emerald-50/70', bar: 'bg-emerald-600', pill: 'text-emerald-700' },
            Dispatched: { border: 'border-sky-200', bg: 'bg-sky-50/70', bar: 'bg-sky-600', pill: 'text-sky-700' },
            Delivered: { border: 'border-teal-200', bg: 'bg-teal-50/70', bar: 'bg-teal-600', pill: 'text-teal-700' },
            Cancelled: { border: 'border-red-200', bg: 'bg-red-50/70', bar: 'bg-red-600', pill: 'text-red-700' }
        };

        const modeBtnClass = (mode) =>
            adminState.analyticsMode === mode
                ? 'analytics-mode-btn h-9 px-4 rounded-xl text-xs font-semibold bg-[#11151C] text-white'
                : 'analytics-mode-btn h-9 px-4 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-800 hover:bg-slate-50';

        const statusCardsHtml = `
            <div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 class="font-display font-bold text-base text-slate-950">Order Lifecycle Breakdown</h3>
                        <p class="text-xs text-slate-500">Click any status button (Confirmed Orders, Dispatched, Delivered, Pending, Cancelled) to filter analytics.</p>
                    </div>
                    ${adminState.analyticsStatus !== 'all' ? `
                        <button type="button" id="analytics-jump-status-orders" class="h-8 px-3 bg-[#11151C] text-white rounded-xl text-xs font-semibold hover:bg-slate-800">
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
                                class="analytics-status-btn text-left p-4 rounded-xl border transition-colors ${selected ? 'ring-2 ring-brand-500 border-brand-500 bg-brand-50/40' : `${style.border} ${style.bg} hover:border-slate-400`}"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <span class="text-[11px] font-bold uppercase tracking-wider ${style.pill}">${escapeHtml(st.label)}</span>
                                    <span class="text-[11px] font-mono font-semibold text-slate-600 tabular-nums">${st.sharePct}%</span>
                                </div>
                                <p class="font-display text-2xl font-extrabold text-slate-950 tabular-nums mt-1.5">${st.count}</p>
                                <p class="text-xs font-semibold text-slate-700 tabular-nums mt-0.5">${formatPkr(st.revenue)}</p>
                                <div class="w-full h-1.5 bg-white/90 rounded overflow-hidden mt-2.5 border border-black/5">
                                    <div class="h-full ${style.bar}" style="width: ${Math.max(st.count > 0 ? 6 : 0, st.sharePct)}%"></div>
                                </div>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        const filterCats = (baseAnalytics?.byCategories && baseAnalytics.byCategories.length)
            ? baseAnalytics.byCategories
            : categories;

        const byCategoriesHtml = `
            <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 space-y-3">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 class="font-display font-bold text-base text-slate-950">Analytics By Categories</h3>
                            <p class="text-xs text-slate-500">Compare order statuses, units sold, catalog stock, and PKR revenue across each electronics category.</p>
                        </div>
                        ${adminState.analyticsCategory !== 'all' ? `
                            <button type="button" id="analytics-jump-cat-orders" class="h-8 px-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-xs font-semibold">
                                View Category Orders →
                            </button>
                        ` : ''}
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            data-analytics-cat="all"
                            class="analytics-cat-btn h-8 px-3 rounded-xl text-xs font-semibold ${adminState.analyticsCategory === 'all' ? 'bg-[#11151C] text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}"
                        >
                            All Categories (${filterCats.length})
                        </button>
                        ${filterCats.map((cat) => `
                            <button
                                type="button"
                                data-analytics-cat="${escapeHtml(cat.slug)}"
                                class="analytics-cat-btn h-8 px-3 rounded-xl text-xs font-semibold ${adminState.analyticsCategory === cat.slug ? 'bg-[#11151C] text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'}"
                            >
                                ${escapeHtml(cat.name)}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 border-b border-slate-100 text-slate-500">
                            <tr>
                                <th class="px-4 py-3 font-medium">Category</th>
                                <th class="px-4 py-3 font-medium">Items / Stock</th>
                                <th class="px-4 py-3 font-medium">Units Sold</th>
                                <th class="px-4 py-3 font-medium">Confirmed</th>
                                <th class="px-4 py-3 font-medium">Dispatched</th>
                                <th class="px-4 py-3 font-medium">Delivered</th>
                                <th class="px-4 py-3 font-medium">Pending / Canc</th>
                                <th class="px-4 py-3 font-medium">Revenue &amp; Share</th>
                                <th class="px-4 py-3 font-medium">Orders</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${byCategories.map((cat) => {
                                const isSelected = adminState.analyticsCategory === cat.slug;
                                return `
                                    <tr class="${isSelected ? 'bg-brand-50/40' : 'hover:bg-slate-50/70'}">
                                        <td class="px-4 py-3">
                                            <p class="font-bold text-slate-950">${escapeHtml(cat.name)}</p>
                                            <p class="text-[11px] font-mono text-slate-400">${escapeHtml(cat.slug)}</p>
                                        </td>
                                        <td class="px-4 py-3 tabular-nums text-slate-700">${cat.productCount} SKUs · ${cat.totalStock} stock</td>
                                        <td class="px-4 py-3 tabular-nums font-bold text-slate-900">${cat.unitsSold}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-emerald-700">${cat.confirmedOrders}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-sky-700">${cat.dispatchedOrders}</td>
                                        <td class="px-4 py-3 tabular-nums font-semibold text-teal-700">${cat.deliveredOrders}</td>
                                        <td class="px-4 py-3 tabular-nums text-slate-600">${cat.pendingOrders} / <span class="text-red-600">${cat.cancelledOrders}</span></td>
                                        <td class="px-4 py-3 min-w-[160px]">
                                            <div class="flex items-center justify-between gap-2 tabular-nums">
                                                <span class="font-bold text-slate-950">${formatPkr(cat.revenue)}</span>
                                                <span class="text-[11px] text-slate-500">${cat.revenueSharePct}%</span>
                                            </div>
                                            <div class="w-full h-1.5 bg-slate-100 rounded overflow-hidden mt-1">
                                                <div class="h-full bg-brand-500" style="width: ${Math.max(cat.revenue > 0 ? 5 : 0, cat.revenueSharePct)}%"></div>
                                            </div>
                                        </td>
                                        <td class="px-4 py-3 whitespace-nowrap">
                                            <button type="button" data-drill-cat="${escapeHtml(cat.slug)}" class="drill-cat-orders-btn px-2.5 py-1 border border-slate-300 bg-white hover:bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-800">
                                                View (${cat.totalOrders})
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            }).join('') || '<tr><td colspan="9" class="p-6 text-center text-slate-500">No category metrics available.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const secondaryInsightsHtml = `
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div class="px-5 py-3.5 border-b border-slate-100">
                        <h3 class="font-display font-bold text-base text-slate-950">Top Electronics by Revenue</h3>
                    </div>
                    <div class="divide-y divide-slate-100">
                        ${topProducts.map((p, idx) => `
                            <div class="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900 truncate">${idx + 1}. ${escapeHtml(p.title)}</p>
                                    <p class="text-[11px] text-slate-500">${escapeHtml(p.categoryName)} · ${p.unitsSold} unit(s) sold</p>
                                </div>
                                <span class="font-bold text-brand-600 tabular-nums shrink-0">${formatPkr(p.revenue)}</span>
                            </div>
                        `).join('') || '<p class="p-5 text-xs text-slate-500">No active order item sales recorded for this filter yet.</p>'}
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div class="px-5 py-3.5 border-b border-slate-100">
                        <h3 class="font-display font-bold text-base text-slate-950">Delivery Cities Performance</h3>
                    </div>
                    <div class="divide-y divide-slate-100">
                        ${byCity.map((c) => `
                            <div class="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                                <div>
                                    <p class="font-bold text-slate-900">${escapeHtml(c.city)}</p>
                                    <p class="text-[11px] text-slate-500">${c.orderCount} order(s) · ${c.deliveredCount} delivered</p>
                                </div>
                                <span class="font-bold text-slate-950 tabular-nums">${formatPkr(c.revenue)}</span>
                            </div>
                        `).join('') || '<p class="p-5 text-xs text-slate-500">No city order metrics for this filter yet.</p>'}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = `
            <div class="space-y-5">
                <!-- Analytics Header & Mode Controls -->
                <div class="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="font-display font-bold text-lg text-slate-950">Store Analytics &amp; Fulfillment Pipeline</h2>
                        <p class="text-xs text-slate-500 mt-0.5">
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
                            <button type="button" id="analytics-reset-filters" class="h-9 px-3 rounded-xl text-xs font-semibold border border-red-300 text-red-700 hover:bg-red-50">
                                Reset Filters
                            </button>
                        ` : ''}
                    </div>
                </div>

                <!-- Summary Metric Cards -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white border border-slate-200 rounded-2xl p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active Gross Revenue</p>
                        <p class="font-display text-xl font-extrabold text-slate-950 tabular-nums mt-1">${formatPkr(summary.grossRevenue || 0)}</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 tabular-nums">${summary.totalOrders || 0} total orders · ${summary.totalUnitsSold || 0} units</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-2xl p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Confirmed + Dispatched + Delivered</p>
                        <p class="font-display text-xl font-extrabold text-emerald-700 tabular-nums mt-1">${summary.confirmedPipelineOrders || 0} Orders</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 tabular-nums">${formatPkr(summary.confirmedPipelineRevenue || 0)} pipeline value</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-2xl p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Delivered Revenue</p>
                        <p class="font-display text-xl font-extrabold text-teal-700 tabular-nums mt-1">${formatPkr(summary.deliveredRevenue || 0)}</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 tabular-nums">${summary.deliveredOrders || 0} delivered · ${summary.dispatchedOrders || 0} dispatched</p>
                    </div>
                    <div class="bg-white border border-slate-200 rounded-2xl p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Avg Order Value &amp; Confirmation</p>
                        <p class="font-display text-xl font-extrabold text-brand-600 tabular-nums mt-1">${formatPkr(summary.averageOrderValue || 0)}</p>
                        <p class="text-[11px] text-slate-500 mt-0.5 tabular-nums">${summary.confirmationRate || 0}% confirmation rate</p>
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
        const stats = overview.stats || {};
        const orders = overview.orders || [];
        const ws = overview.whatsappStatus || {};
        const mediaDiag = overview.mediaDiagnostics || {};
        const cfg = overview.config || {};
        const connected = ws.connectedSessions || [];
        const railwayUrl = ws.railwayUrl || cfg.railwayUrl || '';
        const groups = getAdminNavigationGroups();
        const totalFeatures = groups.reduce((acc, g) => acc + g.items.length, 0);

        const kpiCards = [
            { label: 'Total Revenue', value: formatPkr(stats.totalRevenue || 0), navId: 'analytics-all', accent: 'text-slate-950' },
            { label: 'Total Orders', value: stats.totalOrders || 0, navId: 'orders-all', accent: 'text-slate-950' },
            { label: 'Confirmed COD', value: stats.confirmedOrders || 0, navId: 'orders-confirmed', accent: 'text-emerald-700' },
            { label: 'Pending WhatsApp', value: stats.pendingOrders || 0, navId: 'orders-pending', accent: 'text-amber-700' },
            { label: 'Catalog Products', value: stats.totalProducts || 0, navId: 'products-inventory', accent: 'text-slate-950' },
            { label: 'Customer Inquiries', value: stats.totalInquiries || 0, navId: 'wa-inquiries', accent: 'text-brand-600' }
        ];

        const latestOrders = orders.slice(0, 5);

        container.innerHTML = `
            <div class="space-y-5">
                <!-- Live KPI Summary Row -->
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    ${kpiCards.map((c) => `
                        <button type="button" data-dash-action="${escapeHtml(c.navId)}" class="dash-feature-btn bg-white border border-slate-200 hover:border-slate-400 rounded-2xl p-4 text-left transition-colors group">
                            <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-900">${escapeHtml(c.label)}</p>
                            <p class="font-display text-xl font-extrabold ${c.accent} tabular-nums mt-1.5">${escapeHtml(String(c.value))}</p>
                        </button>
                    `).join('')}
                </div>

                <!-- Feature Hub Utility Bar -->
                <div class="bg-white border border-slate-200 rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                        <h2 class="font-display font-bold text-base text-slate-950">Feature Hub (${totalFeatures} Modules)</h2>
                        <span class="text-xs font-medium text-slate-500">
                            WhatsApp: <strong class="${connected.length ? 'text-emerald-700' : 'text-amber-700'}">${connected.length ? `+${escapeHtml(connected[0])}` : 'Not Linked'}</strong>
                            · Media: <strong class="text-slate-800">${mediaDiag.activeBackend === 'cloudinary' ? 'Cloudinary' : 'SQLite'}</strong>
                            · Host: <strong class="text-slate-800">${railwayUrl ? (ws.railwayReachable ? 'Railway Online' : 'Railway Offline') : 'Local Server'}</strong>
                        </span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" id="dash-export-csv-btn" class="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-800 whitespace-nowrap transition-colors">
                            Export Orders CSV
                        </button>
                        <button type="button" id="dash-refresh-btn" class="h-8 px-3 bg-[#11151C] hover:bg-slate-800 text-white rounded-xl text-xs font-semibold whitespace-nowrap transition-colors">
                            Refresh Data
                        </button>
                    </div>
                </div>

                <!-- Categorized Feature Access Buttons -->
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${groups.map((g) => `
                        <section class="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 flex flex-col">
                            <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
                                <h3 class="font-display font-bold text-sm text-slate-950 truncate">${escapeHtml(g.group)}</h3>
                                <span class="text-[11px] font-mono font-semibold text-slate-400 tabular-nums shrink-0">${g.items.length}</span>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 content-start">
                                ${g.items.map((item) => `
                                    <button
                                        type="button"
                                        data-dash-action="${escapeHtml(item.id)}"
                                        class="dash-feature-btn text-left p-2.5 rounded-xl border border-slate-200 bg-[#F7F8FA] hover:bg-white hover:border-slate-400 transition-colors group"
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
                    <div class="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
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
                                    const pill = getOrderStatusPillMeta(o.orderStatus);
                                    return `
                                        <div class="px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-slate-50/70">
                                            <div class="min-w-0">
                                                <div class="flex items-center gap-2">
                                                    <span class="font-mono font-bold text-slate-950">#${escapeHtml(o.orderId)}</span>
                                                    <span class="px-2 py-0.5 text-[10px] font-semibold border rounded-full ${pill.cls}">${escapeHtml(pill.label)}</span>
                                                </div>
                                                <p class="text-slate-600 truncate mt-0.5">${escapeHtml(o.customerName)} · ${escapeHtml(o.city)} · <span class="font-mono">${escapeHtml(o.whatsappNumber)}</span></p>
                                            </div>
                                            <div class="flex items-center gap-2 shrink-0">
                                                <span class="font-bold tabular-nums text-slate-950">${formatPkr(o.grandTotal)}</span>
                                                <button type="button" data-dash-order-view="${escapeHtml(o.orderId)}" class="dash-view-order-btn h-7 px-2.5 border border-slate-300 bg-white hover:bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-800">Details</button>
                                                ${o.orderStatus === 'Pending WhatsApp Confirmation' ? `
                                                    <button type="button" data-dash-confirm="${escapeHtml(o.orderId)}" data-dash-from="${escapeHtml(o.whatsappDigits)}" class="dash-confirm-order-btn h-7 px-2.5 bg-wa-600 hover:bg-wa-700 text-white rounded-lg text-[11px] font-semibold">Confirm</button>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>

                    <div class="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5 h-fit">
                        <h3 class="font-display font-bold text-sm text-slate-950 border-b border-slate-100 pb-2.5">Store System Readiness</h3>
                        <div class="space-y-2.5 text-xs">
                            <div class="flex items-center justify-between gap-3 p-3 bg-[#F7F8FA] border border-slate-200 rounded-xl">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900">WhatsApp Link &amp; 24/7 Bot</p>
                                    <p class="text-slate-500 truncate">${connected.length ? `Connected: +${escapeHtml(connected[0])}` : 'Pair store phone via 8-digit code'}</p>
                                </div>
                                <button type="button" data-dash-action="wa-link" class="dash-feature-btn h-8 px-3 bg-wa-600 hover:bg-wa-700 text-white rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0">
                                    ${connected.length ? 'Manage' : 'Link Phone'}
                                </button>
                            </div>

                            <div class="flex items-center justify-between gap-3 p-3 bg-[#F7F8FA] border border-slate-200 rounded-xl">
                                <div class="min-w-0">
                                    <p class="font-bold text-slate-900">Product Multi-Image Storage</p>
                                    <p class="text-slate-500 truncate">${mediaDiag.activeBackend === 'cloudinary' ? `Cloudinary CDN (${escapeHtml(mediaDiag.cloudinaryCloudName || 'Active')})` : 'SQLite Media Fallback'}</p>
                                </div>
                                <button type="button" data-dash-action="products-add" class="dash-feature-btn h-8 px-3 bg-[#11151C] hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0">
                                    + Add Item
                                </button>
                            </div>

                            <div class="flex items-center justify-between gap-3 p-3 bg-[#F7F8FA] border border-slate-200 rounded-xl">
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
                    { id: 'wa-bot-tester', label: 'Interactive Bot Simulator', desc: 'Test Categories, Search, Pay & Track' },
                    { id: 'wa-inquiries', label: `Customers & Inquiries (${inquiries.length})`, desc: 'View inquiries & store buyers' },
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
            case 'wa-logs':
                adminState.activeTab = 'whatsapp';
                renderActiveAdminTab();
                break;
            case 'wa-inquiries':
                adminState.activeTab = 'inquiries';
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
                                        class="admin-nav-feature-btn text-left px-3 py-2 rounded-xl border transition-colors ${
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

    function renderActiveAdminTab() {
        const container = document.getElementById('admin-tab-content');
        if (!container) return;

        syncSidebarActiveUI();
        setSidebarMobileOpen(false);

        switch (adminState.activeTab) {
            case 'dashboard':
                renderDashboardTab(container);
                break;
            case 'analytics':
                renderAnalyticsTab(container);
                break;
            case 'inquiries':
                renderCustomersInquiriesTab(container);
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

        document.querySelectorAll('[data-sidebar-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                adminState.activeTab = btn.dataset.sidebarTab || 'orders';
                toggleAdminNavigation(false);
                renderActiveAdminTab();
            });
        });

        document.getElementById('admin-home-btn')?.addEventListener('click', () => {
            adminState.activeTab = 'orders';
            adminState.activeNavId = 'orders-all';
            toggleAdminNavigation(false);
            renderActiveAdminTab();
        });

        document.getElementById('admin-quick-notifs-btn')?.addEventListener('click', () => {
            adminState.activeTab = 'whatsapp';
            toggleAdminNavigation(false);
            renderActiveAdminTab();
        });

        document.getElementById('admin-sidebar-open-btn')?.addEventListener('click', () => setSidebarMobileOpen(true));
        document.getElementById('admin-sidebar-close-btn')?.addEventListener('click', () => setSidebarMobileOpen(false));
        document.getElementById('admin-mobile-sidebar-backdrop')?.addEventListener('click', () => setSidebarMobileOpen(false));

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
