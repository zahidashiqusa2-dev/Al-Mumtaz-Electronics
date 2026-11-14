# Al-Mumtaz Electronics — Hasilpur

Full-Stack E-Commerce Storefront & Automated WhatsApp Cash on Delivery (COD) Verification System built for **Al-Mumtaz Electronics (Hasilpur, 03299931199)**.

## Architecture
- **Frontend**: Responsive Daraz-style Storefront, Live Search & Filtering, Flash Deals Countdown, Product Detail Modal, Slide-Over Cart Drawer, COD Checkout with `+923XXXXXXXXX` / `03XXXXXXXXX` validation, Order Tracking, and Admin Management Panel.
- **Backend**: Node.js + Express (`server.js`) with built-in SQLite persistence (`node:sqlite`), server-authoritative COD totals, and Railway Volume support.
- **WhatsApp Automation (`lib/whatsappService.js`)**:
  - Supports both **Baileys** (8-digit pairing code directly in Admin Panel) and **Meta WhatsApp Cloud API** (configurable via Variables).
  - **5-Button Store Menu** on any incoming customer message:
    1. `Items Categories`
    2. `Offered Items`
    3. `Featured Items`
    4. `Browse Online Store`
    5. `Contact For Inquiry` (collects customer details & topic description and forwards directly to `ADMIN_WHATSAPP_NUMBER`)
  - **Automated COD Order Receipt**: Dispatches itemized receipt with `✅ Confirm Order` and `❌ Cancel Order` interactive buttons to the customer's WhatsApp and updates order status in real time upon reply.

## Railway Deployment Guide
1. Push repository to GitHub and create a new Railway project (`Deploy from GitHub repo`).
2. Attach a persistent Railway Volume mounted at `/app/data` and set `RAILWAY_VOLUME_MOUNT_PATH=/app/data`.
3. Set optional environment variables (`ADMIN_WHATSAPP_NUMBER=923299931199`, `WHATSAPP_PROVIDER=baileys` or `meta_cloud`, `APP_URL=https://your-app.up.railway.app`).
4. Railway uses `railway.json` / `Procfile` (`node server.js`) and verifies health at `/api/health`.
5. For **Baileys**, open the Admin Panel -> **WhatsApp & Variables** -> enter your WhatsApp number to pair with an 8-digit code.
6. For **Meta Cloud API**, set `WHATSAPP_PROVIDER=meta_cloud`, add your Phone Number ID & Access Token in Admin Variables, and configure Meta Webhook URL to `https://your-app.up.railway.app/api/whatsapp/webhook` with your Verify Token.

## Local Scripts
- `npm start` — Run production server (`0.0.0.0:3000`)
- `npm test` — Run unit tests (`node --test lib/storeLogic.test.js`)
- `npm run lint` — Syntax check server & library modules
