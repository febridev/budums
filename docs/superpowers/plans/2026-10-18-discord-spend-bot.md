# Discord Spend Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Discord bot that turns a message like `jajan kopi 25000 jajan`, posted in one channel, into a Google Sheet row `2026-10-25 | 25000 | jajan kopi | jajan`.

**Architecture:**
- Two pure modules that can be unit-tested without network access:
  - `parse.js`: parses the text and formats the date.
  - `handle.js`: decides what to reply and calls an injected `append` function.
- Two thin adapters:
  - `sheet.js`: Google Sheets append.
  - `index.js`: the Discord client.
- Runs in Docker Compose on a VPS.

**Tech Stack:** Node.js 20 (ESM), `discord.js` v14, `@googleapis/sheets`, `node:test`, Docker Compose v2.

**Spec:** `docs/superpowers/specs/2026-10-18-discord-spend-bot-design.md`

## Global Constraints

- Node.js 20+, `"type": "module"`, no `dotenv`. Locally: `node --env-file=.env index.js`. Docker: Compose `env_file`.
- Runtime dependencies are only `discord.js@14` and `@googleapis/sheets`. No dev dependencies.
- Env vars: `DISCORD_TOKEN`, `CHANNEL_ID`, `SPREADSHEET_ID`, `SHEET_TAB`, `GOOGLE_APPLICATION_CREDENTIALS`.
- Column order: `Date | Price | Item | Category` (A:D). Append with `valueInputOption: 'USER_ENTERED'`.
- Date: `Asia/Jakarta`, `YYYY-MM-DD`, taken from the message's `createdAt`.
- Price token must match `^\d+$`.
- Reply copy (exact):
  - success: `✅ ${date} | ${price} | ${item} | ${category}`
  - invalid: `Format: <item> <price> <category>, e.g. jajan kopi 25000 jajan`
  - Sheets error: `❌ not saved: ${err.message}`
- `.env` and `credentials.json` must never be committed or copied into the image.

## Review Focus

1. **Empty message text** (image-only post, or the MessageContent intent left off in the portal): no reply and no row. This keeps the bot from spamming the format hint. Test in Task 2.
2. **Multi-line or tab-separated text** (`jajan kopi\n25000\tjajan`): parsed the same as single spaces. Test in Task 1.
3. **Sheets API failure** (sheet not shared, wrong ID, network): the bot replies `❌ not saved: …`, never `✅`, and the process keeps running. Test in Task 2.
4. **`SHEET_TAB` containing spaces or an apostrophe** (e.g. `Pengeluaran 2026`, `Feb's`): the A1 range is quoted (`'Pengeluaran 2026'!A:D`, `'Feb''s'!A:D`). Test in Task 3.
5. **A missing env var at startup**: the process exits with code 1 and a message naming the missing variable, instead of crashing later with a vague error. Verified in Task 3.

---

### Task 1: Project scaffold + parser

**Files:**
- Create: `package.json`, `.gitignore`, `parse.js`
- Test: `parse.test.js`

**Interfaces:**
- Produces:
  - `parseSpend(text: string): { item: string, price: number, category: string } | null`
  - `jakartaDate(date: Date): string` (returns `YYYY-MM-DD`)

- [ ] **Step 1: Scaffold**
  - `package.json`:
    - `"name": "budums"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=20.6" }`
    - scripts: `"start": "node --env-file=.env index.js"`, `"test": "node --test"`
  - `.gitignore`: `node_modules/`, `.env`, `credentials.json`
  - Run `npm install discord.js@14 @googleapis/sheets` so `package-lock.json` exists.

- [ ] **Step 2: Write the failing tests in `parse.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpend, jakartaDate } from './parse.js';

test('multi-word item', () => {
  assert.deepEqual(parseSpend('jajan kopi 25000 jajan'), { item: 'jajan kopi', price: 25000, category: 'jajan' });
});
test('minimal three tokens', () => {
  assert.deepEqual(parseSpend('kopi 25000 jajan'), { item: 'kopi', price: 25000, category: 'jajan' });
});
test('extra, multi-line and tab whitespace collapses', () => {
  assert.deepEqual(parseSpend('  jajan   kopi\n25000\tjajan  '), { item: 'jajan kopi', price: 25000, category: 'jajan' });
});
test('rejects non-plain prices', () => {
  for (const t of ['kopi 25k jajan', 'kopi 25.000 jajan', 'kopi 25,000 jajan', 'kopi -5 jajan']) assert.equal(parseSpend(t), null, t);
});
test('rejects short or empty input', () => {
  for (const t of ['', '   ', 'kopi', '25000 jajan']) assert.equal(parseSpend(t), null, JSON.stringify(t));
});
test('jakartaDate converts to UTC+7', () => {
  assert.equal(jakartaDate(new Date('2026-10-24T23:30:00Z')), '2026-10-25');
  assert.equal(jakartaDate(new Date('2026-10-25T10:00:00Z')), '2026-10-25');
  assert.equal(jakartaDate(new Date('2026-10-25T16:59:59Z')), '2026-10-25');
});
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, because `./parse.js` can't be found.

- [ ] **Step 4: Implement both functions in `parse.js`**
  - `parseSpend`: `text.trim().split(/\s+/)`, then the rule from the spec. Return `price` as a Number.
  - `jakartaDate`: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date)`. The `en-CA` locale formats as `YYYY-MM-DD`.

- [ ] **Step 5: Run `npm test`.** Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore parse.js parse.test.js
git commit -m "feat: add spend message parser and Jakarta date"
```

### Task 2: Message handling

**Files:**
- Create: `handle.js`
- Test: `handle.test.js`

**Interfaces:**
- Consumes: `parseSpend` and `jakartaDate` from Task 1.
- Produces: `handleSpend(text: string, createdAt: Date, append: (row: [string, number, string, string]) => Promise<void>): Promise<string | null>`
  - It returns the reply text, or `null` meaning "don't reply".
  - It never throws when `append` rejects.

- [ ] **Step 1: Write the failing tests in `handle.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSpend } from './handle.js';

const at = new Date('2026-10-24T23:30:00Z');

test('valid message appends row in Date|Price|Item|Category order and confirms', async () => {
  const rows = [];
  const reply = await handleSpend('jajan kopi 25000 jajan', at, async (r) => { rows.push(r); });
  assert.deepEqual(rows, [['2026-10-25', 25000, 'jajan kopi', 'jajan']]);
  assert.equal(reply, '✅ 2026-10-25 | 25000 | jajan kopi | jajan');
});
test('invalid message returns format hint and appends nothing', async () => {
  let called = false;
  const reply = await handleSpend('hello', at, async () => { called = true; });
  assert.equal(reply, 'Format: <item> <price> <category>, e.g. jajan kopi 25000 jajan');
  assert.equal(called, false);
});
test('empty text is ignored', async () => {
  for (const t of ['', '  \n ']) assert.equal(await handleSpend(t, at, async () => assert.fail('appended')), null);
});
test('sheet failure reports error instead of success', async () => {
  const reply = await handleSpend('kopi 25000 jajan', at, async () => { throw new Error('The caller does not have permission'); });
  assert.equal(reply, '❌ not saved: The caller does not have permission');
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `./handle.js` can't be found.

- [ ] **Step 3: Implement `handleSpend` in `handle.js`.**
  - Use the exact reply copy from Global Constraints.
  - When the append fails, `console.error` the error before returning the `❌` reply.

- [ ] **Step 4: Run `npm test`.** Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add handle.js handle.test.js
git commit -m "feat: add spend message handler"
```

### Task 3: Sheets + Discord wiring

**Files:**
- Create: `sheet.js`, `index.js`, `.env.example`
- Test: `sheet.test.js`

**Interfaces:**
- Consumes: `handleSpend` from Task 2.
- Produces:
  - `rangeFor(tab: string): string`
  - `appendSpend(row: [string, number, string, string]): Promise<void>`

- [ ] **Step 1: Write the failing test in `sheet.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeFor } from './sheet.js';

test('rangeFor quotes the tab name', () => {
  assert.equal(rangeFor('Sheet1'), "'Sheet1'!A:D");
  assert.equal(rangeFor('Pengeluaran 2026'), "'Pengeluaran 2026'!A:D");
  assert.equal(rangeFor("Feb's"), "'Feb''s'!A:D");
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `./sheet.js` can't be found.

- [ ] **Step 3: Implement `sheet.js`**
  - `rangeFor`: wrap the tab name in single quotes and double any `'` inside it.
  - `appendSpend`:
    - Create the client lazily on the first call, so importing `sheet.js` in tests needs no credentials. Use `sheets({ version: 'v4', auth: new auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) })` from `@googleapis/sheets`.
    - Call `spreadsheets.values.append` with:
      - `spreadsheetId: process.env.SPREADSHEET_ID`
      - `range: rangeFor(process.env.SHEET_TAB)`
      - `valueInputOption: 'USER_ENTERED'`
      - `insertDataOption: 'INSERT_ROWS'`
      - `requestBody: { values: [row] }`

- [ ] **Step 4: Run `npm test`.** Expected: all 11 tests pass.

- [ ] **Step 5: Implement `index.js` and `.env.example`**
  - `index.js`:
    1. At startup, for each of the 5 env vars that is missing, print `Missing env var: <NAME>`. If any are missing, call `process.exit(1)`.
    2. Create a `Client` with intents `Guilds`, `GuildMessages`, `MessageContent`.
    3. On `messageCreate`, skip messages where `message.author.bot` is true or `message.channelId !== process.env.CHANNEL_ID`.
    4. Otherwise run `const reply = await handleSpend(message.content, message.createdAt, appendSpend)`. If `reply` is not null, call `message.reply(reply)`.
    5. Catch and `console.error` any error from `message.reply`, so a failed reply doesn't crash the process.
    6. Log `Logged in as <tag>` on `ready`.
  - `.env.example`: the 5 vars, with `GOOGLE_APPLICATION_CREDENTIALS=./credentials.json`.

- [ ] **Step 6: Verify the startup guard.** Run `node index.js` with no `.env`. Expected: 5 `Missing env var:` lines and exit code 1 (`echo $?`).

- [ ] **Step 7: Commit**

```bash
git add sheet.js sheet.test.js index.js .env.example
git commit -m "feat: wire Discord client to Google Sheets"
```

### Task 4: Docker, README, end-to-end check

**Files:**
- Create: `Dockerfile`, `compose.yml`, `.dockerignore`, `README.md`

**Interfaces:**
- Consumes: `index.js` (Task 3) and the npm scripts (Task 1).

- [ ] **Step 1: Write the Docker files**
  - `Dockerfile`:
    - `FROM node:20-alpine`, `WORKDIR /app`
    - copy `package*.json`, run `npm ci --omit=dev`, then `COPY . .`
    - `USER node`, `CMD ["node", "index.js"]`
  - `compose.yml`: one service `bot` with:
    - `build: .`
    - `restart: unless-stopped`
    - `env_file: .env`
    - `environment: GOOGLE_APPLICATION_CREDENTIALS: /app/credentials.json`, which overrides the local path in `.env`
    - `volumes: ["./credentials.json:/app/credentials.json:ro"]`
  - `.dockerignore`: `node_modules`, `.env`, `credentials.json`, `.git`, `docs`, `*.test.js`

- [ ] **Step 2: Write `README.md`** with these sections:
  1. **Discord:**
     - create the app and bot
     - enable the **Message Content Intent**
     - invite the bot with the `bot` scope and the *View Channel*, *Send Messages* and *Read Message History* permissions
     - copy the channel ID (Developer Mode → right-click the channel → Copy ID)
  2. **Google:**
     - enable the Sheets API
     - create a service account and download its JSON key as `credentials.json`
     - share the sheet with the service account's email as **Editor**
     - type the header row `Date | Price | Item | Category`
     - copy the spreadsheet ID from the URL
  3. **Local:** `cp .env.example .env`, fill it in, then run `npm start`.
  4. **VPS:**
     - copy the repo, `.env` and `credentials.json`
     - make sure `credentials.json` is readable by the container user, with `chmod 644 credentials.json`
     - run `docker compose up -d --build` and watch `docker compose logs -f`
  5. **Usage:**
     - `jajan kopi 25000 jajan`
     - rule: last word is the category, the plain number before it is the price, the rest is the item

- [ ] **Step 3: Verify the image builds.** Run `docker compose build`. Expected: the build succeeds and `docker compose config` shows the read-only volume.

- [ ] **Step 4: Run the end-to-end check** (needs real credentials; the owner runs it or supplies `.env` and `credentials.json`)
  1. Run `docker compose up -d`. The logs show `Logged in as …`.
  2. Post `jajan kopi 25000 jajan` in the channel. Expected: the bot replies `✅ <today> | 25000 | jajan kopi | jajan`, and a new sheet row appears with a date cell and a numeric price.
  3. Post `hello`. Expected: the format hint, and no new row.
  4. Post in a different channel. Expected: no reply.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile compose.yml .dockerignore README.md
git commit -m "feat: add Docker deployment and setup guide"
```
