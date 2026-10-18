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

## 1. Discord

1. Create an application at <https://discord.com/developers/applications>, then go to **Bot** and click **Reset Token**. Copy the token into `DISCORD_TOKEN`.
2. On the same page, turn on **Message Content Intent**. Without it the bot sees empty messages and stays silent.
3. Go to **OAuth2 → URL Generator** and choose:
   - scope: `bot`
   - permissions: *View Channel*, *Send Messages*, *Read Message History*

   Open the generated URL and add the bot to your server.
4. In Discord, go to **Settings → Advanced** and turn on **Developer Mode**. Then right-click the channel, choose **Copy Channel ID**, and paste it into `CHANNEL_ID`.

## 2. Google Sheets

1. In <https://console.cloud.google.com>, create or pick a project and enable the **Google Sheets API**.
2. Go to **IAM & Admin → Service Accounts** and create a service account. Open **Keys → Add key → JSON**, and save the downloaded key as `credentials.json` in this folder.
3. Open your sheet and **Share** it with the service account's email (`…@….iam.gserviceaccount.com`) as **Editor**.
4. Type the header row: `Date | Price | Item | Category`.
5. Copy the spreadsheet ID from the URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`) into `SPREADSHEET_ID`. Put the tab name (e.g. `Sheet1`) into `SHEET_TAB`.

## 3. Run locally

Requires Node 20.6 or newer.

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
chmod 644 credentials.json      # the container runs as a non-root user and must be able to read it
docker compose up -d --build
docker compose logs -f          # expect "Logged in as …"
```

The bot restarts automatically after a crash or a reboot. It opens no ports and only needs outbound HTTPS.

To update the bot later, pull the latest code and run `docker compose up -d --build` again.
