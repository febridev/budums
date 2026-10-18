# budums

A Discord bot that logs daily spending to a Google Sheet. Post a message in one channel and the bot appends a row.

```
jajan kopi 25000 jajan   →   2026-10-25 | 25000 | jajan kopi | jajan
```

**How a message is read:**
- The **last word** is the category.
- The **plain number before it** is the price. Only digits are allowed: no `k`, dots or commas.
- **Everything before the price** is the item.

The date is the day you posted, in Asia/Jakarta time. The bot replies `✅ …` when the row is saved, shows the format when it can't read the message, and replies `❌ not saved: …` when Google rejects the write.

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
2. On the same page, turn on **Message Content Intent**. Without it the bot fails to log in with `Used disallowed intents` and keeps restarting.
3. Go to **OAuth2 → URL Generator** and choose:
   - scopes: `bot` and `applications.commands` (the second one is needed for `/struck`)
   - permissions: *View Channel*, *Send Messages*, *Read Message History*

   Open the generated URL and add the bot to your server. If the bot was added before `/struck` existed, open the new URL once more to grant the extra scope.
4. In Discord, go to **Settings → Advanced** and turn on **Developer Mode**. Then right-click the spending channel, choose **Copy Channel ID**, and paste it into `CHANNEL_ID`. Do the same for the receipt channel and paste its ID into `RECEIPT_CHANNEL_ID`.

## 2. Google Sheets

1. In <https://console.cloud.google.com>, create or pick a project and enable the **Google Sheets API**.
2. Go to **IAM & Admin → Service Accounts** and create a service account. Open **Keys → Add key → JSON**, and save the downloaded key as `credentials.json` in this folder.
3. Open your sheet and **Share** it with the service account's email (`…@….iam.gserviceaccount.com`) as **Editor**.
4. Type the header row: `Date | Price | Item | Category`.
5. Copy the spreadsheet ID from the URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`) into `SPREADSHEET_ID`. Put the tab name (e.g. `Sheet1`) into `SHEET_TAB`.
6. For receipts, create a second spreadsheet and share it with the same service account as **Editor**. Type the header row `Date | Barcode | Item name | Qty | Price`. Put its ID into `RECEIPT_SPREADSHEET_ID` and its tab name into `RECEIPT_SHEET_TAB`.

## 2b. OpenRouter (receipt reading)

1. Create an API key at <https://openrouter.ai/keys>, add a little credit, and put the key into `OPENROUTER_API_KEY`.
2. `OPENROUTER_MODEL` picks the vision model. The default, `anthropic/claude-haiku-5.5`, costs well under Rp 50 per receipt. To try another model, e.g. `google/gemini-3.1-flash-lite`, change the value and restart the bot.

## 3. Run locally

Requires Node 22 or newer.

```sh
cp .env.example .env   # then fill it in
npm install
npm test
npm start
```

## 4. Run on the VPS (Docker Compose v2)

1. Copy the repo to the VPS.
2. Put `.env` and `credentials.json` next to `compose.yml`. Neither file is in git or in the image.
3. Run:

```sh
sudo chown 1000:1000 credentials.json && sudo chmod 600 credentials.json   # readable only by the container's node user (uid 1000)
docker compose up -d --build
docker compose logs -f          # expect "Logged in as …"
```

The bot restarts automatically after a crash or a reboot. It opens no ports and only needs outbound HTTPS.

To update the bot later, pull the latest code and run `docker compose up -d --build` again.
