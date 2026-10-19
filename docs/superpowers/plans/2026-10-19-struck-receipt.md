# /struck Receipt Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Running `/struck image:<photo>` in the receipt channel reads every line item through OpenRouter and appends `Date | Barcode | Item name | Qty | Price` rows to a second Google Sheet.

**Architecture:**
- One pure module, `handleReceipt.js`: validation, rows and reply text, with injected `read` and `append`.
- Two thin I/O adapters:
  - `receipt.js`: download plus OpenRouter.
  - `sheet.js`: gains `appendReceipt`.
- `index.js` registers the guild slash command and routes interactions.
- The spend flow is untouched.

**Tech Stack:** Node.js 22+ (ESM), `discord.js` v14, `@googleapis/sheets`, built-in `fetch`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-18-struck-receipt-design.md`

## Global Constraints

- No new npm dependencies. OpenRouter is called with built-in `fetch`.
- New env vars, all required at startup: `RECEIPT_CHANNEL_ID`, `RECEIPT_SPREADSHEET_ID`, `RECEIPT_SHEET_TAB`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (example value `anthropic/claude-haiku-5.5`).
- Receipt columns: `Date | Barcode | Item name | Qty | Price` (A:E), one `values.append` per receipt, `valueInputOption: 'USER_ENTERED'`, `insertDataOption: 'INSERT_ROWS'`.
- Accepted types: `image/jpeg`, `image/png`, `image/webp`. Max size `5 * 1024 * 1024` bytes (a file of exactly that size is accepted).
- Date: the receipt date if it is a valid `YYYY-MM-DD` calendar date, else `jakartaDate(createdAt)` from `parse.js`.
- Reply copy (exact):
  - header: `✅ ${n} items saved · ${date} · Σ ${sum}`
  - item line: `${name} ×${qty} @${price}`
  - warning: `⚠️ items sum ${sum}, receipt total ${total}`
  - overflow: `…and ${n} more`
  - wrong type: `Attach a photo (jpg, png, webp)`
  - too large: `Photo too large (${mb} MB), max 5 MB`, where `mb = (size / 1048576).toFixed(1)`
  - read error: `❌ not read: ${err.message}`
  - bad output: `❌ couldn't read items, try a clearer photo`
  - Sheets error: `❌ not saved: ${err.message}`
  - wrong channel (ephemeral): `Use /struck in <#${RECEIPT_CHANNEL_ID}>`
- Discord reply ≤ 2000 characters.
- `.env` and `credentials.json` are never committed.

## Review Focus

1. **Provider ignores the strict schema** and returns `price: "3100"` or `qty: "2"` as strings. The receipt is rejected with the "couldn't read items" reply, and no rows are saved. Test in Task 2.
2. **Model returns `barcode: ""` or whitespace instead of null.** The cell must be empty, not a lone `'`. Test in Task 2.
3. **Item name starting with `=`, `+`, `-` or `@`** (e.g. `-DISKON`, `=HEMAT`). `USER_ENTERED` would parse it as a formula and show `#ERROR!`. The name is written as `'${name}` so it stays literal text. Test in Task 2.
4. **Attachment with a missing `contentType` or `image/heic`** (iPhone originals). The bot gives the wrong-type reply, and `read` is never called. Test in Task 2.
5. **A file of exactly 5 MB** is accepted, and 5 MB + 1 byte is rejected. Test in Task 2.

---

### Task 1: `sheet.js` writes to the receipt sheet

**Files:**
- Modify: `sheet.js`
- Test: `sheet.test.js`

**Interfaces:**
- Produces:
  - `rangeFor(tab: string, cols = 'A:D'): string`
  - `appendReceipt(rows: Array<[date: string, barcode: string, name: string, qty: number, price: number]>): Promise<void>`
  - `appendSpend(row)`, unchanged.

- [ ] **Step 1: Install dependencies**

Run: `npm ci && npm test`
Expected: all existing tests pass.

- [ ] **Step 2: Write the failing test** (append to `sheet.test.js`)

```js
test('rangeFor takes a column span', () => {
  assert.equal(rangeFor('Struk', 'A:E'), "'Struk'!A:E");
  assert.equal(rangeFor("Feb's", 'A:E'), "'Feb''s'!A:E");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test sheet.test.js`
Expected: FAIL. The output shows `'Struk'!A:D` where `'Struk'!A:E` was expected.

- [ ] **Step 4: Implement**

- Add a `cols = 'A:D'` parameter to `rangeFor`.
- Extract a private `append(spreadsheetId, tab, cols, rows)` that holds the lazily created client and the existing `values.append` call.
- `appendSpend(row)` becomes `append(SPREADSHEET_ID, SHEET_TAB, 'A:D', [row])`.
- `appendReceipt(rows)` is `append(RECEIPT_SPREADSHEET_ID, RECEIPT_SHEET_TAB, 'A:E', rows)`.
- Read the env vars at call time, as today.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass, including the original `rangeFor` cases.

- [ ] **Step 6: Commit**

```bash
git add sheet.js sheet.test.js
git commit -m "feat: add receipt sheet append"
```

---

### Task 2: `handleReceipt.js`

**Files:**
- Create: `handleReceipt.js`
- Test: `handleReceipt.test.js`

**Interfaces:**
- Consumes: `jakartaDate(date: Date): string` from `parse.js`.
- Produces: `handleReceipt(attachment: { url: string, contentType?: string|null, size: number }, createdAt: Date, read: (url, contentType) => Promise<object|null>, append: (rows) => Promise<void>): Promise<string>`. It never throws; failures become reply text.

- [ ] **Step 1: Write the failing tests**

Test fixtures:

```js
const at = new Date('2026-10-24T23:30:00Z');                  // Jakarta 2026-10-25
const photo = { url: 'https://cdn/x.jpg', contentType: 'image/jpeg', size: 1000 };
const receipt = {
  date: '2026-10-18', total: 20500,
  items: [
    { barcode: '8998866200301', name: 'INDOMIE GRG', qty: 5, price: 3100 },
    { barcode: null, name: 'AQUA 600ML', qty: 2, price: 3500 },
    { barcode: null, name: 'DISKON MEMBER', qty: 1, price: -2000 },
  ],
};
// run(r, opts) → { reply, calls }: read resolves r, append records each call's rows.
```

Tests, each with its assertions:

1. **`valid receipt appends all rows in one call and summarises`**
   - `calls` deep-equals:
     ```js
     [[['2026-10-18', "'8998866200301", 'INDOMIE GRG', 5, 3100],
       ['2026-10-18', '', 'AQUA 600ML', 2, 3500],
       ['2026-10-18', '', 'DISKON MEMBER', 1, -2000]]]
     ```
   - `reply` equals:
     ```js
     '✅ 3 items saved · 2026-10-18 · Σ 20500\nINDOMIE GRG ×5 @3100\nAQUA 600ML ×2 @3500\nDISKON MEMBER ×1 @-2000'
     ```
     There is no warning, because 15500 + 7000 − 2000 = 20500.
2. **`passes url and contentType to read`**: `read` receives `('https://cdn/x.jpg', 'image/jpeg')`.
3. **`blank barcode becomes empty cell`**: barcodes `''` and `'  '` both give `''` in column B.
4. **`formula-looking names stay literal`**: names `'-DISKON'`, `'=HEMAT'`, `'+1 FREE'` and `'@HOME'` are written as `"'-DISKON"` and so on. `'INDOMIE'` stays unprefixed.
5. **`invalid or missing date falls back to Jakarta post date`**: for `null`, `'18/10/2026'` and `'2026-13-40'`, every row's date is `'2026-10-25'`.
6. **`mismatch warning`**:
   - with `total: 22000`, the reply ends `'\n⚠️ items sum 20500, receipt total 22000'`;
   - with `total: null`, there is no `⚠️` in the reply.
7. **`fractional qty rounds the sum`**: one item `{ qty: 0.333, price: 3000 }` with `total: 999` gives a header containing `Σ 999` and no warning.
8. **`bad model output saves nothing`**: each of these returns `"❌ couldn't read items, try a clearer photo"` with `calls.length === 0`:
   - `null`
   - `{ ...receipt, items: [] }`
   - an item with name `'  '`
   - an item with `qty: 0`
   - an item with `price: 3100.5`
   - an item with `price: '3100'`
   - an item with `qty: '2'`
9. **`rejects non-photo types without reading`**: for contentType `'application/pdf'`, `'image/heic'`, `undefined` and `null`, the reply is `'Attach a photo (jpg, png, webp)'` and `read` is not called.
10. **`size limit is inclusive at 5 MB`**:
    - `size: 5242880` reads and saves;
    - `size: 5242881` gives `'Photo too large (5.0 MB), max 5 MB'`;
    - `size: 7549747` gives `'Photo too large (7.2 MB), max 5 MB'`.
11. **`read failure reported`**: when `read` rejects with `Error('OpenRouter 402: Insufficient credits')`, the reply is `'❌ not read: OpenRouter 402: Insufficient credits'`.
12. **`sheet failure reported`**: when `append` rejects with `Error('The caller does not have permission')`, the reply is `'❌ not saved: The caller does not have permission'`.
13. **`long receipt is truncated to Discord's limit`**: 200 items `{ barcode: null, name: 'ITEM NUMBER ' + i, qty: 1, price: 1000 }`, with `total: 1`.
    - `reply.length <= 2000`;
    - the reply starts with `'✅ 200 items saved'`;
    - it matches `/\n…and \d+ more\n⚠️ items sum \d+, receipt total 1$/`;
    - all 200 rows are still appended.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test handleReceipt.test.js`
Expected: FAIL with `Cannot find module './handleReceipt.js'`.

- [ ] **Step 3: Implement `handleReceipt` in `handleReceipt.js`**

Order of checks: type, size, `read`, validate, build rows, `append`, reply.

- Log errors with `console.error` as `handle.js` does.
- Date validity check: `/^\d{4}-\d{2}-\d{2}$/` and `new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d`. Guard the `toISOString` call, which throws on an invalid date, by checking `!isNaN` first.
- Item validation:
  - `typeof name === 'string' && name.trim()`
  - `typeof qty === 'number' && Number.isFinite(qty) && qty > 0`
  - `Number.isInteger(price)`
- Truncation:
  - build `header`, `lines[]` and the optional `warning`;
  - while `[header, ...shown, more, warning].join('\n')` exceeds 2000, drop the last shown line;
  - add the `…and N more` line only if at least one line was dropped.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add handleReceipt.js handleReceipt.test.js
git commit -m "feat: add receipt handler"
```

---

### Task 3: OpenRouter reader, `/struck` wiring, config and docs

**Files:**
- Create: `receipt.js`
- Modify: `index.js`, `.env.example`, `README.md`

**Interfaces:**
- Consumes:
  - `handleReceipt` (Task 2);
  - `appendReceipt` (Task 1).
- Produces: `readReceipt(url: string, contentType: string): Promise<object|null>`.

- [ ] **Step 1: Implement `readReceipt` in `receipt.js`**

Build the request body exactly as in the spec's "Model request" section: model from `OPENROUTER_MODEL`, the schema, and `provider: { require_parameters: true }`.

- The prompt carries the six rules from the spec as plain sentences.
- Download the image with `fetch(url)`, then build `data:${contentType};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`.
- POST to `https://openrouter.ai/api/v1/chat/completions` with header `Authorization: Bearer ${OPENROUTER_API_KEY}`.
- Pass `signal: AbortSignal.timeout(60_000)` to both fetches.
- Throw `Error(\`download ${res.status}\`)` on a failed download.
- Throw `Error(\`OpenRouter ${res.status}: ${body.error?.message}\`)` on a non-2xx response.
- Return `JSON.parse(choices[0].message.content)`, or `null` when that content is missing or the parse throws.

- [ ] **Step 2: Wire `index.js`**

- Append the five env vars to `required`.
- Define the command: `new SlashCommandBuilder().setName('struck').setDescription('Save a shopping receipt').addAttachmentOption((o) => o.setName('image').setDescription('Receipt photo').setRequired(true))`.
- In `ClientReady`: `const ch = await c.channels.fetch(process.env.RECEIPT_CHANNEL_ID); await ch.guild.commands.set([struck]);`. Wrap it in try/catch, and log `command registration failed:` on error.
- Add an `Events.InteractionCreate` handler. It returns unless `interaction.isChatInputCommand() && interaction.commandName === 'struck'`. Then:
  - wrong channel: `interaction.reply({ content, flags: MessageFlags.Ephemeral })`;
  - otherwise `deferReply()`, then `editReply(await handleReceipt(interaction.options.getAttachment('image', true), interaction.createdAt, readReceipt, appendReceipt))`;
  - wrap it all in try/catch with `console.error('interaction failed:', err)`.

- [ ] **Step 3: Static checks**

Run: `node --check index.js && node --check receipt.js && npm test`
Expected: no syntax errors, all tests pass.

- [ ] **Step 4: Update `.env.example` and `README.md`**

- `.env.example`: add the five vars, with `RECEIPT_SHEET_TAB=Sheet1` and `OPENROUTER_MODEL=anthropic/claude-haiku-5.5`.
- `README.md`:
  - a `/struck` usage section with an example reply;
  - Discord: the URL generator scopes are now `bot` **and** `applications.commands` (existing installs re-open the URL once);
  - Google: create the second sheet, share it with the same service account, header `Date | Barcode | Item name | Qty | Price`, IDs into the `RECEIPT_*` vars;
  - OpenRouter: create a key at <https://openrouter.ai/keys>, add credit, set `OPENROUTER_API_KEY`;
  - how to switch `OPENROUTER_MODEL`.

- [ ] **Step 5: Commit**

```bash
git add receipt.js index.js .env.example README.md
git commit -m "feat: add /struck receipt command"
```

- [ ] **Step 6: Manual end-to-end check** (the human partner runs this with real credentials)

1. `npm start`. Expect `Logged in as …` with no `command registration failed`.
2. Type `/struck` in the receipt channel and confirm it autocompletes with an `image` option.
3. Run `/struck` with a minimarket receipt, a supermarket receipt and a receipt with a discount. Each reply matches the sheet rows, and the rows match the paper.
4. Set `OPENROUTER_MODEL=google/gemini-3.1-flash-lite`, restart, repeat step 3, and keep the more accurate model.
5. Run `/struck` in another channel and get the ephemeral hint.
6. Run `/struck` with a PDF and get `Attach a photo (jpg, png, webp)`.
7. Post `jajan kopi 25000 jajan` in the spend channel. It still logs as before.
