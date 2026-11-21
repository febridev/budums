import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBankStatementFromBuffer,
  handleBankCommand,
  parseAmount,
  normalizeDate,
  escapeText,
} from './bank.js';

function createMockAiClient(responseJson) {
  return {
    models: {
      generateContent: async () => ({
        text: typeof responseJson === 'string' ? responseJson : JSON.stringify(responseJson),
      }),
    },
  };
}

test('parseAmount parses integers, decimals, IDR prefixes, and formatted strings', () => {
  assert.equal(parseAmount(50000), 50000);
  assert.equal(parseAmount('300,329.00'), 300329);
  assert.equal(parseAmount('300.000,00'), 300000);
  assert.equal(parseAmount('Rp 700.000'), 700000);
  assert.equal(parseAmount('IDR 250000'), 250000);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount(null), 0);
});

test('normalizeDate converts DD/MM/YYYY to YYYY-MM-DD or keeps YYYY-MM-DD', () => {
  assert.equal(normalizeDate('2026-11-08', '2026-11-21'), '2026-11-08');
  assert.equal(normalizeDate('08/11/2026', '2026-11-21'), '2026-11-08');
  assert.equal(normalizeDate('10-11-2026', '2026-11-21'), '2026-11-10');
  assert.equal(normalizeDate(null, '2026-11-21'), '2026-11-21');
  assert.equal(normalizeDate('PEND', '2026-11-21'), '2026-11-21');
});

test('escapeText protects formulas starting with =, +, -, @', () => {
  assert.equal(escapeText('=SUM(A1:A5)'), "'=SUM(A1:A5)");
  assert.equal(escapeText('+6281234567'), "'+6281234567");
  assert.equal(escapeText('-100'), "'-100");
  assert.equal(escapeText('@admin'), "'@admin");
  assert.equal(escapeText('Normal transfer'), 'Normal transfer');
});

test('extractBankStatementFromBuffer extracts multiple transactions for BCA', async () => {
  const mockClient = createMockAiClient([
    {
      date: '2026-11-08',
      description: '5379412170773880 TARIKAN ATM 08/11',
      type: 'DB',
      amount: 700000,
      money_in: 0,
      money_out: 700000,
      balance: null,
    },
    {
      date: '2026-11-10',
      description: '1011/FTSCY/WS95031 FLIPTECH LENTERA I TRSF E-BANKING DB',
      type: 'DB',
      amount: 300329,
      money_in: 0,
      money_out: 300329,
      balance: null,
    },
    {
      date: '2026-11-10',
      description: '1011/FTSCY/WS95031 PENI LESTARI TRSF E-BANKING CR',
      type: 'CR',
      amount: 300000,
      money_in: 300000,
      money_out: 0,
      balance: null,
    },
  ]);

  const res = await extractBankStatementFromBuffer(Buffer.from('fake-pdf'), 'application/pdf', {
    bank: 'bca',
    aiClient: mockClient,
  });

  assert.equal(res.length, 3);
  assert.equal(res[0].type, 'DB');
  assert.equal(res[0].moneyOut, 700000);
  assert.equal(res[0].moneyIn, 0);

  assert.equal(res[1].type, 'DB');
  assert.equal(res[1].moneyOut, 300329);
  assert.equal(res[1].moneyIn, 0);

  assert.equal(res[2].type, 'CR');
  assert.equal(res[2].moneyIn, 300000);
  assert.equal(res[2].moneyOut, 0);
});

test('extractBankStatementFromBuffer parses balance when present', async () => {
  const mockClient = createMockAiClient([
    {
      date: '2026-11-10',
      description: 'BUNGA TABUNGAN',
      type: 'CR',
      amount: 15000,
      money_in: 15000,
      money_out: 0,
      balance: 15420000,
    },
  ]);

  const res = await extractBankStatementFromBuffer(Buffer.from('fake-pdf'), 'application/pdf', {
    bank: 'bca',
    aiClient: mockClient,
  });

  assert.equal(res.length, 1);
  assert.equal(res[0].balance, 15420000);
});

test('extractBankStatementFromBuffer throws on error object from model', async () => {
  const mockClient = createMockAiClient({
    error: 'Document is unreadable or not a bank statement',
  });

  await assert.rejects(
    () =>
      extractBankStatementFromBuffer(Buffer.from('fake'), 'application/pdf', {
        aiClient: mockClient,
      }),
    /Document is unreadable/
  );
});

test('handleBankCommand prompts when channel has no Google Sheet configured', async () => {
  const reply = await handleBankCommand({
    buffer: Buffer.from('fake'),
    channelConfig: null,
    appendSpend: async () => {},
  });

  assert.match(reply, /No Google Sheet is configured for this channel yet/);
});

test('handleBankCommand appends rows in Tanggal|Keterangan|Uang Masuk|Uang Keluar|Saldo Akhir Harian format', async () => {
  let savedRows = null;
  let savedOptions = null;

  const mockAppend = async (rows, options) => {
    savedRows = rows;
    savedOptions = options;
  };

  const mockClient = createMockAiClient([
    {
      date: '2026-11-08',
      description: 'TARIKAN ATM 08/11',
      type: 'DB',
      amount: 700000,
      money_in: 0,
      money_out: 700000,
      balance: null,
    },
    {
      date: '2026-11-10',
      description: 'PENI LESTARI TRSF CR',
      type: 'CR',
      amount: 300000,
      money_in: 300000,
      money_out: 0,
      balance: 5000000,
    },
  ]);

  const reply = await handleBankCommand({
    buffer: Buffer.from('fake-pdf'),
    mimeType: 'application/pdf',
    bank: 'bca',
    channelConfig: { spreadsheetId: 'sheet-bca-123', tab: 'BankBCA' },
    appendSpend: mockAppend,
    aiClient: mockClient,
  });

  // Verify Google Sheet append target and range
  assert.equal(savedOptions.spreadsheetId, 'sheet-bca-123');
  assert.equal(savedOptions.tab, 'BankBCA');
  assert.equal(savedOptions.columns, 'A:E');

  // Verify rows: Tanggal | Keterangan | Uang Masuk | Uang Keluar | Saldo Akhir Harian
  assert.equal(savedRows.length, 2);
  assert.deepEqual(savedRows[0], ['2026-11-08', 'TARIKAN ATM 08/11', '', 700000, '']);
  assert.deepEqual(savedRows[1], ['2026-11-10', 'PENI LESTARI TRSF CR', 300000, '', 5000000]);

  // Verify reply message
  assert.match(reply, /Saved 2 transactions from BCA statement!/);
  assert.match(reply, /🔴 -700\.000/);
  assert.match(reply, /🟢 \+300\.000/);
  assert.match(reply, /Uang Masuk: Rp 300\.000/);
  assert.match(reply, /Uang Keluar: Rp 700\.000/);
  assert.match(reply, /BankBCA/);
});

test('handleBankCommand supports customTab override', async () => {
  let savedOptions = null;
  const mockAppend = async (rows, options) => {
    savedOptions = options;
  };

  const mockClient = createMockAiClient([
    {
      date: '2026-11-08',
      description: 'Item 1',
      type: 'DB',
      amount: 10000,
      money_in: 0,
      money_out: 10000,
    },
  ]);

  await handleBankCommand({
    buffer: Buffer.from('fake'),
    mimeType: 'application/pdf',
    bank: 'mandiri',
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'DefaultTab' },
    customTab: 'MandiriNov2026',
    appendSpend: mockAppend,
    aiClient: mockClient,
  });

  assert.equal(savedOptions.tab, 'MandiriNov2026');
});

test('handleBankCommand handles Google Sheet append failure gracefully', async () => {
  const failingAppend = async () => {
    throw new Error('Google Sheet quota exceeded');
  };

  const mockClient = createMockAiClient([
    {
      date: '2026-11-08',
      description: 'Item 1',
      type: 'DB',
      amount: 10000,
      money_in: 0,
      money_out: 10000,
    },
  ]);

  const reply = await handleBankCommand({
    buffer: Buffer.from('fake'),
    mimeType: 'application/pdf',
    bank: 'bca',
    channelConfig: { spreadsheetId: 'sheet-123', tab: 'Bank' },
    appendSpend: failingAppend,
    aiClient: mockClient,
  });

  assert.match(reply, /Failed to save to Google Sheet: Google Sheet quota exceeded/);
});
