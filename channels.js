import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

function getChannelsFile() {
  return process.env.CHANNELS_FILE || './data/channels.json';
}

export function parseSpreadsheetId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const urlMatch = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

let storeCache = null;

function loadStore(filePath = getChannelsFile()) {
  if (storeCache) return storeCache;
  if (existsSync(filePath)) {
    try {
      storeCache = JSON.parse(readFileSync(filePath, 'utf8'));
      return storeCache;
    } catch {
      storeCache = {};
      return storeCache;
    }
  }
  storeCache = {};
  return storeCache;
}

function saveStore(store, filePath = getChannelsFile()) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export function getChannelConfig(channelId, filePath = getChannelsFile()) {
  const store = loadStore(filePath);
  if (store[channelId]) {
    return {
      spreadsheetId: store[channelId].spreadsheetId,
      tab: store[channelId].tab || 'Sheet1',
    };
  }

  // Fallback to env vars if channelId matches CHANNEL_ID
  if (process.env.CHANNEL_ID === channelId && process.env.SPREADSHEET_ID) {
    return {
      spreadsheetId: process.env.SPREADSHEET_ID,
      tab: process.env.SHEET_TAB || 'Sheet1',
    };
  }

  return null;
}

export function setChannelConfig(channelId, spreadsheetInput, tab = 'Sheet1', filePath = getChannelsFile()) {
  const spreadsheetId = parseSpreadsheetId(spreadsheetInput);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Sheet URL or spreadsheet ID.');
  }

  const cleanTab = (tab || 'Sheet1').trim() || 'Sheet1';
  const store = loadStore(filePath);
  store[channelId] = {
    spreadsheetId,
    tab: cleanTab,
    updatedAt: new Date().toISOString(),
  };

  saveStore(store, filePath);
  return { spreadsheetId, tab: cleanTab };
}

// Reset cache for testing
export function _resetStoreCache() {
  storeCache = null;
}
