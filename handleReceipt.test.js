import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleReceipt } from './handleReceipt.js';

const at = new Date('2026-10-24T23:30:00Z'); // Jakarta 2026-10-25
const photo = { url: 'https://cdn/x.jpg', contentType: 'image/jpeg', size: 1000 };
const receipt = {
  date: '2026-10-18', total: 20500,
  items: [
    { barcode: '8998866200301', name: 'INDOMIE GRG', qty: 5, price: 3100 },
    { barcode: null, name: 'AQUA 600ML', qty: 2, price: 3500 },
    { barcode: null, name: 'DISKON MEMBER', qty: 1, price: -2000 },
  ],
};
const BAD = "❌ couldn't read items, try a clearer photo";

async function run(r, { attachment = photo, read = async () => r, append } = {}) {
  const calls = [];
  const reply = await handleReceipt(attachment, at, read, append ?? (async (rows) => { calls.push(rows); }));
  return { reply, calls };
}
const withItem = (patch) => ({ ...receipt, items: [{ ...receipt.items[0], ...patch }] });

test('valid receipt appends all rows in one call and summarises', async () => {
  const { reply, calls } = await run(receipt);
  assert.deepEqual(calls, [[
    ['2026-10-18', "'8998866200301", 'INDOMIE GRG', 5, 3100],
    ['2026-10-18', '', 'AQUA 600ML', 2, 3500],
    ['2026-10-18', '', 'DISKON MEMBER', 1, -2000],
  ]]);
  assert.equal(reply, '✅ 3 items saved · 2026-10-18 · Σ 20500\nINDOMIE GRG ×5 @3100\nAQUA 600ML ×2 @3500\nDISKON MEMBER ×1 @-2000');
});

test('passes url and contentType to read', async () => {
  let args;
  await run(null, { read: async (...a) => { args = a; return receipt; } });
  assert.deepEqual(args, ['https://cdn/x.jpg', 'image/jpeg']);
});

test('blank barcode becomes empty cell', async () => {
  for (const barcode of ['', '  ']) {
    const { calls } = await run(withItem({ barcode }));
    assert.equal(calls[0][0][1], '');
  }
});

test('formula-looking names stay literal', async () => {
  for (const name of ['-DISKON', '=HEMAT', '+1 FREE', '@HOME']) {
    const { calls } = await run(withItem({ name }));
    assert.equal(calls[0][0][2], `'${name}`);
  }
  const { calls } = await run(withItem({ name: 'INDOMIE' }));
  assert.equal(calls[0][0][2], 'INDOMIE');
});

test('invalid or missing date falls back to Jakarta post date', async () => {
  for (const date of [null, '18/10/2026', '2026-13-40']) {
    const { calls } = await run({ ...receipt, date });
    assert.ok(calls[0].every((row) => row[0] === '2026-10-25'), String(date));
  }
});

test('mismatch warning', async () => {
  assert.ok((await run({ ...receipt, total: 22000 })).reply.endsWith('\n⚠️ items sum 20500, receipt total 22000'));
  assert.ok(!(await run({ ...receipt, total: null })).reply.includes('⚠️'));
});

test('fractional qty rounds the sum', async () => {
  const { reply } = await run({ date: '2026-10-18', total: 999, items: [{ barcode: null, name: 'AYAM', qty: 0.333, price: 3000 }] });
  assert.ok(reply.split('\n')[0].includes('Σ 999'));
  assert.ok(!reply.includes('⚠️'));
});

test('bad model output saves nothing', async () => {
  const bad = [
    null,
    { ...receipt, items: [] },
    withItem({ name: '  ' }),
    withItem({ qty: 0 }),
    withItem({ price: 3100.5 }),
    withItem({ price: '3100' }),
    withItem({ qty: '2' }),
  ];
  for (const r of bad) {
    const { reply, calls } = await run(r);
    assert.equal(reply, BAD, JSON.stringify(r));
    assert.equal(calls.length, 0);
  }
});

test('rejects non-photo types without reading', async () => {
  for (const contentType of ['application/pdf', 'image/heic', undefined, null]) {
    const { reply } = await run(receipt, { attachment: { ...photo, contentType }, read: async () => assert.fail('read') });
    assert.equal(reply, 'Attach a photo (jpg, png, webp)');
  }
});

test('size limit is inclusive at 5 MB', async () => {
  assert.equal((await run(receipt, { attachment: { ...photo, size: 5242880 } })).calls.length, 1);
  assert.equal((await run(receipt, { attachment: { ...photo, size: 5242881 } })).reply, 'Photo too large (5.0 MB), max 5 MB');
  assert.equal((await run(receipt, { attachment: { ...photo, size: 7549747 } })).reply, 'Photo too large (7.2 MB), max 5 MB');
});

test('read failure reported', async () => {
  const { reply } = await run(null, { read: async () => { throw new Error('OpenRouter 402: Insufficient credits'); } });
  assert.equal(reply, '❌ not read: OpenRouter 402: Insufficient credits');
});

test('sheet failure reported', async () => {
  const { reply } = await run(receipt, { append: async () => { throw new Error('The caller does not have permission'); } });
  assert.equal(reply, '❌ not saved: The caller does not have permission');
});

test("long receipt is truncated to Discord's limit", async () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ barcode: null, name: 'ITEM NUMBER ' + i, qty: 1, price: 1000 }));
  const { reply, calls } = await run({ date: '2026-10-18', total: 1, items });
  assert.ok(reply.length <= 2000, String(reply.length));
  assert.ok(reply.startsWith('✅ 200 items saved'));
  assert.match(reply, /\n…and \d+ more\n⚠️ items sum \d+, receipt total 1$/);
  assert.equal(calls[0].length, 200);
});

test('non-string barcode is bad output, not a crash', async () => {
  const { reply, calls } = await run(withItem({ barcode: 8991234567890 }));
  assert.equal(reply, BAD);
  assert.equal(calls.length, 0);
});
