# Al-Mumtaz Electronics — Hasilpur (Storefront + 24/7 Railway WhatsApp Bot)

Complete E-Commerce Storefront, Protected Admin Dashboard (`/admin`), and 24/7 `@whiskeysockets/baileys` WhatsApp Shopping & Two-Way COD Confirmation System for **Al-Mumtaz Electronics (Main Railway Road, Hasilpur — `03299931199`)**.

---

## 1. Key Features

### Online Storefront (`/`) & Order Tracker (`/track/:orderId`)
- Category browsing, live product search, flash-sale countdown, multi-variant pricing, slide-over shopping bag drawer, and COD checkout with Pakistan mobile validation (`03XXXXXXXXX` / `+923XXXXXXXXX`).
- Animated order confirmation modal with 1-click **Copy Order ID** button (`ORD-2026-XXXX` and 4-digit quick code `XXXX`).
- `/admin` is completely isolated from storefront links (accessible directly at `https://<your-site>/admin`).

### Protected Admin Console (`/admin`)
- Secured by `Admin_Username` & `Admin_Password`.
- **Orders**: 3-column order manager with status/category/price/search filters, CSV export, right-hand Order Inspector, and Confirm/Reject/Dispatch/Delivered status updates.
- **Dashboard & Analytics**: KPI metrics, category breakdown (`By Categories`), Confirmed / Dispatched / Delivered funnels, and `Navigation (24)` quick-jump drawer.
- **Products**: Full CRUD, multiple image uploads (Cloudinary or SQLite fallback), and per-variant pricing.
- **Link WhatsApp & Interactive Bot Simulator**: 8-digit pairing code setup + live WhatsApp Bot flow tester under **Notification & Bot**.

### WhatsApp Bot Automation (Root & `/Railway`)
- **Welcome Interactive Menu** (triggers on greetings like *Hi, Hello, Salam, Assalamualaikum, Menu, Shop*):
  - Expandable **📋 Store Menu** interactive list + Quick Reply & Store URL buttons:
    - `🛍️ Browse Categories` (live `single_select` list from `GET ${SITE_API_URL}/categories`)
    - `🔍 Search Products` (live query against `GET ${SITE_API_URL}/products/search?q=`)
    - `📦 Track My Order` (accepts `ORD-2026-9336` or 4-digit `9336`)
    - `💳 Pay Now` (EasyPaisa / JazzCash / COD details + website checkout link)
    - `🔥 Offered Items` & `⭐ Featured Electronics`
    - `🏪 Showroom & Timings` (Hasilpur address, `03299931199` helpline, working hours)
    - `🛡️ Warranty & Delivery` (Brand warranty cards, 7-day replacement guarantee, city-wise COD shipping rates)
    - `☀️ Solar Load Guide` (3kW / 6kW / 10kW hybrid inverter sizing & quick link to Solar Inverters)
    - `📝 Contact For Inquiry` (collects customer details & topic and forwards to `ADMIN_NUMBER` / `Admin_Whatsapp`)
- **Product Cards with Media**: Shows product image, title, discount, stock, variants, `🛒 Order Now (COD)`, `💳 Pay Online`, `🔍 Search Another Item`, and `🌐 View on Website`.
- **Two-Way Website COD Confirmation**: Sends itemized receipt with `✅ Confirm Order`, `💳 Pay Now`, and `❌ Cancel Order`. Tapping **Confirm** updates the order on the website (`PATCH ${SITE_API_URL}/orders/:id/status`), alerts Admin, and replies with a **Thank You + Live Tracking Link + Shopping Menu**.
- *(Strictly excludes `.menu`, `.ping`, song downloaders, and any Admin Direct button.)*

---

## 2. How to Configure `STORE_URL`, `SITE_API_URL`, and `API_SECRET_KEY`

These three variables link your **24/7 Railway WhatsApp Bot** with your **AI Studio Website** so both share live products, search, orders, and confirmations securely:

| Variable | Exact Format Example | What It Does & How to Get It |
| :--- | :--- | :--- |
| **`STORE_URL`** | `https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app` | **Your public website URL** (from AI Studio **Share / Publish** button — do **not** add a trailing `/` or `/api`). Used by the WhatsApp bot for `Visit Online Store` buttons, product/checkout links, `${STORE_URL}/track/ORD-...` tracking links, and resolving `/images/...` or `/api/media/...` product photos. *(Note: Use your **Shared / Published App URL**, not the temporary `ais-dev-...` preview URL, so customers can always open the links.)* |
| **`SITE_API_URL`** | `https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app/api` | **Your website's REST API base URL** (`${STORE_URL}/api`, no trailing `/`). The Railway bot calls `${SITE_API_URL}/categories`, `${SITE_API_URL}/products`, `${SITE_API_URL}/products/search`, `${SITE_API_URL}/orders`, and `${SITE_API_URL}/orders/:id/status` in real time. |
| **`API_SECRET_KEY`** | `AlMumtaz_Key_923299931199_Secret` | **Your shared authentication token** (any strong random 24+ character string you invent). **Must be 100% identical** in both AI Studio and Railway. It protects `POST /api/orders`, `PATCH /api/orders/:id/status`, `POST /webhook/new-website-order`, `POST /api/bridge/send`, and `POST /api/bridge/inquiry` via `x-api-secret` / `Bearer` headers. |

> **Tip:** Generate a strong `API_SECRET_KEY` locally or online (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`), then copy-paste that exact same string into both AI Studio and Railway.

---

## 3. Environment Variables Reference

### A. Set These in **AI Studio** (Main Website & Admin)

| Variable | Required | Example Value | Purpose |
| :--- | :---: | :--- | :--- |
| `Admin_Username` | **Yes** | `admin` | Username to log into `/admin` |
| `Admin_Password` | **Yes** | `YourStrongPass#2026` | Password to log into `/admin` |
| `Admin_Whatsapp` | **Yes** | `923299931199` | Store owner WhatsApp digits (receives customer inquiries & confirmed order alerts) |
| `Railway_URL` | **Yes** | `https://your-bot.up.railway.app` | Public HTTPS URL of your Railway service (get this after deploying Railway below) |
| `API_SECRET_KEY` | **Yes** | `same-secret-as-railway` | Shared secret token matching Railway |
| `STORE_URL` | **Yes** | `https://ais-pre-...run.app` | Public storefront URL (no trailing slash) |
| `SITE_API_URL` | Rec. | `https://ais-pre-...run.app/api` | Public REST API base URL |
| `Cloudinary_URI` | Opt. | `cloudinary://key:secret@cloud` | Cloud CDN for product photos (falls back to SQLite if empty) |
| `STORE_PAYMENT_INFO` | Opt. | `EasyPaisa / JazzCash: 0329-9931199 ...` | Payment text displayed in WhatsApp `Pay Now` messages |

*(Also manageable anytime inside `/admin` → **Settings & Vars**.)*

### B. Set These in **Railway** (24/7 WhatsApp Bot Service)

| Variable | Required | Example Value | Purpose |
| :--- | :---: | :--- | :--- |
| `STORE_URL` | **Yes** | `https://ais-pre-...run.app` | Public storefront link for buttons, tracking links & product images |
| `SITE_API_URL` | **Yes** | `https://ais-pre-...run.app/api` | Live API base URL (`${STORE_URL}/api`) |
| `API_SECRET_KEY` | **Yes** | `same-secret-as-ai-studio` | Shared secret matching AI Studio `API_SECRET_KEY` |
| `ADMIN_NUMBER` | **Yes** | `923299931199@s.whatsapp.net` | Owner WhatsApp JID for alerts & inquiry forwarding |
| `Admin_Whatsapp` | **Yes** | `923299931199` | Numeric fallback for owner WhatsApp |
| `Admin_Username` | **Yes** | `admin` | Must match AI Studio `Admin_Username` for bridge auth |
| `Admin_Password` | **Yes** | `YourStrongPass#2026` | Must match AI Studio `Admin_Password` for bridge auth |
| `RAILWAY_VOLUME_MOUNT_PATH` | **Yes** | `/app/data` | Matches Railway Volume mount path so WhatsApp sessions never log out on redeploy |
| `IS_RAILWAY_BACKEND` | **Yes** | `true` | Enables standalone Railway bot mode |
| `PORT` | **Yes** | `3000` | Port listened by `Railway/server.js` |
| `STORE_PAYMENT_INFO` | Opt. | `EasyPaisa / JazzCash: 0329-9931199 ...` | Payment details shown on `💳 Pay Now` |

---

## 4. Complete Setup Guide (AI Studio + Railway)

### Step 1: Publish / Get Your AI Studio Public URL
1. In AI Studio, click **Publish / Share** (or **Deploy**) so your app gets a public URL such as:
   `https://ais-pre-hiuyw6voetxjeqvop7f4jn-955644874863.asia-east1.run.app`
2. Add the AI Studio variables from Section **3A** (you can add `Railway_URL` after Step 2).

### Step 2: Deploy the `Railway/` Folder on Railway.app
1. Create a new project in **Railway** → **Deploy from GitHub repo** and select this repository.
2. Open **Settings → Service → Root Directory** and set it strictly to:
   ```
   Railway
   ```
3. Attach a **Persistent Volume**:
   - Click **+ Add Volume** → Mount Path: `/app/data`
   - Ensures your WhatsApp `creds.json` + encryption keys survive restarts and new deployments.
4. Open **Variables** in Railway and add all variables from Section **3B** (`STORE_URL`, `SITE_API_URL`, `API_SECRET_KEY`, `ADMIN_NUMBER`, `Admin_Whatsapp`, `Admin_Username`, `Admin_Password`, `RAILWAY_VOLUME_MOUNT_PATH=/app/data`, `IS_RAILWAY_BACKEND=true`, `PORT=3000`).
5. Open **Settings → Networking → Generate Domain** to get your Railway HTTPS URL (e.g. `https://almumtaz-wa-bot-production.up.railway.app`).
6. Verify Railway health by opening `https://<your-railway-domain>/api/health` — confirm `"status": "ok"`, `"siteApiConfigured": true`, and `"apiSecretConfigured": true`.

### Step 3: Connect Railway Back to AI Studio & Link WhatsApp
1. Paste your Railway domain into `Railway_URL` (no trailing `/`) in AI Studio environment variables (or inside `https://<your-site>/admin` → **Settings & Vars** → **Save Variables**).
2. Open `https://<your-site>/admin` and log in using `Admin_Username` & `Admin_Password`.
3. Open **Link WhatsApp** → click **Test Railway Connection** to confirm both servers talk cleanly.
4. Enter your store WhatsApp number (e.g. `03299931199` or `923299931199`) and click **Generate Pairing Code**.
5. On your phone: **WhatsApp → Linked Devices → Link a Device → Link with phone number instead** → enter the 8-digit code.
6. Test from another WhatsApp number:
   - Send `"Assalam o Alaikum"` → receives interactive Store Menu + quick buttons.
   - Tap `🛍️ Browse Categories` or `🔍 Search Products` → receives live product cards with `Order Now (COD)` and `Pay Online`.
   - Place a test COD order on the website → verify WhatsApp receipt arrives with `✅ Confirm Order` / `💳 Pay Now` / `❌ Cancel Order`, and clicking Confirm updates the order in `/admin` and replies with the tracking link.

---

## 5. Local Development & Verification Commands
- `npm start` — Run main website + local bot server on `http://localhost:3000`
- `npm test` — Run unit tests (`node --test lib/storeLogic.test.js`)
- `npm run lint` — Syntax-check all server, bot, storefront, admin, and `Railway/` modules
