# Discord Spend Bot — Design

Date: 2026-10-18
Status: Draft, awaiting review

## Goal

Log daily expenses by typing a message in one channel of a private Discord server. Each valid message becomes one row in a Google Sheet.

## Requirements

- Single user, private Discord server.
- The bot reads messages from exactly one channel (`CHANNEL_ID`). It ignores every other channel, and it ignores messages from bots (including itself).
- Message format: `<item...> <price> <category>`, separated by spaces.
  - Example: `jajan kopi 25000 jajan` → item `jajan kopi`, price `25000`, category `jajan`.
- Parse rule:
  - Trim the message and split it on runs of whitespace.
  - At least 3 tokens are required.
  - The last token is the category.
  - The second-to-last token is the price and must match `^\d+$` (a plain whole number: no `k`, no dots, no commas).
  - All tokens before the price, joined with single spaces, are the item.
  - Anything else is invalid.
- Date: the Discord message's `createdAt`, converted to the `Asia/Jakarta` time zone and written as `YYYY-MM-DD` (e.g. `2026-10-25`).
- Sheet: one tab (name from `SHEET_TAB`). Columns are `Date | Price | Item | Category` (A:D). The user types the header row by hand. The bot only appends rows.

## Behaviour

| Case | Bot action |
|------|-----------|
| Valid message | Append `[date, price, item, category]`, then reply `✅ 2026-10-25 \| 25000 \| jajan kopi \| jajan` |
| Invalid message | Write nothing. Reply with the format hint: `Format: <item> <price> <category>, e.g. jajan kopi 25000 jajan` |
| Google Sheets error | Reply `❌ not saved: <error message>` and log the error to stdout |
| Other channel / bot author | Ignore silently |

Rows are appended with `valueInputOption: USER_ENTERED`, so Sheets stores the date as a real date and the price as a number. As a result, an item that starts with `=` would be read as a formula. That is acceptable, because only the owner writes to the sheet.

## Stack

- Node.js 20+ in ESM mode (`"type": "module"`).
- `discord.js` v14. Gateway intents: `Guilds`, `GuildMessages`, `MessageContent`. MessageContent is a privileged intent and must be enabled in the Discord Developer Portal.
- `@googleapis/sheets` (the official per-API package), using a Google service-account JSON key loaded via `GOOGLE_APPLICATION_CREDENTIALS`.
- No `dotenv`:
  - locally: `node --env-file=.env index.js`
  - in Docker: Compose `env_file`

## Files

| File | Responsibility |
|------|----------------|
| `parse.js` | `parseSpend(text)`: returns `{ item, price, category }` or `null`. `price` is a Number. `jakartaDate(date)`: returns `YYYY-MM-DD` in Asia/Jakarta. Both are pure functions. |
| `sheet.js` | `appendSpend(row)`: appends one row to `SHEET_TAB!A:D` of `SPREADSHEET_ID`. |
| `index.js` | Discord client: channel/bot filter, parse, append, reply. |
| `parse.test.js` | `node:test` unit tests. |
| `.env.example` | `DISCORD_TOKEN`, `CHANNEL_ID`, `SPREADSHEET_ID`, `SHEET_TAB`, `GOOGLE_APPLICATION_CREDENTIALS` |
| `Dockerfile` | `node:20-alpine`, `npm ci --omit=dev`, runs as the non-root `node` user, `CMD ["node", "index.js"]` |
| `compose.yml` | One service: `restart: unless-stopped`, `env_file: .env`, mounts `./credentials.json:/app/credentials.json:ro` |
| `.dockerignore`, `.gitignore` | Exclude `node_modules`, `.env` and `credentials.json` |
| `README.md` | Setup: Discord bot plus MessageContent intent, Google service account, sharing the sheet with the service-account email, header row, local run, VPS deploy |

## Deployment

The bot runs on the owner's VPS with Docker Compose v2:

```
docker compose up -d --build
docker compose logs -f
```

It only needs outbound HTTPS and opens no ports. Secrets (`.env`, `credentials.json`) live on the VPS only. They are never baked into the image and never committed.

## Testing

- Unit tests (`node --test`):
  - Parser:
    - the multi-word item example
    - the minimal 3-token message
    - extra whitespace
    - a non-numeric price (`25k`, `25.000`) → `null`
    - fewer than 3 tokens → `null`
    - an empty message → `null`
  - Date:
    - `2026-10-24T23:30:00Z` → `2026-10-25` (Jakarta is UTC+7)
    - `2026-10-25T10:00:00Z` → `2026-10-25`
- Manual end-to-end check:
  1. Post `jajan kopi 25000 jajan` in the channel and confirm the reply and the new sheet row.
  2. Post `hello` and confirm the format-hint reply and that no row was added.

## Out of scope

Slash commands, editing or deleting entries, totals or reports inside the bot, multiple users or sheets, and currency shortcuts (`25k`, `25.000`).
