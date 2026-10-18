import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeFor } from './sheet.js';

test('rangeFor quotes the tab name', () => {
  assert.equal(rangeFor('Sheet1'), "'Sheet1'!A:D");
  assert.equal(rangeFor('Pengeluaran 2026'), "'Pengeluaran 2026'!A:D");
  assert.equal(rangeFor("Feb's"), "'Feb''s'!A:D");
});
