import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { handleInteraction, slashCommands } from './commands.js';
import { _resetStoreCache } from './channels.js';

const testFile = './data/test_commands_channels.json';

beforeEach(() => {
  process.env.CHANNELS_FILE = testFile;
  _resetStoreCache();
  delete process.env.CHANNEL_ID;
  delete process.env.SPREADSHEET_ID;
  delete process.env.SHEET_TAB;
});

afterEach(() => {
  _resetStoreCache();
  if (existsSync(testFile)) rmSync(testFile);
  delete process.env.CHANNELS_FILE;
});

test('slashCommands exports 5 commands', () => {
  assert.equal(slashCommands.length, 5);
  const names = slashCommands.map((c) => c.name);
  assert.deepEqual(names, ['receipt', 'receipt-daily', 'bank', 'set-sheet', 'current-sheet']);
});

test('handleInteraction set-sheet configures channel and replies', async () => {
  let replied = null;
  const mockOptions = {
    sheet: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    tab: 'Nov2026',
  };
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'set-sheet',
    channelId: 'chan-set-test',
    options: {
      getString: (key) => mockOptions[key] || null,
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Google Sheet configured for this channel/);
  assert.match(replied.content, /1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/);
  assert.match(replied.content, /Nov2026/);
});

test('handleInteraction set-sheet with sheet_name reuses default SPREADSHEET_ID', async () => {
  process.env.SPREADSHEET_ID = 'sheet-env-default-12345';
  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'set-sheet',
    channelId: 'chan-food',
    options: {
      getString: (key) => (key === 'sheet_name' ? 'FoodExpenses' : null),
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Google Sheet configured for this channel/);
  assert.match(replied.content, /FoodExpenses/);
  assert.match(replied.content, /sheet-env-default-12345/);
});

test('handleInteraction current-sheet returns warning when not set', async () => {
  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'current-sheet',
    channelId: 'chan-not-set',
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /No Google Sheet is configured for this channel yet/);
});

test('handleInteraction receipt warns if channel is not configured', async () => {
  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'receipt',
    channelId: 'chan-unconfigured',
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /No Google Sheet is configured for this channel yet/);
});

test('handleInteraction receipt rejects non-image attachment', async () => {
  process.env.CHANNEL_ID = 'chan-img-test';
  process.env.SPREADSHEET_ID = 'sheet-123456789012345';
  process.env.SHEET_TAB = 'Sheet1';

  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'receipt',
    channelId: 'chan-img-test',
    options: {
      getAttachment: () => ({ contentType: 'application/pdf', url: 'https://example.com/doc.pdf' }),
      getString: () => null,
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Please upload a valid image file/);
});

test('handleInteraction receipt-daily warns if channel is not configured', async () => {
  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'receipt-daily',
    channelId: 'chan-unconfigured-daily',
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /No Google Sheet is configured for this channel yet/);
});

test('handleInteraction receipt-daily rejects non-image attachment', async () => {
  process.env.CHANNEL_ID = 'chan-daily-test';
  process.env.SPREADSHEET_ID = 'sheet-123456789012345';
  process.env.SHEET_TAB = 'Sheet1';

  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'receipt-daily',
    channelId: 'chan-daily-test',
    options: {
      getAttachment: () => ({ contentType: 'application/pdf', url: 'https://example.com/doc.pdf' }),
      getString: () => null,
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Please upload a valid image file/);
});

test('handleInteraction bank warns if channel is not configured', async () => {
  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'bank',
    channelId: 'chan-unconfigured-bank',
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /No Google Sheet is configured for this channel yet/);
});

test('handleInteraction bank rejects missing attachment', async () => {
  process.env.CHANNEL_ID = 'chan-bank-test';
  process.env.SPREADSHEET_ID = 'sheet-123456789012345';
  process.env.SHEET_TAB = 'Sheet1';

  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'bank',
    channelId: 'chan-bank-test',
    options: {
      getAttachment: () => null,
      getString: () => 'bca',
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Please upload a bank statement PDF or image file/);
});

test('handleInteraction bank rejects invalid attachment type', async () => {
  process.env.CHANNEL_ID = 'chan-bank-test';
  process.env.SPREADSHEET_ID = 'sheet-123456789012345';
  process.env.SHEET_TAB = 'Sheet1';

  let replied = null;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'bank',
    channelId: 'chan-bank-test',
    options: {
      getAttachment: () => ({ contentType: 'text/plain', name: 'statement.txt', url: 'https://example.com/file.txt' }),
      getString: () => 'bca',
    },
    reply: async (data) => {
      replied = data;
    },
  };

  await handleInteraction(interaction);
  assert.match(replied.content, /Please upload a valid PDF or image file/);
});

test('handleInteraction bank processes statement and edits reply', async () => {
  process.env.CHANNEL_ID = 'chan-bank-success';
  process.env.SPREADSHEET_ID = 'sheet-bca-success';
  process.env.SHEET_TAB = 'BCA';

  let deferred = false;
  let edited = null;
  let appended = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => Buffer.from('%PDF-1.4 fake'),
  });

  const mockAiClient = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify([
          {
            date: '2026-11-08',
            description: 'TARIKAN ATM 08/11',
            type: 'DB',
            amount: 700000,
            money_in: 0,
            money_out: 700000,
            balance: null,
          },
        ]),
      }),
    },
  };

  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'bank',
    channelId: 'chan-bank-success',
    createdAt: new Date('2026-11-21T12:00:00Z'),
    options: {
      getAttachment: () => ({
        contentType: 'application/pdf',
        name: 'bca-mutasi.pdf',
        url: 'https://cdn.discordapp.com/attachments/1/2/bca-mutasi.pdf',
      }),
      getString: (key) => (key === 'bank' ? 'bca' : null),
    },
    deferReply: async () => {
      deferred = true;
    },
    editReply: async (data) => {
      edited = data;
    },
  };

  try {
    await handleInteraction(interaction, {
      appendSpend: async (rows, options) => {
        appended = { rows, options };
      },
      aiClient: mockAiClient,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(deferred, true);
  assert.match(edited, /Saved 1 transaction from BCA statement!/);
  assert.match(edited, /TARIKAN ATM 08\/11/);
  assert.equal(appended.options.spreadsheetId, 'sheet-bca-success');
  assert.equal(appended.options.tab, 'BCA');
  assert.equal(appended.options.columns, 'A:E');
  assert.deepEqual(appended.rows, [['2026-11-08', 'TARIKAN ATM 08/11', '', 700000, '']]);
});


