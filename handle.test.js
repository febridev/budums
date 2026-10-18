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
