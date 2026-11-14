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
        pdpActiveImageIdx: 0
    };

    function showToast(msg, isError = false) {
        const el = document.getElementById('toast-banner');
        if (!el) return;
        el.textContent = msg;
        el.className = `fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded shadow-xl text-sm font-medium border ${
            isError
                ? 'bg-red-700 text-white border-red-800'
                : 'bg-gray-900 text-white border-gray-700'
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
        if (badge) badge.textContent = String(state.wishlist.length);
    }

    function updateCartBadges() {
        const count = state.cart.reduce((acc, item) => acc + (item.quantity || 1), 0);
        const badge = document.getElementById('cart-badge-count');
        if (badge) badge.textContent = String(count);
        renderCartDrawer();
    }

    function switchView(viewName) {
        state.activeView = viewName;
        document.querySelectorAll('.view-section').forEach((sec) => sec.classList.add('hidden'));
        const target = document.getElementById(`view-${viewName}`);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-link').forEach((btn) => {
            const active = btn.dataset.nav === viewName;
            btn.classList.toggle('text-brand-500', active);
            btn.classList.toggle('text-gray-700', !active);
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (viewName === 'checkout') {
            refreshCheckoutSummary();
        }
    }

    function addToCart(product, qty = 1, variant = '') {
        if (!product) return;
        const chosenVariant = variant || (product.variants && product.variants[0]) || '';
        const existing = state.cart.find(
            (i) => i.productId === product.id && i.variant === chosenVariant
        );
        if (existing) {
            existing.quantity += qty;
        } else {
            state.cart.push({
                productId: product.id,
                title: product.title,
                sku: product.sku,
                variant: chosenVariant,
                quantity: qty,
                originalPrice: product.originalPrice,
                discountPrice: product.discountPrice,
                image: product.images?.[0] || '/images/product_qled_tv.jpg'
            });
        }
        saveCart();
        showToast(`Added "${product.title}" to cart`);
    }

    function toggleWishlist(productId) {
        const idx = state.wishlist.indexOf(productId);
        if (idx >= 0) {
            state.wishlist.splice(idx, 1);
            showToast('Removed from Saved list');
        } else {
            state.wishlist.push(productId);
            showToast('Saved to your Wishlist');
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
                    class="cat-card text-left bg-white border ${active ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-200 hover:border-gray-400'} rounded overflow-hidden transition-colors flex flex-col"
                >
                    <div class="aspect-[4/3] bg-gray-100 overflow-hidden w-full">
                        <img src="${escapeHtml(cat.image || '/images/product_qled_tv.jpg')}" alt="${escapeHtml(cat.name)}" class="w-full h-full object-cover" />
                    </div>
                    <div class="p-3">
                        <p class="font-display font-bold text-xs sm:text-sm text-gray-900 leading-snug">${escapeHtml(cat.name)}</p>
                        <p class="text-[11px] text-gray-500 tabular-nums mt-0.5">${cat.productCount || 0} ${(cat.productCount || 0) === 1 ? 'product' : 'products'}</p>
                    </div>
                </button>
            `;
        }).join('');

        grid.querySelectorAll('.cat-card').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.filters.category = btn.dataset.catSlug;
                state.wishlistOnly = false;
                document.getElementById('filter-category').value = state.filters.category;
                renderCategories();
                renderCatalog();
                document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    function createProductCardHtml(p) {
        const isWished = state.wishlist.includes(p.id);
        const imgUrl = escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg');
        const outOfStock = p.stock <= 0;

        return `
            <article class="bg-white border border-gray-200 rounded overflow-hidden flex flex-col hover:border-gray-400 transition-colors">
                <div class="relative aspect-[4/3] bg-[#F3F4F6] overflow-hidden cursor-pointer pdp-trigger" data-product-id="${p.id}">
                    <img src="${imgUrl}" alt="${escapeHtml(p.title)}" class="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-300" />
                    ${p.discountPercentage > 0 ? `<span class="absolute top-2.5 left-2.5 bg-brand-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-sm tabular-nums">-${p.discountPercentage}% OFF</span>` : ''}
                    <button
                        type="button"
                        data-wish-id="${p.id}"
                        aria-label="Save to wishlist"
                        class="wish-btn absolute top-2.5 right-2.5 w-8 h-8 rounded bg-white/95 border border-gray-200 flex items-center justify-center text-gray-700 hover:text-brand-500"
                    >
                        <svg class="w-4 h-4 ${isWished ? 'fill-brand-500 text-brand-500' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                    </button>
                </div>

                <div class="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div class="space-y-1.5">
                        <p class="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">
                            ${escapeHtml(p.brand)} · ${escapeHtml(p.sku)}
                        </p>
                        <h3 class="font-display font-bold text-sm text-gray-950 leading-snug line-clamp-2 min-h-[2.5rem] cursor-pointer pdp-trigger hover:text-brand-500" data-product-id="${p.id}">
                            ${escapeHtml(p.title)}
                        </h3>
                        <p class="text-xs text-gray-500 tabular-nums">
                            ★ ${Number(p.rating || 4.8).toFixed(1)} (${p.reviewCount || 12}) · ${p.soldCount || 0} sold
                        </p>
                    </div>

                    <div class="space-y-3 pt-1">
                        <div class="flex items-baseline gap-2 flex-wrap">
                            <span class="font-display font-extrabold text-lg text-gray-950 tabular-nums">${formatPkr(p.discountPrice)}</span>
                            ${p.discountPercentage > 0 ? `<span class="text-xs text-gray-400 line-through tabular-nums">${formatPkr(p.originalPrice)}</span>` : ''}
                        </div>

                        <div class="grid grid-cols-5 gap-2">
                            <button
                                type="button"
                                data-add-id="${p.id}"
                                ${outOfStock ? 'disabled' : ''}
                                class="add-cart-btn col-span-3 h-9 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 text-white text-xs font-semibold rounded transition-colors"
                            >
                                ${outOfStock ? 'Out of Stock' : 'Add to Cart'}
                            </button>
                            <button
                                type="button"
                                data-product-id="${p.id}"
                                class="pdp-trigger col-span-2 h-9 border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-semibold rounded"
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
        container.querySelectorAll('.add-cart-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = Number(btn.dataset.addId);
                const prod = state.products.find((p) => p.id === id);
                addToCart(prod, 1);
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
            list = list.filter((p) => p.tags.includes(state.filters.tag));
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
        } else if (state.filters.category !== 'all') {
            const cat = state.categories.find((c) => c.slug === state.filters.category);
            heading.textContent = cat ? cat.name : 'Selected Category';
        } else {
            heading.textContent = 'All Electronics';
        }

        countLabel.textContent = `Showing ${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full bg-white border border-gray-200 rounded p-10 text-center space-y-3">
                    <p class="font-display font-bold text-gray-900">No products match your current filters.</p>
                    <button id="empty-reset-btn" type="button" class="h-9 px-4 bg-brand-500 text-white text-xs font-semibold rounded">Reset All Filters</button>
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
        state.pdpSelectedVariant = product.variants?.[0] || 'Standard';
        state.pdpActiveImageIdx = 0;

        const modal = document.getElementById('pdp-modal');
        const body = document.getElementById('pdp-modal-body');
        const images = product.images?.length ? product.images : ['/images/product_qled_tv.jpg'];
        const cityRates = state.store.cityRates || { Hasilpur: 0, Lahore: 350, Karachi: 450 };

        body.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-12 gap-8">
                <div class="md:col-span-6 space-y-3">
                    <div id="pdp-zoom-frame" class="relative aspect-[4/3] bg-[#F3F4F6] border border-gray-200 rounded overflow-hidden cursor-zoom-in">
                        <img id="pdp-main-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(product.title)}" class="w-full h-full object-cover transition-transform duration-300" />
                        ${product.discountPercentage > 0 ? `<span class="absolute top-3 left-3 bg-brand-500 text-white text-xs font-bold px-2.5 py-1 rounded-sm tabular-nums">-${product.discountPercentage}% OFF</span>` : ''}
                    </div>
                    ${images.length > 1 ? `
                        <div class="flex gap-2.5">
                            ${images.map((img, i) => `
                                <button type="button" data-img-idx="${i}" class="pdp-thumb w-16 h-14 border ${i === 0 ? 'border-brand-500' : 'border-gray-200'} rounded overflow-hidden bg-gray-100">
                                    <img src="${escapeHtml(img)}" alt="Thumbnail ${i + 1}" class="w-full h-full object-cover" />
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>

                <div class="md:col-span-6 space-y-4">
                    <div class="space-y-1">
                        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            ${escapeHtml(product.shopName)} · SKU: ${escapeHtml(product.sku)}
                        </p>
                        <h2 class="font-display text-2xl font-bold text-gray-950 leading-tight">${escapeHtml(product.title)}</h2>
                        <p class="text-xs text-gray-600 tabular-nums">
                            ★ ${Number(product.rating || 4.8).toFixed(1)} (${product.reviewCount || 12} Verified Reviews) · ${product.soldCount || 0} units sold
                        </p>
                    </div>

                    <div class="p-4 bg-gray-50 border border-gray-200 rounded space-y-1">
                        <div class="flex items-baseline gap-3">
                            <span class="font-display text-2xl font-extrabold text-brand-500 tabular-nums">${formatPkr(product.discountPrice)}</span>
                            ${product.discountPercentage > 0 ? `<span class="text-sm text-gray-400 line-through tabular-nums">${formatPkr(product.originalPrice)}</span>` : ''}
                        </div>
                        <p class="text-xs font-medium text-emerald-700">
                            Cash on Delivery Available · ${product.stock > 0 ? `${product.stock} units in stock` : 'Currently out of stock'}
                        </p>
                    </div>

                    <p class="text-sm text-gray-700 leading-relaxed">${escapeHtml(product.description)}</p>

                    ${product.variants?.length ? `
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Select Variant</p>
                            <div class="flex flex-wrap gap-2">
                                ${product.variants.map((v, idx) => `
                                    <button type="button" data-variant="${escapeHtml(v)}" class="pdp-variant-btn h-8 px-3 text-xs font-semibold rounded border ${idx === 0 ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}">
                                        ${escapeHtml(v)}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <div class="border border-gray-200 rounded p-3.5 space-y-2">
                        <div class="flex items-center justify-between gap-2">
                            <label for="pdp-city-est" class="text-xs font-semibold text-gray-600">COD Delivery Estimator</label>
                            <select id="pdp-city-est" class="h-8 px-2 border border-gray-300 rounded text-xs bg-white">
                                ${Object.keys(cityRates).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                            </select>
                        </div>
                        <p id="pdp-delivery-fee-note" class="text-xs text-gray-700 font-medium"></p>
                        <p class="text-[11px] text-gray-500">Warranty: ${escapeHtml(product.warranty || 'Official Brand Warranty')}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-3 pt-2">
                        <button id="pdp-add-cart-btn" type="button" ${product.stock <= 0 ? 'disabled' : ''} class="h-11 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded">
                            Add to Cart
                        </button>
                        <button id="pdp-buy-now-btn" type="button" ${product.stock <= 0 ? 'disabled' : ''} class="h-11 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded">
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
            if (product.discountPrice >= threshold) {
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

        // Zoom toggle
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
                    t.classList.toggle('border-gray-200', ti !== idx);
                });
            });
        });

        body.querySelectorAll('.pdp-variant-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.pdpSelectedVariant = btn.dataset.variant;
                body.querySelectorAll('.pdp-variant-btn').forEach((b) => {
                    const active = b === btn;
                    b.classList.toggle('border-brand-500', active);
                    b.classList.toggle('bg-brand-50', active);
                    b.classList.toggle('text-brand-700', active);
                    b.classList.toggle('border-gray-300', !active);
                });
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
                    <p class="text-sm font-medium text-gray-600">Your shopping cart is empty.</p>
                    <p class="text-xs text-gray-400">Browse electronics and tap "Add to Cart".</p>
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
                <div class="flex gap-3 border border-gray-200 rounded p-3 bg-white">
                    <img src="${escapeHtml(item.image || '/images/product_qled_tv.jpg')}" alt="${escapeHtml(item.title)}" class="w-16 h-16 object-cover rounded bg-gray-100 shrink-0" />
                    <div class="flex-1 min-w-0 space-y-1">
                        <p class="text-xs font-bold text-gray-900 line-clamp-2">${escapeHtml(item.title)}</p>
                        ${item.variant ? `<p class="text-[11px] text-gray-500">${escapeHtml(item.variant)}</p>` : ''}
                        <p class="text-xs font-bold text-brand-500 tabular-nums">${formatPkr(line)}</p>
                        <div class="flex items-center justify-between pt-1">
                            <div class="flex items-center border border-gray-300 rounded">
                                <button type="button" data-qty-idx="${idx}" data-delta="-1" class="cart-qty-btn w-6 h-6 text-xs font-bold hover:bg-gray-100">−</button>
                                <span class="px-2.5 text-xs font-semibold tabular-nums">${item.quantity}</span>
                                <button type="button" data-qty-idx="${idx}" data-delta="1" class="cart-qty-btn w-6 h-6 text-xs font-bold hover:bg-gray-100">+</button>
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
        const formContainer = document.getElementById('checkout-form-container');
        const successPanel = document.getElementById('checkout-success-panel');
        if (!listEl) return;

        if (state.cart.length === 0 && state.lastOrder && !successPanel.classList.contains('hidden')) {
            return;
        }

        formContainer.classList.remove('hidden');
        successPanel.classList.add('hidden');

        if (state.cart.length === 0) {
            listEl.innerHTML = '<p class="text-sm text-gray-500">Your cart is empty. Add an item before checking out.</p>';
            document.getElementById('co-subtotal').textContent = 'Rs. 0';
            document.getElementById('co-discount').textContent = '-Rs. 0';
            document.getElementById('co-shipping').textContent = 'Rs. 0';
            document.getElementById('co-grand-total').textContent = 'Rs. 0';
            return;
        }

        listEl.innerHTML = state.cart.map((item) => `
            <div class="flex items-center justify-between gap-3 text-xs border-b border-gray-100 pb-2.5">
                <div class="min-w-0">
                    <p class="font-semibold text-gray-900 truncate">${escapeHtml(item.title)}</p>
                    <p class="text-gray-500">${escapeHtml(item.variant || 'Standard')} × ${item.quantity}</p>
                </div>
                <span class="tabular-nums font-bold text-gray-900 shrink-0">${formatPkr(item.discountPrice * item.quantity)}</span>
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

    function resetFilters() {
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
        document.getElementById('filter-category').value = 'all';
        document.getElementById('filter-price-max').value = '300000';
        document.getElementById('filter-price-label').textContent = 'Any';
        document.getElementById('filter-discount').value = '';
        document.getElementById('filter-tag').value = '';
        document.getElementById('filter-instock').checked = false;
        document.getElementById('sort-products').value = 'newest';
        document.getElementById('global-search-input').value = '';
        document.getElementById('mobile-search-input').value = '';
        renderCategories();
        renderCatalog();
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
                box.innerHTML = '<div class="px-4 py-3 text-xs text-gray-500">No matching products found.</div>';
            } else {
                box.innerHTML = matches.map((p) => `
                    <button type="button" data-sug-id="${p.id}" class="sug-item w-full text-left px-3.5 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-3">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <img src="${escapeHtml(p.images?.[0] || '/images/product_qled_tv.jpg')}" alt="" class="w-9 h-9 rounded object-cover bg-gray-100 shrink-0" />
                            <div class="min-w-0">
                                <p class="text-xs font-semibold text-gray-900 truncate">${escapeHtml(p.title)}</p>
                                <p class="text-[11px] text-gray-500">${escapeHtml(p.sku)}</p>
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
        resultEl.innerHTML = '<p class="text-sm text-gray-500">Looking up order...</p>';

        try {
            const { order } = await request(`/api/orders/track/${encodeURIComponent(orderId.trim())}`);
            const statusColor =
                order.orderStatus === 'Confirmed' || order.orderStatus === 'Delivered'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : order.orderStatus === 'Cancelled'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';

            resultEl.innerHTML = `
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p class="font-mono text-lg font-bold text-gray-950">#${escapeHtml(order.orderId)}</p>
                        <p class="text-xs text-gray-500">Placed on ${escapeHtml(order.orderDate)} · ${escapeHtml(order.paymentMethod)}</p>
                    </div>
                    <span class="px-3 py-1 text-xs font-bold border rounded ${statusColor}">${escapeHtml(order.orderStatus)}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 border border-gray-200 rounded p-4 text-xs">
                    <div>
                        <p class="font-semibold text-gray-500 uppercase">Customer</p>
                        <p class="font-bold text-gray-900 mt-0.5">${escapeHtml(order.customerName)}</p>
                        <p class="font-mono text-gray-700">${escapeHtml(order.whatsappNumber)}</p>
                    </div>
                    <div>
                        <p class="font-semibold text-gray-500 uppercase">Shipping Destination</p>
                        <p class="font-bold text-gray-900 mt-0.5">${escapeHtml(order.shippingAddress)}, ${escapeHtml(order.city)}</p>
                        ${order.nearestLandmark ? `<p class="text-gray-600">Landmark: ${escapeHtml(order.nearestLandmark)}</p>` : ''}
                    </div>
                </div>
                <div class="space-y-2 text-sm">
                    ${(order.items || []).map((i) => `
                        <div class="flex justify-between border-b border-gray-100 pb-2">
                            <span>${escapeHtml(i.title)} × ${i.quantity}</span>
                            <span class="tabular-nums font-semibold">${formatPkr(i.lineTotal)}</span>
                        </div>
                    `).join('')}
                    <div class="flex justify-between font-bold text-base pt-2">
                        <span>Grand Total (COD)</span>
                        <span class="tabular-nums text-brand-500">${formatPkr(order.grandTotal)}</span>
                    </div>
                </div>
            `;
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

        document.getElementById('brand-home-btn')?.addEventListener('click', () => {
            resetFilters();
            switchView('store');
        });
        document.getElementById('back-to-store-btn')?.addEventListener('click', () => switchView('store'));
        document.getElementById('hero-shop-offers-btn')?.addEventListener('click', () => {
            document.getElementById('flash-deals-section')?.scrollIntoView({ behavior: 'smooth' });
        });
        document.getElementById('hero-track-order-btn')?.addEventListener('click', () => switchView('track'));
        document.getElementById('reset-category-btn')?.addEventListener('click', resetFilters);
        document.getElementById('clear-filters-btn')?.addEventListener('click', resetFilters);

        document.getElementById('wishlist-filter-btn')?.addEventListener('click', () => {
            state.wishlistOnly = !state.wishlistOnly;
            switchView('store');
            renderCatalog();
            document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth' });
        });

        // Cart drawer controls
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

        // COD Checkout Submission
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
            btn.textContent = 'Placing Order & Sending WhatsApp Receipt...';

            try {
                const res = await request('/api/orders/checkout', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                state.lastOrder = res.order;
                state.cart = [];
                saveCart();
                loadBootstrap().catch(() => {});

                document.getElementById('checkout-form-container').classList.add('hidden');
                document.getElementById('checkout-success-panel').classList.remove('hidden');
                document.getElementById('success-order-id').textContent = `#${res.order.orderId}`;
                document.getElementById('success-whatsapp-num').textContent = res.order.whatsappNumber;
                document.getElementById('success-receipt-preview').textContent = res.whatsapp.receiptText;
                document.getElementById('success-order-status').textContent = res.order.orderStatus;
                document.getElementById('sim-webhook-reply-banner').classList.add('hidden');
                showToast(`Order #${res.order.orderId} placed! WhatsApp receipt dispatched.`);
            } catch (err) {
                errEl.textContent = err.message;
                errEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Place COD Order & Send WhatsApp Confirmation';
            }
        });

        // Simulated Webhook Confirm / Cancel buttons on Checkout Receipt Preview
        const triggerOrderWebhookDecision = async (decision) => {
            if (!state.lastOrder) return;
            const buttonId = decision === 'Confirmed'
                ? `confirm_order_${state.lastOrder.orderId}`
                : `cancel_order_${state.lastOrder.orderId}`;
            try {
                const res = await request('/api/whatsapp/webhook', {
                    method: 'POST',
                    body: JSON.stringify({
                        buttonId,
                        from: state.lastOrder.whatsappDigits,
                        senderName: state.lastOrder.customerName
                    })
                });
                const updatedOrder = res.outcome?.order;
                if (updatedOrder) {
                    state.lastOrder = updatedOrder;
                    const statusBadge = document.getElementById('success-order-status');
                    statusBadge.textContent = updatedOrder.orderStatus;
                    statusBadge.className = updatedOrder.orderStatus === 'Confirmed'
                        ? 'px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded'
                        : 'px-3 py-1.5 text-xs font-bold bg-red-50 text-red-700 border border-red-200 rounded';
                }
                const banner = document.getElementById('sim-webhook-reply-banner');
                banner.textContent = res.outcome?.replyText || 'Status updated via WhatsApp webhook.';
                banner.classList.remove('hidden');
                showToast(`Order #${state.lastOrder.orderId} marked ${decision}`);
            } catch (err) {
                showToast(err.message, true);
            }
        };

        document.getElementById('sim-confirm-order-btn')?.addEventListener('click', () => triggerOrderWebhookDecision('Confirmed'));
        document.getElementById('sim-cancel-order-btn')?.addEventListener('click', () => triggerOrderWebhookDecision('Cancelled'));
        document.getElementById('success-continue-btn')?.addEventListener('click', () => switchView('store'));
        document.getElementById('success-track-btn')?.addEventListener('click', () => {
            switchView('track');
            if (state.lastOrder) {
                document.getElementById('track-order-input').value = state.lastOrder.orderId;
                lookupTrackingOrder(state.lastOrder.orderId);
            }
        });

        // Order Tracking Form
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

        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        if (tab === 'track' || tab === 'checkout') {
            switchView(tab);
        }

        // Silent background keep-alive ping to prevent bot & backend sleep
        setInterval(() => {
            fetch('/api/keepalive', { cache: 'no-store' }).catch(() => {});
        }, 20000);
    });
})();
