import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReceiptFromBuffer, handleReceiptCommand } from './receipt.js';

function createMockAiClient(responseJsonString) {
  return {
    models: {
      generateContent: async () => ({
        text: typeof responseJsonString === 'string' ? responseJsonString : JSON.stringify(responseJsonString),
      }),
    },
  };
}

test('extractReceiptFromBuffer extracts item, price, category, and date', async () => {
  const mockClient = createMockAiClient({
    item: 'Kopi Kenangan',
    price: 24000,
    category: 'jajan',
    date: '2026-11-15',
  });

  const res = await extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', {
    aiClient: mockClient,
  });

  assert.deepEqual(res, {
    item: 'Kopi Kenangan',
    price: 24000,
    category: 'jajan',
    date: '2026-11-15',
  });
});

test('extractReceiptFromBuffer respects custom category and item override', async () => {
  const mockClient = createMockAiClient({
    item: 'Default Store',
    price: 50000,
    category: 'belanja',
  });

  const res = await extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', {
    aiClient: mockClient,
    customCategory: 'makan',
    customItem: 'Custom Dinner',
  });

  assert.equal(res.category, 'makan');
  assert.equal(res.item, 'Custom Dinner');
  assert.equal(res.price, 50000);
});

test('extractReceiptFromBuffer throws on model error object', async () => {
  const mockClient = createMockAiClient({
    error: 'Image is blurry and illegible',
  });

  await assert.rejects(
    () => extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', { aiClient: mockClient }),
    /Image is blurry and illegible/
  );
});

test('extractReceiptFromBuffer throws when price is invalid or zero', async () => {
  const mockClient = createMockAiClient({
    item: 'Something',
    price: 0,
    category: 'jajan',
  });

  await assert.rejects(
    () => extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', { aiClient: mockClient }),
    /Could not identify a valid total price/
  );
});

test('handleReceiptCommand prompts when channel has no Google Sheet configured', async () => {
  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: null,
    appendSpend: async () => {},
  });

  assert.match(reply, /No Google Sheet is configured for this channel yet/);
  assert.match(reply, /\/set-sheet/);
});

test('handleReceiptCommand saves receipt and confirms', async () => {
  const mockClient = createMockAiClient({
    item: 'Indomaret Snack',
    price: 15500,
    category: 'jajan',
  });

  let appended = null;
  const mockAppend = async (row, opts) => {
    appended = { row, opts };
  };

  const channelConfig = {
    spreadsheetId: 'sheet-1234567890',
    tab: 'Nov2026',
  };

  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    createdAt: new Date('2026-11-17T08:00:00Z'),
    channelConfig,
    appendSpend: mockAppend,
    aiClient: mockClient,
  });

  assert.match(reply, /✅ \*\*Saved!\*\*/);
  assert.match(reply, /15500/);
  assert.match(reply, /Indomaret Snack/);
  assert.deepEqual(appended.opts, {
    spreadsheetId: 'sheet-1234567890',
    tab: 'Nov2026',
  });
  assert.equal(appended.row[1], 15500);
  assert.equal(appended.row[2], 'Indomaret Snack');
  assert.equal(appended.row[3], 'jajan');
});

test('handleReceiptCommand reports Google Sheet append failure', async () => {
  const mockClient = createMockAiClient({
    item: 'Coffee',
    price: 20000,
    category: 'jajan',
  });

  const mockAppend = async () => {
    throw new Error('Permission denied on Google Sheet');
  };

  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'Sheet1' },
    appendSpend: mockAppend,
    aiClient: mockClient,
  });

  assert.match(reply, /❌ Failed to save to Google Sheet: Permission denied/);
});
