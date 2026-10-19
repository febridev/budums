# /struck Receipt Logging — Design

Date: 2026-10-18
Status: Draft, awaiting review

## Goal

In one dedicated Discord channel, run `/struck` with a photo of a shopping receipt. The bot reads every line item with a vision model and appends them to a second Google Sheet, giving item-level records of purchases.

## Requirements

- Slash command `/struck` with one required attachment option, `image`.
- The command works only in `RECEIPT_CHANNEL_ID`. Anywhere else the bot replies ephemerally: `Use /struck in <#RECEIPT_CHANNEL_ID>`.
- One image per command. Accepted types: `image/jpeg`, `image/png`, `image/webp`. Maximum size: 5 MB.
- The receipt is read through OpenRouter (`https://openrouter.ai/api/v1/chat/completions`). The model comes from `OPENROUTER_MODEL`, default `anthropic/claude-haiku-5.5`.
- Receipt sheet: a different spreadsheet (`RECEIPT_SPREADSHEET_ID`, tab `RECEIPT_SHEET_TAB`). Columns `Date | Barcode | Item name | Qty | Price` (A:E). The user types the header row by hand. The bot only appends rows.
  - **Date**: the date printed on the receipt (`YYYY-MM-DD`). If the model returns null or anything that is not a valid `YYYY-MM-DD` date, use `jakartaDate(createdAt)` of the interaction.
  - **Barcode**: as printed, or empty when the receipt has none. Written as `'<barcode>` so Sheets stores it as text (no `8.99887E+12`, no lost leading zeros).
  - **Item name**: as printed.
  - **Qty**: a number greater than 0. Fractions are allowed (weighed goods, e.g. `0.75`).
  - **Price**: the **unit** price, an integer in rupiah. Discounts are their own row with a negative price and qty 1.
- All rows of one receipt are written in a single `values.append` call (`USER_ENTERED`), so a receipt is saved fully or not at all.
- Rows are saved immediately. There is no confirm step and no duplicate check.
- The spend-logging flow (`MessageCreate` in `CHANNEL_ID`) is unchanged. Receipt items are not added to the spend sheet.

## Model request

`readReceipt(url, contentType)` downloads the Discord attachment, encodes it as a `data:<contentType>;base64,…` URL, and posts:

```json
{
  "model": "<OPENROUTER_MODEL>",
  "messages": [{ "role": "user", "content": [
    { "type": "text", "text": "<PROMPT>" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }
  ]}],
  "response_format": { "type": "json_schema", "json_schema": { "name": "receipt", "strict": true, "schema": "<SCHEMA>" } },
  "provider": { "require_parameters": true }
}
```

`provider.require_parameters` makes OpenRouter route only to providers that support structured outputs.

The schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["date", "total", "items"],
  "properties": {
    "date": { "type": ["string", "null"] },
    "total": { "type": ["integer", "null"] },
    "items": { "type": "array", "items": {
      "type": "object",
      "additionalProperties": false,
      "required": ["barcode", "name", "qty", "price"],
      "properties": {
        "barcode": { "type": ["string", "null"] },
        "name": { "type": "string" },
        "qty": { "type": "number" },
        "price": { "type": "integer" }
      }
    }}
  }
}
```

The prompt tells the model to:
- return one entry per purchased line, with `price` as the **unit** price;
- put each discount on its own entry with `qty` 1 and a negative `price`;
- leave out subtotal, tax, payment, change and loyalty-point lines;
- set `barcode` to the printed barcode/PLU or null;
- set `date` as `YYYY-MM-DD` or null; and
- set `total` to the final amount paid or null.

The image is sent as base64 rather than a Discord CDN URL, so reading does not depend on the provider fetching Discord's signed links.

`readReceipt` throws on download failure, timeout (60 s via `AbortSignal.timeout`) or a non-2xx OpenRouter response (`OpenRouter <status>: <error.message>`). It returns `JSON.parse(choices[0].message.content)`, or `null` when that content is missing or is not valid JSON.

## Behaviour

`handleReceipt(attachment, createdAt, read, append)` returns the reply text. `attachment` is `{ url, contentType, size }`.

| Case | Reply | Rows saved |
|------|-------|-----------|
| Valid receipt | Summary (below) | All |
| Used outside the receipt channel (`index.js`) | Ephemeral `Use /struck in <#…>` | — |
| Type not jpeg/png/webp | `Attach a photo (jpg, png, webp)` | None |
| Size > 5 MB | `Photo too large (7.2 MB), max 5 MB` | None |
| `read` throws | `❌ not read: <message>`, error logged | None |
| `read` returns null, `items` is empty, or any item fails validation | `❌ couldn't read items, try a clearer photo` | None |
| `append` throws | `❌ not saved: <message>`, error logged | None |
| `editReply` fails | Logged only | Already saved |

Item validation (the trust boundary, applied even with a strict schema): `name` is a non-empty string after trimming, `qty` is a finite number > 0, and `price` is an integer. A single invalid item rejects the whole receipt.

Summary reply:

```
✅ 12 items saved · 2026-10-18 · Σ 85400
INDOMIE GRG ×5 @3100
AQUA 600ML ×2 @3500
DISKON MEMBER ×1 @-2000
⚠️ items sum 83400, receipt total 85400
```

- `Σ` is `Math.round(Σ qty × price)`.
- The `⚠️` line appears only when `total` is a number and differs from `Σ`.
- When the reply would exceed Discord's 2000-character limit, item lines are dropped from the end and replaced with `…and N more`. The header and the warning are always kept.

## Discord wiring (`index.js`)

- Add `RECEIPT_CHANNEL_ID`, `RECEIPT_SPREADSHEET_ID`, `RECEIPT_SHEET_TAB`, `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` to the required env list.
- On `ClientReady`: fetch the receipt channel, then `channel.guild.commands.set([struck])`, where `struck` is built with `SlashCommandBuilder` and has a required attachment option `image`. Registering as a guild command makes it available instantly and needs no `GUILD_ID` env var.
- On `InteractionCreate`, for chat-input command `struck`:
  1. Wrong channel → ephemeral reply, stop.
  2. `deferReply()` (Discord's 3-second limit becomes 15 minutes).
  3. `editReply(await handleReceipt(options.getAttachment('image', true), interaction.createdAt, readReceipt, appendReceipt))`.
  4. Wrap everything in try/catch and log, as the message handler does.
- No new gateway intents are needed for interactions.

## Files

| File | Change |
|------|--------|
| `receipt.js` (new) | `readReceipt(url, contentType)`, the prompt and the schema. |
| `handleReceipt.js` (new) | `handleReceipt(attachment, createdAt, read, append)`. No Discord or Google imports. Reuses `jakartaDate` from `parse.js`. |
| `sheet.js` | `rangeFor(tab, cols = 'A:D')`. New `appendReceipt(rows)` writes all rows to `RECEIPT_SPREADSHEET_ID` / `RECEIPT_SHEET_TAB` at `A:E`. Both appends share one lazily created client. `appendSpend` behaves as before. |
| `index.js` | Env vars, command registration, `InteractionCreate` handler. |
| `handleReceipt.test.js` (new), `sheet.test.js` | Tests below. |
| `.env.example` | The five new vars, with `OPENROUTER_MODEL=anthropic/claude-haiku-5.5`. |
| `README.md` | `/struck` usage. Re-invite the bot with the `bot` **and** `applications.commands` scopes. Create the receipt sheet with header `Date \| Barcode \| Item name \| Qty \| Price` and share it with the service account. Get an OpenRouter key. |

No new npm dependencies: OpenRouter is called with Node's built-in `fetch`.

## Testing

- `handleReceipt.test.js` (`node:test`, with fake `read` and `append`):
  - valid receipt: the rows are exactly `[date, "'barcode" | '', name, qty, price]`, appended in one call, and the summary is correct;
  - null barcode → empty cell;
  - null or malformed date (`'18/10/2026'`, `'2026-13-40'`) → Jakarta date of `createdAt`;
  - mismatch warning shown when the total differs, and hidden when equal or when `total` is null;
  - fractional qty rounds `Σ`;
  - each invalid shape (`null`, empty `items`, blank name, `qty` 0, non-integer price) → `couldn't read items`, and `append` not called;
  - wrong type or > 5 MB → the matching message, and `read` not called;
  - `read` throws → `❌ not read: …`;
  - `append` throws → `❌ not saved: …`;
  - a 200-item receipt → reply ≤ 2000 characters, ending with `…and N more` plus the warning.
- `sheet.test.js`: `rangeFor('Struk', 'A:E')` → `'Struk'!A:E`. Existing cases still pass with the default.
- `receipt.js` is thin I/O with no unit test.
- Manual end-to-end check:
  1. `/struck` three real receipts (minimarket, supermarket, one with a discount) and compare the sheet rows with the paper.
  2. Repeat with `OPENROUTER_MODEL=google/gemini-3.1-flash-lite` and keep the more accurate model.
  3. `/struck` in another channel → ephemeral hint.
  4. `/struck` a PDF → type message.

## Out of scope

Confirm/cancel buttons, editing rows from Discord, duplicate-receipt detection, PDF receipts, multiple images per command, copying receipt items into the spend sheet, and local models.
