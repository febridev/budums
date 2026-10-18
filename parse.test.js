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
