# budums

A Discord bot that logs daily spending to Google Sheets from text messages or receipt images.

```
jajan kopi 25000 jajan   →   2026-10-25 | 25000 | jajan kopi | jajan
/receipt [image]         →   2026-10-25 | 24000 | Kopi Kenangan | jajan
```

## Features

- **Receipt Image Scanning (`/receipt`):** Upload an image receipt. The bot uses Gemini to extract items, qty, and prices, and appends rows to your Google Sheet (`TGL | Kode_Barcode | Nama_Barang | Qty | Harga_Satuan | Total_Harga`).
- **Daily Receipt Scanning (`/receipt-daily`):** Upload an image receipt. The bot extracts items, categories, and totals, and appends rows in a daily expense layout (`Tanggal | Keterangan | Kategori | Jumlah Uang`).
- **Remember Sheet Per Channel (`/set-sheet`):** Use the bot across multiple channels. Each channel remembers its own Google Sheet so you don't need to re-enter links each time.
- **Text Logging:** Post a quick message in any configured channel:
  - Last word: category
  - Number before it: price (digits only)
  - Everything before: item

The date is recorded in `Asia/Jakarta` time (UTC+7).

---

## Slash Commands

| Command | Description |
|---|---|
| `/receipt image:<file> [sheet_name:<name>] [category:<tag>] [item:<name>]` | Scan a receipt photo and append it to Google Sheet (`TGL \| Kode_Barcode \| Nama_Barang \| Qty \| Harga_Satuan \| Total_Harga`). |
| `/receipt-daily image:<file> [sheet_name:<name>] [category:<tag>] [item:<name>]` | Scan a receipt photo and append it to Google Sheet in daily format (`Tanggal \| Keterangan \| Kategori \| Jumlah Uang`). |
| `/set-sheet [sheet_name:<name>] [url:<URL or ID>]` | Link which sheet/tab name and Google Sheet to use for this channel. |
| `/current-sheet` | View which Google Sheet and sheet name are linked to this channel. |

---

### Receipts: `/struck`

In the receipt channel, type `/struck` and attach a photo of a shopping receipt (jpg, png or webp, up to 5 MB). A vision model on OpenRouter reads every line item, and the bot appends one row per item to a second sheet:

```
Date       | Barcode       | Item name     | Qty | Price
2026-10-18 | 8998866200301 | INDOMIE GRG   | 5   | 3100
2026-10-18 |               | DISKON MEMBER | 1   | -2000
```

- Price is the **unit** price. Each discount gets its own row with a negative price.
- The date is the one printed on the receipt. If it can't be read, the bot uses the day you posted.

The bot replies with the items it saved. It adds `⚠️ items sum …, receipt total …` when the items don't add up to the printed total. If that happens, check the rows and fix them in the sheet.

## 1. Discord

1. Create an application at <https://discord.com/developers/applications>, then go to **Bot** and click **Reset Token**. Copy the token into `DISCORD_TOKEN`.
2. On the same page, turn on **Message Content Intent**.
3. Go to **OAuth2 → URL Generator** and choose:
   - scopes: `bot`, `applications.commands`
   - permissions: *View Channel*, *Send Messages*, *Read Message History*

   Open the generated URL and invite the bot to your server.

## 2. Gemini API (Free Tier)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Click **Create API key** (in a new project without billing attached).
3. Copy the key into `GEMINI_API_KEY` in `.env`.

## 3. Google Sheets

1. In <https://console.cloud.google.com>, create or pick a project and enable the **Google Sheets API**.
2. Go to **IAM & Admin → Service Accounts** and create a service account. Open **Keys → Add key → JSON**, and save the downloaded key as `credentials.json` in this folder.
3. Open your Google Sheet and **Share** it with the service account email (`…@….iam.gserviceaccount.com`) as **Editor**.
4. Type the header row: `TGL | Kode_Barcode | Nama_Barang | Qty | Harga_Satuan | Total_Harga`.

## 4. Run locally

Requires Node 22 or newer.

```sh
cp .env.example .env   # fill in DISCORD_TOKEN, GEMINI_API_KEY, credentials.json
npm install
npm test
npm start
```

Once running, type `/set-sheet` in any Discord channel with your Google Sheet URL to link it.

## 5. Run on VPS (Docker Compose v2)

1. Copy the repo to the VPS.
2. Put `.env` and `credentials.json` next to `compose.yml`. Neither file is in git or in the image.
3. Run:

```sh
mkdir -p data && sudo chown -R 1000:1000 data credentials.json && sudo chmod 600 credentials.json
docker compose up -d --build
docker compose logs -f
```

Channel mappings are saved to `./data/channels.json` which is mounted as a persistent volume.
