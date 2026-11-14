'use strict';

(function () {
    const { request, formatPkr, escapeHtml } = window.AlMumtazAPI;

    const state = {
        store: {},
        categories: [],
        products: [],
        featured: [],
        flashDeals: [],
        cart: JSON.parse(localStorage.getItem('almumtaz_cart') || '[]'),
        wishlist: JSON.parse(localStorage.getItem('almumtaz_wishlist') || '[]'),
        wishlistOnly: false,
        quickTab: 'all',
        filters: {
            category: 'all',
            search: '',
            maxPrice: 300000,
            minDiscount: '',
            tag: '',
            inStock: false,
            sort: 'newest'
        },
        activeView: 'store',
        lastOrder: null,
        pdpProduct: null,
        pdpSelectedVariant: '',
        pdpActiveImageIdx: 0,
        cardVariantMap: {}
    };

    async function copyTextToClipboard(text) {
        const clean = String(text || '').trim();
        if (!clean) return false;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(clean);
                return true;
            } catch (_) {}
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = clean;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (_) {
            return true;
        }
    }

    function resolveVariantOption(product, requestedVariant = '') {
        if (!product) {
            return { name: '', originalPrice: 0, discountPrice: 0, discountPercentage: 0, stock: 0 };
        }
        const opts = Array.isArray(product.variantOptions) ? product.variantOptions : [];
        const target = String(requestedVariant || '').trim();
        let matched = null;
        if (target && opts.length > 0) {
            matched = opts.find((v) => String(v.name || '').trim().toLowerCase() === target.toLowerCase()) || null;
        }
        if (!matched && opts.length > 0) {
            matched = opts[0];
        }
        if (matched) {
            return {
                name: matched.name,
                originalPrice: Number(matched.originalPrice) || Number(product.originalPrice) || 0,
                discountPrice: Number(matched.discountPrice) || Number(product.discountPrice) || 0,
                discountPercentage: Number(matched.discountPercentage ?? product.discountPercentage) || 0,
                stock: matched.stock !== undefined ? Number(matched.stock) : Number(product.stock || 0)
            };
        }
        return {
            name: target || (product.variants && product.variants[0]) || '',
            originalPrice: Number(product.originalPrice) || 0,
            discountPrice: Number(product.discountPrice) || 0,
            discountPercentage: Number(product.discountPercentage) || 0,
            stock: Number(product.stock || 0)
        };
    }

    function showToast(msg, isError = false) {
        const el = document.getElementById('toast-banner');
        if (!el) return;
        el.textContent = msg;
        el.className = `fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-xl text-sm font-medium border ${
            isError
                ? 'bg-red-700 text-white border-red-800'
                : 'bg-slate-900 text-white border-slate-700'
        }`;
        el.classList.remove('hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3200);
    }

    function saveCart() {
        localStorage.setItem('almumtaz_cart', JSON.stringify(state.cart));
        updateCartBadges();
    }

    function saveWishlist() {
        localStorage.setItem('almumtaz_wishlist', JSON.stringify(state.wishlist));
        const badge = document.getElementById('wishlist-count');
        if (badge) {
            const count = state.wishlist.length;
            badge.textContent = String(count);
            badge.classList.toggle('hidden', count <= 0);
            badge.classList.toggle('flex', count > 0);
        }
    }

    function updateCartBadges() {
        const count = state.cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
        const badge = document.getElementById('cart-badge-count');
        if (badge) {
            badge.textContent = String(count);
            badge.classList.toggle('hidden', count <= 0);
            badge.classList.toggle('flex', count > 0);
        }
        renderCartDrawer();
    }

    function setActiveQuickTab(tabName) {
        state.quickTab = tabName;
        document.querySelectorAll('.quick-tab-btn').forEach((btn) => {
            const isActive = btn.dataset.quickTab === tabName;
            btn.classList.toggle('bg-[#11151C]', isActive);
            btn.classList.toggle('text-white', isActive);
            btn.classList.toggle('border-[#11151C]', isActive);
            btn.classList.toggle('bg-white', !isActive);
            btn.classList.toggle('text-slate-800', !isActive);
            btn.classList.toggle('border-slate-200', !isActive);
        });
    }

    function switchView(viewName) {
        state.activeView = viewName;
        document.querySelectorAll('.view-section').forEach((sec) => sec.classList.add('hidden'));
        const target = document.getElementById(`view-${viewName}`);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-link').forEach((btn) => {
            const active = btn.dataset.nav === viewName;
            btn.classList.toggle('text-brand-500', active);
            btn.classList.toggle('text-slate-700', !active);
        });

        if (viewName === 'track') {
            setActiveQuickTab('track');
        } else if (viewName === 'store' && state.quickTab === 'track') {
            setActiveQuickTab('all');
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (viewName === 'checkout') {
            refreshCheckoutSummary();
        }
    }

    function addToCart(product, qty = 1, variant = '') {
        if (!product) return;
        const resolved = resolveVariantOption(product, variant || state.cardVariantMap[product.id] || '');
        const chosenVariant = resolved.name || (product.variants && product.variants[0]) || '';
        const existing = state.cart.find(
            (i) => i.productId === product.id && i.variant === chosenVariant
        );
        if (existing) {
            existing.quantity += qty;
            existing.originalPrice = resolved.originalPrice;
            existing.discountPrice = resolved.discountPrice;
        } else {
            state.cart.push({
                productId: product.id,
                title: product.title,
                sku: product.sku,
                variant: chosenVariant,
                quantity: qty,
                originalPrice: resolved.originalPrice,
                discountPrice: resolved.discountPrice,
                image: product.images?.[0] || '/images/product_qled_tv.jpg'
            });
        }
        saveCart();
        showToast(`Added "${product.title}"${chosenVariant ? ` (${chosenVariant})` : ''}`);
    }

    function toggleWishlist(productId) {
        const idx = state.wishlist.indexOf(productId);
        if (idx >= 0) {
            state.wishlist.splice(idx, 1);
            showToast('Removed from Saved list');
        } else {
            state.wishlist.push(productId);
            showToast('Saved to Wishlist');
        }
        saveWishlist();
        renderFlashDeals();
        renderCatalog();
    }

    function renderCategories() {
        const grid = document.getElementById('categories-grid');
        const filterSel = document.getElementById('filter-category');
        if (!grid || !filterSel) return;

        filterSel.innerHTML = '<option value="all">All Categories</option>' +
            state.categories.map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}</option>`).join('');
        filterSel.value = state.filters.category;

        grid.innerHTML = state.categories.map((cat) => {
            const active = state.filters.category === cat.slug;
            return `
                <button
                    type="button"
                    data-cat-slug="${escapeHtml(cat.slug)}"
                    class="cat-card group text-left bg-white border ${active ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-400'} rounded-xl overflow-hidden transition-all flex flex-col"
                >
                    <div class="aspect-[4/3] bg-[#F4F4F5] overflow-hidden w-full">
                        <img src="${escapeHtml(cat.image || '/images/product_qled_tv.jpg')}" alt="${escapeHtml(cat.name)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300" />
                    </div>
                    <div class="p-3.5">
                        <p class="font-display font-bold text-xs sm:text-sm text-slate-900 leading-snug">${escapeHtml(cat.name)}</p>
                        <p class="text-[11px] text-slate-500 tabular-nums mt-0.5">${cat.productCount || 0} ${(cat.productCount || 0) === 1 ? 'item' : 'items'}</p>
                    </div>
                </button>
            `;
        }).join('');

        grid.querySelectorAll('.cat-card').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.filters.category = btn.dataset.catSlug;
                state.wishlistOnly = false;
                document.getElementById('filter-category').value = state.filters.category;
                setActiveQuickTab('categories');
                renderCategories();
                renderCatalog();
                document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    function createProductCardHtml(p) {
        const isWished = state.wishlist.includes(p.id);
        const imgUrl = escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg');
        const activeVariant = resolveVariantOption(p, state.cardVariantMap[p.id] || '');
        const outOfStock = (activeVariant.stock ?? p.stock) <= 0;
        const hasMultiVariants = Array.isArray(p.variantOptions) && p.variantOptions.length > 1;
        const hasDistinctPrices = hasMultiVariants && new Set(p.variantOptions.map((v) => v.discountPrice)).size > 1;

        return `
            <article class="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
                <div class="relative aspect-[4/3] bg-[#F4F4F5] overflow-hidden cursor-pointer pdp-trigger" data-product-id="${p.id}">
                    <img src="${imgUrl}" alt="${escapeHtml(p.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-300" />
                    ${activeVariant.discountPercentage > 0 ? `<span data-card-badge="${p.id}" class="absolute top-2.5 left-2.5 bg-brand-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums">-${activeVariant.discountPercentage}% OFF</span>` : ''}
                    <button
                        type="button"
                        data-wish-id="${p.id}"
                        aria-label="Save ${escapeHtml(p.title)} to wishlist"
                        class="wish-btn absolute top-2.5 right-2.5 w-8 h-8 rounded-lg bg-white/95 border border-slate-200 flex items-center justify-center text-slate-700 hover:text-brand-500 transition-colors"
                    >
                        <svg class="w-4 h-4 ${isWished ? 'fill-brand-500 text-brand-500' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                    </button>
                </div>

                <div class="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide truncate">
                            ${escapeHtml(p.brand)} · ${escapeHtml(p.sku)}
                        </p>
                        <h3 class="font-display font-bold text-sm sm:text-[15px] text-slate-950 leading-snug line-clamp-2 min-h-[2.5rem] cursor-pointer pdp-trigger hover:text-brand-500 transition-colors" data-product-id="${p.id}">
                            ${escapeHtml(p.title)}
                        </h3>
                        <p class="text-xs text-slate-500 tabular-nums">
                            ★ ${Number(p.rating || 4.8).toFixed(1)} (${p.reviewCount || 12}) · ${p.soldCount || 0} sold
                        </p>
                        ${hasMultiVariants ? `
                            <div class="flex flex-wrap gap-1 pt-1">
                                ${p.variantOptions.map((v) => {
                                    const selected = v.name === activeVariant.name;
                                    return `
                                        <button
                                            type="button"
                                            data-card-var-prod="${p.id}"
                                            data-card-var-name="${escapeHtml(v.name)}"
                                            class="card-var-btn px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                                                selected
                                                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-400'
                                            }"
                                        >
                                            ${escapeHtml(v.name)}
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div class="space-y-3 pt-1">
                        <div class="flex items-baseline gap-2 flex-wrap">
                            <span data-card-price="${p.id}" class="font-display font-extrabold text-lg text-slate-950 tabular-nums">${formatPkr(activeVariant.discountPrice)}</span>
                            ${activeVariant.discountPercentage > 0 ? `<span data-card-orig="${p.id}" class="text-xs text-slate-400 line-through tabular-nums">${formatPkr(activeVariant.originalPrice)}</span>` : `<span data-card-orig="${p.id}" class="hidden"></span>`}
                            ${hasDistinctPrices ? '<span class="text-[11px] text-slate-500 font-medium">· variant price</span>' : ''}
                        </div>

                        <div class="grid grid-cols-5 gap-2">
                            <button
                                type="button"
                                data-add-id="${p.id}"
                                ${outOfStock ? 'disabled' : ''}
                                class="add-cart-btn col-span-3 h-9 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-300 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                            >
                                ${outOfStock ? 'Out of Stock' : 'Add to Bag'}
                            </button>
                            <button
                                type="button"
                                data-product-id="${p.id}"
                                class="pdp-trigger col-span-2 h-9 border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                            >
                                Details
                            </button>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }

    function bindProductCardEvents(container) {
        if (!container) return;
        container.querySelectorAll('.card-var-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = Number(btn.dataset.cardVarProd);
                const vName = btn.dataset.cardVarName;
                const prod = state.products.find((p) => p.id === pid);
                if (!prod) return;
                state.cardVariantMap[pid] = vName;
                const resolved = resolveVariantOption(prod, vName);

                container.querySelectorAll(`.card-var-btn[data-card-var-prod="${pid}"]`).forEach((b) => {
                    const active = b.dataset.cardVarName === vName;
                    b.classList.toggle('border-brand-500', active);
                    b.classList.toggle('bg-brand-50', active);
                    b.classList.toggle('text-brand-700', active);
                    b.classList.toggle('border-slate-200', !active);
                    b.classList.toggle('bg-slate-50', !active);
                    b.classList.toggle('text-slate-700', !active);
                });

                container.querySelectorAll(`[data-card-price="${pid}"]`).forEach((el) => {
                    el.textContent = formatPkr(resolved.discountPrice);
                });
                container.querySelectorAll(`[data-card-orig="${pid}"]`).forEach((el) => {
                    if (resolved.discountPercentage > 0) {
                        el.textContent = formatPkr(resolved.originalPrice);
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                });
                container.querySelectorAll(`[data-card-badge="${pid}"]`).forEach((el) => {
                    if (resolved.discountPercentage > 0) {
                        el.textContent = `-${resolved.discountPercentage}% OFF`;
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                });
            });
        });

        container.querySelectorAll('.add-cart-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.addId);
                const prod = state.products.find((p) => p.id === id);
                addToCart(prod, 1, state.cardVariantMap[id] || '');
            });
        });

        container.querySelectorAll('.wish-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleWishlist(Number(btn.dataset.wishId));
            });
        });

        container.querySelectorAll('.pdp-trigger').forEach((el) => {
            el.addEventListener('click', () => {
                const id = Number(el.dataset.productId);
                const prod = state.products.find((p) => p.id === id);
                if (prod) openProductDetailModal(prod);
            });
        });
    }

    function renderFlashDeals() {
        const grid = document.getElementById('flash-deals-grid');
        if (!grid) return;
        const deals = state.flashDeals.slice(0, 4);
        grid.innerHTML = deals.map(createProductCardHtml).join('');
        bindProductCardEvents(grid);
    }

    function getFilteredProducts() {
        let list = [...state.products];

        if (state.wishlistOnly) {
            list = list.filter((p) => state.wishlist.includes(p.id));
        }
        if (state.filters.category && state.filters.category !== 'all') {
            list = list.filter((p) => p.categorySlug === state.filters.category);
        }
        if (state.filters.search) {
            const q = state.filters.search.toLowerCase();
            list = list.filter((p) =>
                p.title.toLowerCase().includes(q) ||
                p.brand.toLowerCase().includes(q) ||
                p.sku.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q)
            );
        }
        if (state.filters.maxPrice < 300000) {
            list = list.filter((p) => p.discountPrice <= state.filters.maxPrice);
        }
        if (state.filters.minDiscount) {
            const minD = Number(state.filters.minDiscount);
            list = list.filter((p) => p.discountPercentage >= minD);
        }
        if (state.filters.tag) {
            list = list.filter((p) => (p.tags || []).includes(state.filters.tag));
        }
        if (state.filters.inStock) {
            list = list.filter((p) => p.stock > 0);
        }

        switch (state.filters.sort) {
            case 'price_asc':
                list.sort((a, b) => a.discountPrice - b.discountPrice);
                break;
            case 'price_desc':
                list.sort((a, b) => b.discountPrice - a.discountPrice);
                break;
            case 'best_selling':
                list.sort((a, b) => b.soldCount - a.soldCount);
                break;
            case 'discount':
                list.sort((a, b) => b.discountPercentage - a.discountPercentage);
                break;
            default:
                list.sort((a, b) => b.id - a.id);
                break;
        }
        return list;
    }

    function renderCatalog() {
        const grid = document.getElementById('catalog-grid');
        const heading = document.getElementById('catalog-heading');
        const countLabel = document.getElementById('catalog-count-label');
        if (!grid) return;

        const filtered = getFilteredProducts();
        if (state.wishlistOnly) {
            heading.textContent = 'Saved Wishlist Items';
        } else if (state.filters.minDiscount === '1') {
            heading.textContent = 'Sale Items & Special Offers';
        } else if (state.filters.tag === 'Featured') {
            heading.textContent = 'Featured Electronics';
        } else if (state.filters.tag === 'Free Delivery') {
            heading.textContent = 'Free Delivery Electronics';
        } else if (state.filters.category !== 'all') {
            const cat = state.categories.find((c) => c.slug === state.filters.category);
            heading.textContent = cat ? cat.name : 'Selected Category';
        } else {
            heading.textContent = 'All Electronics';
        }

        countLabel.textContent = `Showing ${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
                    <p class="font-display font-bold text-slate-900">No products match your current filters.</p>
                    <button id="empty-reset-btn" type="button" class="h-9 px-4 bg-brand-500 text-white text-xs font-semibold rounded-lg">Reset All Filters</button>
                </div>
            `;
            document.getElementById('empty-reset-btn')?.addEventListener('click', resetFilters);
            return;
        }

        grid.innerHTML = filtered.map(createProductCardHtml).join('');
        bindProductCardEvents(grid);
    }

    function openProductDetailModal(product) {
        state.pdpProduct = product;
        const initialVariant = state.cardVariantMap[product.id] || product.variants?.[0] || 'Standard';
        let activeVariant = resolveVariantOption(product, initialVariant);
        state.pdpSelectedVariant = activeVariant.name || initialVariant;
        state.pdpActiveImageIdx = 0;

        const modal = document.getElementById('pdp-modal');
        const body = document.getElementById('pdp-modal-body');
        const images = product.images?.length ? product.images : ['/images/product_qled_tv.jpg'];
        const cityRates = state.store.cityRates || { Hasilpur: 0, Lahore: 350, Karachi: 450 };
        const variantList = Array.isArray(product.variantOptions) && product.variantOptions.length
            ? product.variantOptions
            : (product.variants || []).map((v) => ({
                name: v,
                originalPrice: product.originalPrice,
                discountPrice: product.discountPrice,
                discountPercentage: product.discountPercentage,
                stock: product.stock
            }));

        body.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
                <div class="md:col-span-6 space-y-3">
                    <div id="pdp-zoom-frame" class="relative aspect-[4/3] bg-[#F4F4F5] border border-slate-200 rounded-xl overflow-hidden cursor-zoom-in">
                        <img id="pdp-main-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-full h-full object-cover transition-transform duration-300" />
                        <span id="pdp-discount-badge" class="${activeVariant.discountPercentage > 0 ? '' : 'hidden '}absolute top-3 left-3 bg-brand-500 text-white text-xs font-bold px-2.5 py-1 rounded-md tabular-nums">-${activeVariant.discountPercentage}% OFF</span>
                    </div>
                    ${images.length > 1 ? `
                        <div class="flex gap-2.5">
                            ${images.map((img, i) => `
                                <button type="button" data-img-idx="${i}" class="pdp-thumb w-16 h-14 border ${i === 0 ? 'border-brand-500' : 'border-slate-200'} rounded-lg overflow-hidden bg-slate-100">
                                    <img src="${escapeHtml(img)}" alt="Thumbnail ${i + 1}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-full h-full object-cover" />
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>

                <div class="md:col-span-6 space-y-4">
                    <div class="space-y-1">
                        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            ${escapeHtml(product.shopName)} · SKU: ${escapeHtml(product.sku)}
                        </p>
                        <h2 class="font-display text-2xl font-bold text-slate-950 leading-tight">${escapeHtml(product.title)}</h2>
                        <p class="text-xs text-slate-600 tabular-nums">
                            ★ ${Number(product.rating || 4.8).toFixed(1)} (${product.reviewCount || 12} Verified Reviews) · ${product.soldCount || 0} units sold
                        </p>
                    </div>

                    <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                        <div class="flex items-baseline gap-3">
                            <span id="pdp-sale-price" class="font-display text-2xl font-extrabold text-brand-500 tabular-nums">${formatPkr(activeVariant.discountPrice)}</span>
                            <span id="pdp-original-price" class="${activeVariant.discountPercentage > 0 ? '' : 'hidden '}text-sm text-slate-400 line-through tabular-nums">${formatPkr(activeVariant.originalPrice)}</span>
                        </div>
                        <p id="pdp-stock-line" class="text-xs font-medium text-emerald-700">
                            Cash on Delivery Available · ${(activeVariant.stock ?? product.stock) > 0 ? `${activeVariant.stock ?? product.stock} units in stock` : 'Currently out of stock'}
                        </p>
                    </div>

                    <p class="text-sm text-slate-700 leading-relaxed">${escapeHtml(product.description)}</p>

                    ${variantList.length ? `
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Select Variant &amp; Price</p>
                            <div class="flex flex-wrap gap-2">
                                ${variantList.map((v) => {
                                    const isSelected = v.name === state.pdpSelectedVariant;
                                    return `
                                        <button type="button" data-variant="${escapeHtml(v.name)}" class="pdp-variant-btn px-3 py-1.5 text-xs font-semibold rounded-lg border ${isSelected ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}">
                                            <span>${escapeHtml(v.name)}</span>
                                            <span class="ml-1.5 font-mono text-[11px] opacity-80">${formatPkr(v.discountPrice)}</span>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="border border-slate-200 rounded-xl p-3.5 space-y-2">
                        <div class="flex items-center justify-between gap-2">
                            <label for="pdp-city-est" class="text-xs font-semibold text-slate-600">COD Delivery Estimator</label>
                            <select id="pdp-city-est" class="h-8 px-2 border border-slate-300 rounded-lg text-xs bg-white">
                                ${Object.keys(cityRates).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                            </select>
                        </div>
                        <p id="pdp-delivery-fee-note" class="text-xs text-slate-700 font-medium"></p>
                        <p class="text-[11px] text-slate-500">Warranty: ${escapeHtml(product.warranty || 'Official Brand Warranty')}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-3 pt-2">
                        <button id="pdp-add-cart-btn" type="button" ${(activeVariant.stock ?? product.stock) <= 0 ? 'disabled' : ''} class="h-11 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold rounded-xl">
                            Add to Bag
                        </button>
                        <button id="pdp-buy-now-btn" type="button" ${(activeVariant.stock ?? product.stock) <= 0 ? 'disabled' : ''} class="h-11 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-300 text-white text-sm font-semibold rounded-xl">
                            Buy Now (COD)
                        </button>
                    </div>
                </div>
            </div>
        `;

        const updateFeeNote = () => {
            const citySel = document.getElementById('pdp-city-est');
            const note = document.getElementById('pdp-delivery-fee-note');
            if (!citySel || !note) return;
            const city = citySel.value;
            const threshold = Number(state.store.freeDeliveryThreshold || 35000);
            if (activeVariant.discountPrice >= threshold) {
                note.textContent = `Free COD Delivery to ${city} (order exceeds ${formatPkr(threshold)})`;
            } else {
                const rate = cityRates[city] ?? state.store.codFlatRate ?? 250;
                note.textContent = rate === 0
                    ? `FREE Same/Next-Day COD in ${city}`
                    : `Estimated COD Fee for ${city}: ${formatPkr(rate)}`;
            }
        };
        updateFeeNote();
        document.getElementById('pdp-city-est')?.addEventListener('change', updateFeeNote);

        const zoomFrame = document.getElementById('pdp-zoom-frame');
        const mainImg = document.getElementById('pdp-main-img');
        let zoomed = false;
        zoomFrame?.addEventListener('click', () => {
            zoomed = !zoomed;
            mainImg.classList.toggle('scale-150', zoomed);
            zoomFrame.classList.toggle('cursor-zoom-out', zoomed);
            zoomFrame.classList.toggle('cursor-zoom-in', !zoomed);
        });

        body.querySelectorAll('.pdp-thumb').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.imgIdx);
                mainImg.src = images[idx];
                body.querySelectorAll('.pdp-thumb').forEach((t, ti) => {
                    t.classList.toggle('border-brand-500', ti === idx);
                    t.classList.toggle('border-slate-200', ti !== idx);
                });
            });
        });

        body.querySelectorAll('.pdp-variant-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.pdpSelectedVariant = btn.dataset.variant;
                state.cardVariantMap[product.id] = state.pdpSelectedVariant;
                activeVariant = resolveVariantOption(product, state.pdpSelectedVariant);

                body.querySelectorAll('.pdp-variant-btn').forEach((b) => {
                    const active = b === btn;
                    b.classList.toggle('border-brand-500', active);
                    b.classList.toggle('bg-brand-50', active);
                    b.classList.toggle('text-brand-700', active);
                    b.classList.toggle('border-slate-300', !active);
                });

                const saleEl = document.getElementById('pdp-sale-price');
                const origEl = document.getElementById('pdp-original-price');
                const badgeEl = document.getElementById('pdp-discount-badge');
                const stockEl = document.getElementById('pdp-stock-line');
                const addBtn = document.getElementById('pdp-add-cart-btn');
                const buyBtn = document.getElementById('pdp-buy-now-btn');

                if (saleEl) saleEl.textContent = formatPkr(activeVariant.discountPrice);
                if (origEl) {
                    origEl.textContent = formatPkr(activeVariant.originalPrice);
                    origEl.classList.toggle('hidden', activeVariant.discountPercentage <= 0);
                }
                if (badgeEl) {
                    badgeEl.textContent = `-${activeVariant.discountPercentage}% OFF`;
                    badgeEl.classList.toggle('hidden', activeVariant.discountPercentage <= 0);
                }
                const vStock = activeVariant.stock ?? product.stock;
                if (stockEl) {
                    stockEl.textContent = `Cash on Delivery Available · ${vStock > 0 ? `${vStock} units in stock` : 'Currently out of stock'}`;
                }
                if (addBtn) addBtn.disabled = vStock <= 0;
                if (buyBtn) buyBtn.disabled = vStock <= 0;
                updateFeeNote();
            });
        });

        document.getElementById('pdp-add-cart-btn')?.addEventListener('click', () => {
            addToCart(product, 1, state.pdpSelectedVariant);
            modal.classList.add('hidden');
        });

        document.getElementById('pdp-buy-now-btn')?.addEventListener('click', () => {
            addToCart(product, 1, state.pdpSelectedVariant);
            modal.classList.add('hidden');
            switchView('checkout');
        });

        modal.classList.remove('hidden');
    }

    function renderCartDrawer() {
        const container = document.getElementById('cart-drawer-items');
        const subEl = document.getElementById('cart-drawer-subtotal');
        if (!container || !subEl) return;

        if (state.cart.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 space-y-3">
                    <p class="text-sm font-medium text-slate-600">Your order bag is empty.</p>
                    <p class="text-xs text-slate-400">Browse electronics and tap "Add to Bag".</p>
                </div>
            `;
            subEl.textContent = 'Rs. 0';
            return;
        }

        let subtotal = 0;
        container.innerHTML = state.cart.map((item, idx) => {
            const line = (item.discountPrice || 0) * (item.quantity || 1);
            subtotal += line;
            return `
                <div class="flex gap-3 border border-slate-200 rounded-xl p-3 bg-white">
                    <img src="${escapeHtml(item.image || '/images/product_qled_tv.jpg')}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-16 h-16 object-cover rounded-lg bg-slate-100 shrink-0" />
                    <div class="flex-1 min-w-0 space-y-1">
                        <p class="text-xs font-bold text-slate-900 line-clamp-2">${escapeHtml(item.title)}</p>
                        ${item.variant ? `<p class="text-[11px] text-slate-500">${escapeHtml(item.variant)}</p>` : ''}
                        <p class="text-xs font-bold text-brand-500 tabular-nums">${formatPkr(line)}</p>
                        <div class="flex items-center justify-between pt-1">
                            <div class="flex items-center border border-slate-300 rounded-lg">
                                <button type="button" data-qty-idx="${idx}" data-delta="-1" aria-label="Decrease quantity" class="cart-qty-btn w-6 h-6 text-xs font-bold hover:bg-slate-100">−</button>
                                <span class="px-2.5 text-xs font-semibold tabular-nums">${item.quantity}</span>
                                <button type="button" data-qty-idx="${idx}" data-delta="1" aria-label="Increase quantity" class="cart-qty-btn w-6 h-6 text-xs font-bold hover:bg-slate-100">+</button>
                            </div>
                            <button type="button" data-remove-idx="${idx}" class="cart-remove-btn text-[11px] font-semibold text-red-600 hover:underline">Remove</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        subEl.textContent = formatPkr(subtotal);

        container.querySelectorAll('.cart-qty-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.qtyIdx);
                const delta = Number(btn.dataset.delta);
                if (!state.cart[idx]) return;
                state.cart[idx].quantity += delta;
                if (state.cart[idx].quantity <= 0) state.cart.splice(idx, 1);
                saveCart();
                if (state.activeView === 'checkout') refreshCheckoutSummary();
            });
        });

        container.querySelectorAll('.cart-remove-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.cart.splice(Number(btn.dataset.removeIdx), 1);
                saveCart();
                if (state.activeView === 'checkout') refreshCheckoutSummary();
            });
        });
    }

    async function refreshCheckoutSummary() {
        const listEl = document.getElementById('checkout-items-list');
        if (!listEl) return;

        if (state.cart.length === 0) {
            listEl.innerHTML = '<p class="text-sm text-slate-500">Your order bag is empty. Add an item before checking out.</p>';
            document.getElementById('co-subtotal').textContent = 'Rs. 0';
            document.getElementById('co-discount').textContent = '-Rs. 0';
            document.getElementById('co-shipping').textContent = 'Rs. 0';
            document.getElementById('co-grand-total').textContent = 'Rs. 0';
            return;
        }

        listEl.innerHTML = state.cart.map((item) => `
            <div class="flex items-center justify-between gap-3 text-xs border-b border-slate-100 pb-2.5">
                <div class="min-w-0">
                    <p class="font-semibold text-slate-900 truncate">${escapeHtml(item.title)}</p>
                    <p class="text-slate-500">${escapeHtml(item.variant || 'Standard')} × ${item.quantity}</p>
                </div>
                <span class="tabular-nums font-bold text-slate-900 shrink-0">${formatPkr(item.discountPrice * item.quantity)}</span>
            </div>
        `).join('');

        const city = document.getElementById('co-city')?.value || 'Hasilpur';
        const deliverySpeed = document.getElementById('co-speed')?.value || 'standard';

        try {
            const est = await request('/api/orders/estimate', {
                method: 'POST',
                body: JSON.stringify({ items: state.cart, city, deliverySpeed })
            });
            document.getElementById('co-subtotal').textContent = formatPkr(est.subtotal);
            document.getElementById('co-discount').textContent = `-${formatPkr(est.discountTotal)}`;
            document.getElementById('co-shipping').textContent = est.codDeliveryCharges === 0 ? 'FREE' : formatPkr(est.codDeliveryCharges);
            document.getElementById('co-grand-total').textContent = formatPkr(est.grandTotal);
        } catch (_) {}
    }

    function syncFilterInputsFromState() {
        document.getElementById('filter-category').value = state.filters.category;
        document.getElementById('filter-price-max').value = String(state.filters.maxPrice);
        document.getElementById('filter-price-label').textContent =
            state.filters.maxPrice >= 300000 ? 'Any' : formatPkr(state.filters.maxPrice);
        document.getElementById('filter-discount').value = state.filters.minDiscount;
        document.getElementById('filter-tag').value = state.filters.tag;
        document.getElementById('filter-instock').checked = state.filters.inStock;
        document.getElementById('sort-products').value = state.filters.sort;
    }

    function resetFilters(options = {}) {
        const { keepQuickTab = false } = options;
        state.wishlistOnly = false;
        state.filters = {
            category: 'all',
            search: '',
            maxPrice: 300000,
            minDiscount: '',
            tag: '',
            inStock: false,
            sort: 'newest'
        };
        syncFilterInputsFromState();
        document.getElementById('global-search-input').value = '';
        document.getElementById('mobile-search-input').value = '';
        if (!keepQuickTab) {
            setActiveQuickTab('all');
        }
        renderCategories();
        renderCatalog();
    }

    function applyQuickTab(tab) {
        if (tab === 'track') {
            switchView('track');
            return;
        }
        if (state.activeView !== 'store') {
            switchView('store');
        }

        setActiveQuickTab(tab);

        if (tab === 'all') {
            resetFilters({ keepQuickTab: true });
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'categories') {
            resetFilters({ keepQuickTab: true });
            document.getElementById('categories-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'sale') {
            resetFilters({ keepQuickTab: true });
            state.filters.minDiscount = '1';
            state.filters.sort = 'discount';
            syncFilterInputsFromState();
            renderCatalog();
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'featured') {
            resetFilters({ keepQuickTab: true });
            state.filters.tag = 'Featured';
            syncFilterInputsFromState();
            renderCatalog();
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        } else if (tab === 'free_delivery') {
            resetFilters({ keepQuickTab: true });
            state.filters.tag = 'Free Delivery';
            syncFilterInputsFromState();
            renderCatalog();
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        }
    }

    function resetPopupCopyBtn() {
        const copyBtn = document.getElementById('popup-copy-order-btn');
        if (!copyBtn) return;
        const label = copyBtn.querySelector('span');
        if (label) label.textContent = 'Copy';
        copyBtn.classList.remove('border-emerald-300', 'bg-emerald-50', 'text-emerald-700');
        copyBtn.classList.add('border-slate-300', 'bg-white', 'text-slate-800');
    }

    function openOrderConfirmedPopup(order) {
        const modal = document.getElementById('order-confirmed-popup-modal');
        if (!modal || !order) return;

        const shortCode = String(order.orderId || '').split('-').pop() || order.orderId;
        document.getElementById('popup-order-id').textContent = `#${order.orderId}`;
        document.getElementById('popup-whatsapp-num').textContent = order.whatsappNumber || '';
        document.getElementById('popup-order-total').textContent = formatPkr(order.grandTotal);
        document.getElementById('popup-order-status').textContent = 'Waiting for WhatsApp Confirmation';
        const shortEl = document.getElementById('popup-short-code');
        if (shortEl) shortEl.textContent = shortCode;
        resetPopupCopyBtn();
        modal.classList.remove('hidden');
    }

    function closeOrderConfirmedPopup() {
        const modal = document.getElementById('order-confirmed-popup-modal');
        if (modal) modal.classList.add('hidden');
    }

    function bindSearchSuggestions(inputEl) {
        const box = document.getElementById('search-suggestions');
        if (!inputEl) return;

        inputEl.addEventListener('input', () => {
            const q = inputEl.value.trim();
            state.filters.search = q;
            if (state.activeView !== 'store') switchView('store');
            renderCatalog();

            if (!box || inputEl.id !== 'global-search-input') return;
            if (!q) {
                box.classList.add('hidden');
                return;
            }
            const matches = state.products.filter((p) =>
                p.title.toLowerCase().includes(q.toLowerCase()) ||
                p.brand.toLowerCase().includes(q.toLowerCase()) ||
                p.sku.toLowerCase().includes(q.toLowerCase())
            ).slice(0, 5);

            if (matches.length === 0) {
                box.innerHTML = '<div class="px-4 py-3 text-xs text-slate-500">No matching products found.</div>';
            } else {
                box.innerHTML = matches.map((p) => `
                    <button type="button" data-sug-id="${p.id}" class="sug-item w-full text-left px-3.5 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <img src="${escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg')}" alt="" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/images/product_qled_tv.jpg';" class="w-9 h-9 rounded-lg object-cover bg-slate-100 shrink-0" />
                            <div class="min-w-0">
                                <p class="text-xs font-semibold text-slate-900 truncate">${escapeHtml(p.title)}</p>
                                <p class="text-[11px] text-slate-500">${escapeHtml(p.sku)}</p>
                            </div>
                        </div>
                        <span class="text-xs font-bold text-brand-500 tabular-nums shrink-0">${formatPkr(p.discountPrice)}</span>
                    </button>
                `).join('');
            }
            box.classList.remove('hidden');

            box.querySelectorAll('.sug-item').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const prod = state.products.find((p) => p.id === Number(btn.dataset.sugId));
                    box.classList.add('hidden');
                    if (prod) openProductDetailModal(prod);
                });
            });
        });

        document.addEventListener('click', (e) => {
            if (box && !box.contains(e.target) && e.target !== inputEl) {
                box.classList.add('hidden');
            }
        });
    }

    async function lookupTrackingOrder(orderId) {
        const resultEl = document.getElementById('track-order-result');
        if (!resultEl) return;
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = '<p class="text-sm text-slate-500">Looking up order...</p>';

        try {
            const { order } = await request(`/api/orders/track/${encodeURIComponent(orderId.trim())}`);
            const shortCode = String(order.orderId || '').split('-').pop() || order.orderId;
            const statusColor =
                order.orderStatus === 'Confirmed' || order.orderStatus === 'Delivered'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : order.orderStatus === 'Dispatched' || order.orderStatus === 'Shipped'
                    ? 'bg-sky-50 text-sky-800 border-sky-200'
                    : order.orderStatus === 'Cancelled'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';

            resultEl.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <p class="font-mono text-lg font-bold text-slate-950">#${escapeHtml(order.orderId)}</p>
                            <button id="track-copy-order-btn" type="button" class="h-7 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold">
                                Copy ID
                            </button>
                            <span class="font-mono text-xs text-slate-500">Code: ${escapeHtml(shortCode)}</span>
                        </div>
                        <p class="text-xs text-slate-500 mt-0.5">Placed on ${escapeHtml(order.orderDate)} · ${escapeHtml(order.paymentMethod)}</p>
                    </div>
                    <span class="px-3 py-1 text-xs font-bold border rounded-lg ${statusColor}">${escapeHtml(order.orderStatus)}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
                    <div>
                        <p class="font-semibold text-slate-500 uppercase">Customer</p>
                        <p class="font-bold text-slate-900 mt-0.5">${escapeHtml(order.customerName)}</p>
                        <p class="font-mono text-slate-700">${escapeHtml(order.whatsappNumber)}</p>
                    </div>
                    <div>
                        <p class="font-semibold text-slate-500 uppercase">Shipping Destination</p>
                        <p class="font-bold text-slate-900 mt-0.5">${escapeHtml(order.shippingAddress)}, ${escapeHtml(order.city)}</p>
                        ${order.nearestLandmark ? `<p class="text-slate-600">Landmark: ${escapeHtml(order.nearestLandmark)}</p>` : ''}
                    </div>
                </div>
                <div class="space-y-2 text-sm">
                    ${(order.items || []).map((i) => `
                        <div class="flex justify-between border-b border-slate-100 pb-2">
                            <span>${escapeHtml(i.title)}${i.variant ? ` (${escapeHtml(i.variant)})` : ''} × ${i.quantity}</span>
                            <span class="tabular-nums font-semibold">${formatPkr(i.lineTotal)}</span>
                        </div>
                    `).join('')}
                    <div class="flex justify-between font-bold text-base pt-2">
                        <span>Grand Total (COD)</span>
                        <span class="tabular-nums text-brand-500">${formatPkr(order.grandTotal)}</span>
                    </div>
                </div>
            `;

            document.getElementById('track-copy-order-btn')?.addEventListener('click', async (ev) => {
                const btn = ev.currentTarget;
                const ok = await copyTextToClipboard(order.orderId);
                if (ok) {
                    btn.textContent = 'Copied ✓';
                    showToast(`Copied ${order.orderId}`);
                    setTimeout(() => { btn.textContent = 'Copy ID'; }, 1800);
                }
            });
        } catch (err) {
            resultEl.innerHTML = `<p class="text-sm font-semibold text-red-600">${escapeHtml(err.message)}</p>`;
        }
    }

    function startCountdown() {
        const el = document.getElementById('flash-countdown');
        if (!el) return;
        let seconds = 4 * 3600 + 28 * 60 + 19;
        setInterval(() => {
            seconds = seconds > 0 ? seconds - 1 : 4 * 3600;
            const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
            const s = String(seconds % 60).padStart(2, '0');
            el.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    async function loadBootstrap() {
        const data = await request('/api/store/bootstrap');
        state.store = data.store || {};
        state.categories = data.categories || [];
        state.products = data.products || [];
        state.featured = data.featured || [];
        state.flashDeals = data.flashDeals || [];
        renderCategories();
        renderFlashDeals();
        renderCatalog();
    }

    function bindEvents() {
        document.querySelectorAll('[data-nav]').forEach((btn) => {
            btn.addEventListener('click', () => switchView(btn.dataset.nav));
        });

        document.querySelectorAll('.quick-tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => applyQuickTab(btn.dataset.quickTab));
        });

        document.getElementById('brand-home-btn')?.addEventListener('click', () => {
            resetFilters();
            switchView('store');
        });
        document.getElementById('back-to-store-btn')?.addEventListener('click', () => switchView('store'));
        document.getElementById('reset-category-btn')?.addEventListener('click', () => resetFilters());
        document.getElementById('clear-filters-btn')?.addEventListener('click', () => resetFilters());

        document.getElementById('mobile-filter-toggle-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('catalog-filters-panel');
            if (panel) panel.classList.toggle('hidden');
        });

        document.getElementById('wishlist-filter-btn')?.addEventListener('click', () => {
            state.wishlistOnly = !state.wishlistOnly;
            switchView('store');
            renderCatalog();
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        });

        // Order Bag drawer controls
        const drawer = document.getElementById('cart-drawer-backdrop');
        document.getElementById('open-cart-btn')?.addEventListener('click', () => drawer.classList.remove('hidden'));
        document.getElementById('close-cart-btn')?.addEventListener('click', () => drawer.classList.add('hidden'));
        drawer?.addEventListener('click', (e) => {
            if (e.target === drawer) drawer.classList.add('hidden');
        });
        document.getElementById('proceed-checkout-btn')?.addEventListener('click', () => {
            drawer.classList.add('hidden');
            switchView('checkout');
        });

        // PDP close
        const pdpModal = document.getElementById('pdp-modal');
        document.getElementById('pdp-close-btn')?.addEventListener('click', () => pdpModal.classList.add('hidden'));
        pdpModal?.addEventListener('click', (e) => {
            if (e.target === pdpModal) pdpModal.classList.add('hidden');
        });

        // Animated Order Confirmation Pop-Up controls
        const orderPopupModal = document.getElementById('order-confirmed-popup-modal');
        document.getElementById('popup-copy-order-btn')?.addEventListener('click', async () => {
            const orderIdText = state.lastOrder?.orderId ||
                document.getElementById('popup-order-id')?.textContent?.replace(/^#/, '').trim() || '';
            if (!orderIdText) return;
            const ok = await copyTextToClipboard(orderIdText);
            const copyBtn = document.getElementById('popup-copy-order-btn');
            const label = copyBtn?.querySelector('span');
            if (ok && copyBtn) {
                if (label) label.textContent = 'Copied ✓';
                copyBtn.classList.remove('border-slate-300', 'bg-white', 'text-slate-800');
                copyBtn.classList.add('border-emerald-300', 'bg-emerald-50', 'text-emerald-700');
                showToast(`Order ID ${orderIdText} copied to clipboard`);
                setTimeout(resetPopupCopyBtn, 2200);
            }
        });
        document.getElementById('popup-close-btn')?.addEventListener('click', () => {
            closeOrderConfirmedPopup();
            switchView('store');
        });
        document.getElementById('popup-continue-btn')?.addEventListener('click', () => {
            closeOrderConfirmedPopup();
            switchView('store');
        });
        document.getElementById('popup-track-btn')?.addEventListener('click', () => {
            closeOrderConfirmedPopup();
            switchView('track');
            if (state.lastOrder) {
                document.getElementById('track-order-input').value = state.lastOrder.orderId;
                lookupTrackingOrder(state.lastOrder.orderId);
            }
        });
        orderPopupModal?.addEventListener('click', (e) => {
            if (e.target === orderPopupModal) {
                closeOrderConfirmedPopup();
                switchView('store');
            }
        });

        // Filters
        document.getElementById('filter-category')?.addEventListener('change', (e) => {
            state.filters.category = e.target.value;
            renderCategories();
            renderCatalog();
        });
        document.getElementById('filter-price-max')?.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            state.filters.maxPrice = val;
            document.getElementById('filter-price-label').textContent = val >= 300000 ? 'Any' : formatPkr(val);
            renderCatalog();
        });
        document.getElementById('filter-discount')?.addEventListener('change', (e) => {
            state.filters.minDiscount = e.target.value;
            renderCatalog();
        });
        document.getElementById('filter-tag')?.addEventListener('change', (e) => {
            state.filters.tag = e.target.value;
            renderCatalog();
        });
        document.getElementById('filter-instock')?.addEventListener('change', (e) => {
            state.filters.inStock = e.target.checked;
            renderCatalog();
        });
        document.getElementById('sort-products')?.addEventListener('change', (e) => {
            state.filters.sort = e.target.value;
            renderCatalog();
        });

        bindSearchSuggestions(document.getElementById('global-search-input'));
        bindSearchSuggestions(document.getElementById('mobile-search-input'));

        // Checkout dynamic estimate
        document.getElementById('co-city')?.addEventListener('change', refreshCheckoutSummary);
        document.getElementById('co-speed')?.addEventListener('change', refreshCheckoutSummary);

        // COD Checkout Submission -> Show Animated Confirmation Pop-up Modal (with Copy Order ID button)
        document.getElementById('cod-checkout-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('checkout-error-msg');
            errEl.classList.add('hidden');

            const fd = new FormData(e.target);
            const payload = {
                customerName: fd.get('customerName'),
                whatsappNumber: fd.get('whatsappNumber'),
                city: fd.get('city'),
                deliverySpeed: fd.get('deliverySpeed'),
                shippingAddress: fd.get('shippingAddress'),
                nearestLandmark: fd.get('nearestLandmark'),
                orderNotes: fd.get('orderNotes'),
                items: state.cart
            };

            const btn = document.getElementById('place-cod-order-btn');
            btn.disabled = true;
            btn.textContent = 'Placing Order...';

            try {
                const res = await request('/api/orders/checkout', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                state.lastOrder = res.order;
                state.cart = [];
                saveCart();
                e.target.reset();
                loadBootstrap().catch(() => {});
                switchView('store');
                openOrderConfirmedPopup(res.order);
            } catch (err) {
                errEl.textContent = err.message;
                errEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Place COD Order';
            }
        });

        // Order Tracking Form (supports ORD-2026-9336 or 9336)
        document.getElementById('track-order-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = document.getElementById('track-order-input').value;
            if (val) lookupTrackingOrder(val);
        });
    }

    window.AlMumtazApp = {
        switchView,
        showToast,
        reloadBootstrap: loadBootstrap
    };

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        updateCartBadges();
        saveWishlist();
        startCountdown();
        loadBootstrap().catch((err) => showToast(err.message, true));

        const trackMatch = window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]+)/i);
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        const urlOrderId = trackMatch ? decodeURIComponent(trackMatch[1]) : (params.get('orderId') || '');
        if (trackMatch || tab === 'track') {
            switchView('track');
            if (urlOrderId) {
                const trackInp = document.getElementById('track-order-input');
                if (trackInp) trackInp.value = urlOrderId;
                lookupTrackingOrder(urlOrderId);
            }
        } else if (tab === 'checkout') {
            switchView('checkout');
        }

        // Silent background keep-alive ping to prevent bot & backend sleep
        setInterval(() => {
            fetch('/api/keepalive', { cache: 'no-store' }).catch(() => {});
        }, 20000);
    });
})();
