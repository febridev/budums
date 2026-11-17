import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import {
  parseSpreadsheetId,
  getChannelConfig,
  setChannelConfig,
  _resetStoreCache,
} from './channels.js';

const testFile = './data/test_channels.json';

beforeEach(() => {
  _resetStoreCache();
  if (existsSync(testFile)) rmSync(testFile);
});

afterEach(() => {
  _resetStoreCache();
  if (existsSync(testFile)) rmSync(testFile);
});

test('parseSpreadsheetId extracts ID from full URL', () => {
  const url1 = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';
  assert.equal(parseSpreadsheetId(url1), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');

  const url2 = 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/';
  assert.equal(parseSpreadsheetId(url2), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
});

test('parseSpreadsheetId handles bare valid ID', () => {
  const bareId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  assert.equal(parseSpreadsheetId(bareId), bareId);
});

test('parseSpreadsheetId rejects invalid input', () => {
  assert.equal(parseSpreadsheetId(''), null);
  assert.equal(parseSpreadsheetId('https://google.com'), null);
  assert.equal(parseSpreadsheetId('too-short'), null);
});

test('getChannelConfig returns null when channel is not configured and no env match', () => {
  const cfg = getChannelConfig('chan-999', testFile);
  assert.equal(cfg, null);
});

test('setChannelConfig persists and getChannelConfig retrieves it', () => {
  const res = setChannelConfig(
    'chan-123',
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    'Expenses',
    testFile
  );
  assert.equal(res.spreadsheetId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(res.tab, 'Expenses');

  // Clear memory cache to verify read from disk
  _resetStoreCache();

  const loaded = getChannelConfig('chan-123', testFile);
  assert.deepEqual(loaded, {
    spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    tab: 'Expenses',
  });
});

test('getChannelConfig falls back to env vars if channelId matches process.env.CHANNEL_ID', () => {
  process.env.CHANNEL_ID = 'chan-env';
  process.env.SPREADSHEET_ID = 'sheet-from-env-12345';
  process.env.SHEET_TAB = 'TabFromEnv';

  const cfg = getChannelConfig('chan-env', testFile);
  assert.deepEqual(cfg, {
    spreadsheetId: 'sheet-from-env-12345',
    tab: 'TabFromEnv',
  });

  delete process.env.CHANNEL_ID;
  delete process.env.SPREADSHEET_ID;
  delete process.env.SHEET_TAB;
});
