# Al-Mumtaz Electronics — 24/7 Railway WhatsApp Bot Backend

Standalone Node.js + `@whiskeysockets/baileys` WhatsApp automation service for **Al-Mumtaz Electronics (Hasilpur — `03299931199`)**.

---

## Included Bot Features
- **Interactive Welcome Menu & Store List**: Triggers on greetings (*Hi, Hello, Salam, Assalamualaikum, Menu, Shop*) with Quick Reply buttons, `🌐 Visit Online Store` CTA URL, and an expandable **📋 Open Store Menu** list (`single_select`).
- **Live Website Categories & Product Cards**: Fetches live data from `${SITE_API_URL}/categories`, `${SITE_API_URL}/products`, and `${SITE_API_URL}/products/search?q=`. Sends product cards with images and `🛒 Order Now (COD)`, `💳 Pay Online`, `🔍 Search Another Item`, and `🌐 View on Website` buttons.
- **Native WhatsApp Catalog + In-Chat COD Checkout**: Converts catalog shares or `buy_<id>` taps into 2-step COD orders posted directly to `POST ${SITE_API_URL}/orders`.
- **Two-Way COD Order Confirmation**: Customers can tap `✅ Confirm Order`, `💳 Pay Now`, or `❌ Cancel Order` on WhatsApp; updates order status via `PATCH ${SITE_API_URL}/orders/:orderId/status`, alerts Admin, and sends Thank You + live tracking link + shopping prompt.
- **Order Tracking**: Accepts `ORD-2026-9336` or 4-digit `9336` anytime via `GET ${SITE_API_URL}/orders/:orderId`.
- **Extra Store Info Features**:
  - `🏪 Showroom & Timings` (`Main Railway Road, Hasilpur`, helpline, working hours)
  - `🛡️ Warranty & Delivery` (official brand warranty + city-wise COD rates)
  - `☀️ Solar Load Guide` (3kW / 6kW / 10kW hybrid inverter guide + direct Solar Inverters catalog link)
- **Contact For Inquiry**: Collects customer details and forwards them to `ADMIN_NUMBER` / `Admin_Whatsapp` and syncs to website `/admin`.
- **24/7 Auto-Ping Heartbeat**: Keeps Railway & main site awake (`GET /api/keepalive` & `GET /api/health`).

---

## How to Configure `STORE_URL`, `SITE_API_URL`, and `API_SECRET_KEY`

1. **`STORE_URL`**
   - Set to your **published AI Studio Shared App URL** without a trailing slash:
     ```
     STORE_URL=https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app
     ```
   - Used for clickable website links, `${STORE_URL}/track/ORD-...` tracking links, checkout links, and fetching relative `/images/...` / `/api/media/...` product photos.

2. **`SITE_API_URL`**
   - Set to your `STORE_URL` followed by `/api` (no trailing slash):
     ```
     SITE_API_URL=https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app/api
     ```
   - Used by the Railway bot for all live catalog, search, tracking, and order status API calls.

3. **`API_SECRET_KEY`**
   - Choose any strong secret string (24+ random characters) and set the **exact same value** in both **Railway Variables** and **AI Studio Environment Variables**:
     ```
     API_SECRET_KEY=your_identical_secret_token_here
     ```
   - Sent in `x-api-secret` / `Authorization: Bearer ...` headers so only your verified Railway bot and website can trigger order creation, status updates, and webhooks.

---

## Railway Deployment Steps

1. **Create Service**: In Railway, deploy from your GitHub repo and set **Settings → Service → Root Directory** to `Railway`.
2. **Attach Persistent Volume**: Mount at `/app/data` so paired WhatsApp credentials (`creds.json`) persist across restarts.
3. **Add Railway Variables**:
   - `PORT=3000`
   - `IS_RAILWAY_BACKEND=true`
   - `RAILWAY_VOLUME_MOUNT_PATH=/app/data`
   - `STORE_URL=https://<your-published-ai-studio-url>`
   - `SITE_API_URL=https://<your-published-ai-studio-url>/api`
   - `API_SECRET_KEY=<same-secret-as-ai-studio>`
   - `ADMIN_NUMBER=923299931199@s.whatsapp.net`
   - `Admin_Whatsapp=923299931199`
   - `Admin_Username=<same-as-ai-studio>`
   - `Admin_Password=<same-as-ai-studio>`
   - `STORE_PAYMENT_INFO=EasyPaisa / JazzCash: 0329-9931199 (Al-Mumtaz Electronics Hasilpur)`
   - `Cloudinary_URI=<optional>`
4. **Generate Domain & Connect**: Copy Railway's public HTTPS URL (`https://....up.railway.app`) into `Railway_URL` on AI Studio (`/admin` → **Settings & Vars** or AI Studio env vars), then pair your WhatsApp number under **Link WhatsApp**.
