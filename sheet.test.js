import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeFor } from './sheet.js';

test('rangeFor quotes the tab name', () => {
  assert.equal(rangeFor('Sheet1'), "'Sheet1'!A:F");
  assert.equal(rangeFor('Pengeluaran 2026'), "'Pengeluaran 2026'!A:F");
  assert.equal(rangeFor("Feb's"), "'Feb''s'!A:F");
});
test('rangeFor takes a column span', () => {
  assert.equal(rangeFor('Struk', 'A:E'), "'Struk'!A:E");
  assert.equal(rangeFor("Feb's", 'A:E'), "'Feb''s'!A:E");
});
