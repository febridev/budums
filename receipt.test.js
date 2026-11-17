import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReceiptFromBuffer, handleReceiptCommand } from './receipt.js';

function createMockAiClient(responseJson) {
  return {
    models: {
      generateContent: async () => ({
        text: typeof responseJson === 'string' ? responseJson : JSON.stringify(responseJson),
      }),
    },
  };
}

test('extractReceiptFromBuffer extracts multiple items with qty and prices', async () => {
  const mockClient = createMockAiClient([
    { item: 'Es Kopi Susu', qty: 1, unit_price: 24000, total_price: 24000, date: '2026-11-15' },
    { item: 'Roti Bakar', qty: 2, unit_price: 18000, total_price: 36000, date: '2026-11-15' },
  ]);

  const res = await extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', {
    aiClient: mockClient,
  });

  assert.equal(res.length, 2);
  assert.equal(res[0].item, 'Es Kopi Susu');
  assert.equal(res[0].unitPrice, 24000);
  assert.equal(res[0].totalPrice, 24000);
  assert.equal(res[0].qty, 1);
  assert.equal(res[1].item, 'Roti Bakar');
  assert.equal(res[1].unitPrice, 18000);
  assert.equal(res[1].totalPrice, 36000);
  assert.equal(res[1].qty, 2);
});

test('extractReceiptFromBuffer handles single item object', async () => {
  const mockClient = createMockAiClient({
    item: 'Kopi Kenangan',
    qty: 1,
    unit_price: 24000,
    total_price: 24000,
    date: '2026-11-15',
  });

  const res = await extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', {
    aiClient: mockClient,
  });

  assert.equal(res.length, 1);
  assert.equal(res[0].item, 'Kopi Kenangan');
  assert.equal(res[0].unitPrice, 24000);
  assert.equal(res[0].totalPrice, 24000);
});

test('extractReceiptFromBuffer derives total from qty * unit_price', async () => {
  const mockClient = createMockAiClient([
    { item: 'Air Mineral', qty: 3, unit_price: 5000, date: null },
  ]);

  const res = await extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', {
    aiClient: mockClient,
  });

  assert.equal(res[0].qty, 3);
  assert.equal(res[0].unitPrice, 5000);
  assert.equal(res[0].totalPrice, 15000);
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

test('extractReceiptFromBuffer throws when all prices are invalid', async () => {
  const mockClient = createMockAiClient([
    { item: 'Something', qty: 1, unit_price: 0, total_price: 0 },
  ]);

  await assert.rejects(
    () => extractReceiptFromBuffer(Buffer.from('fake'), 'image/jpeg', { aiClient: mockClient }),
    /Could not identify any valid items/
  );
});

test('handleReceiptCommand prompts when channel has no Google Sheet configured', async () => {
  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: null,
    appendSpend: async () => {},
  });

  assert.match(reply, /No Google Sheet is configured for this channel yet/);
});

test('handleReceiptCommand saves rows in TGL|Kode_Barcode|Nama_Barang|Qty|Harga_Satuan|Total_Harga format', async () => {
  const mockClient = createMockAiClient([
    { item: 'Es Kopi Susu', qty: 1, unit_price: 24000, total_price: 24000 },
    { item: 'Roti Bakar', qty: 2, unit_price: 18000, total_price: 36000 },
  ]);

  let appendedArgs = null;
  const mockAppend = async (rows, opts) => {
    appendedArgs = { rows, opts };
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

  assert.match(reply, /Saved 2 items/);
  assert.match(reply, /Es Kopi Susu/);
  assert.match(reply, /Roti Bakar/);

  // Verify row format: [TGL, Kode_Barcode, Nama_Barang, Qty, Harga_Satuan, Total_Harga]
  const rows = appendedArgs.rows;
  assert.equal(rows.length, 2);

  // Row 1: Es Kopi Susu
  assert.equal(rows[0][0], '2026-11-17'); // TGL
  assert.equal(rows[0][1], '');           // Kode_Barcode (empty)
  assert.equal(rows[0][2], 'Es Kopi Susu'); // Nama_Barang
  assert.equal(rows[0][3], 1);           // Qty
  assert.equal(rows[0][4], 24000);       // Harga_Satuan
  assert.equal(rows[0][5], 24000);       // Total_Harga

  // Row 2: Roti Bakar x2
  assert.equal(rows[1][1], '');           // Kode_Barcode (empty)
  assert.equal(rows[1][2], 'Roti Bakar'); // Nama_Barang
  assert.equal(rows[1][3], 2);           // Qty
  assert.equal(rows[1][4], 18000);       // Harga_Satuan
  assert.equal(rows[1][5], 36000);       // Total_Harga
});

test('handleReceiptCommand shows qty in confirmation when > 1', async () => {
  const mockClient = createMockAiClient([
    { item: 'Nasi Goreng', qty: 2, unit_price: 15000, total_price: 30000 },
  ]);

  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'Sheet1' },
    appendSpend: async () => {},
    aiClient: mockClient,
  });

  assert.match(reply, /Nasi Goreng x2/);
  assert.match(reply, /30\.000/);
});

test('handleReceiptCommand supports customTab override', async () => {
  const mockClient = createMockAiClient([
    { item: 'Lunch', qty: 1, unit_price: 35000, total_price: 35000 },
  ]);

  let appendedOpts = null;
  const mockAppend = async (rows, opts) => {
    appendedOpts = opts;
  };

  await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'DefaultTab' },
    customTab: 'FoodExpenses',
    appendSpend: mockAppend,
    aiClient: mockClient,
  });

  assert.equal(appendedOpts.tab, 'FoodExpenses');
});

test('handleReceiptCommand reports Google Sheet append failure', async () => {
  const mockClient = createMockAiClient([
    { item: 'Coffee', qty: 1, unit_price: 20000, total_price: 20000 },
  ]);

  const reply = await handleReceiptCommand({
    buffer: Buffer.from('fake'),
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'Sheet1' },
    appendSpend: async () => { throw new Error('Permission denied on Google Sheet'); },
    aiClient: mockClient,
  });

  assert.match(reply, /❌ Failed to save to Google Sheet: Permission denied/);
});
