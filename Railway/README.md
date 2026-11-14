# Al-Mumtaz Electronics — 24/7 Railway WhatsApp Bot Backend

This folder is a complete, standalone Node.js + Baileys WhatsApp backend designed to run 24/7 on **Railway.app** so your WhatsApp bot stays online continuously and handles:

- **5-Button Store Customer Menu** (`Items Categories`, `Offered Items`, `Featured Items`, `Browse Online Store`, `Contact For Inquiry`)
- **Automated COD Order Receipts** with `Confirm Order` / `Cancel Order` buttons triggered by the main storefront
- **Customer Inquiry Forwarding** directly to `Admin_Whatsapp`
- **Hidden 20-second Keep-Alive Heartbeat** to prevent idle sleep
- **Live Sync** with your main storefront via `MAIN_SITE_URL`

---

## Step-by-Step Railway Deployment

1. **Create a Railway Project** from your GitHub repository.
2. Open **Settings → Service → Root Directory** and set it to:
   ```
   Railway
   ```
3. **Attach a Persistent Volume** in Railway:
   - Mount Path: `/app/data`
   - Ensures WhatsApp pairing credentials (`creds.json` + signal keys) survive restarts and redeployments.
4. **Set Environment Variables** in Railway:
   - `Admin_Username` — Same username as your main site `/admin`
   - `Admin_Password` — Same password as your main site `/admin`
   - `Admin_Whatsapp` — Store admin WhatsApp number with country code (e.g. `923299931199`)
   - `MAIN_SITE_URL` — Public HTTPS URL of your main Al-Mumtaz Electronics website (e.g. `https://almumtaz-store.example.com`)
   - `Cloudinary_URI` — Optional Cloudinary connection URI (`cloudinary://api_key:api_secret@cloud_name`)
   - `RAILWAY_VOLUME_MOUNT_PATH` — `/app/data`
5. **Generate a Public Domain** in Railway **Settings → Networking** (e.g. `https://almumtaz-wa-bot.up.railway.app`).
6. **Connect to Main Website**:
   - Open `https://<your-main-site>/admin`
   - Go to **Variables & Cloud Setup**, paste the Railway domain into **`Railway_URL`**, click **Save Variables**, and click **Test Railway Connection**.
   - Go to **Link WhatsApp**, enter your store WhatsApp number, and link using the 8-digit pairing code.
