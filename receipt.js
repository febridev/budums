import { GoogleGenAI } from '@google/genai';
import { jakartaDate } from './parse.js';

let defaultAiClient = null;

function getAiClient(apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }
  defaultAiClient ??= new GoogleGenAI({ apiKey: key });
  return defaultAiClient;
}

const RECEIPT_PROMPT = `
Analyze this receipt image and extract spending information.
Return JSON with the following fields:
- "item": A short, clean summary of what was purchased or merchant name (e.g. "Kopi Kenangan", "Indomaret", "Makan Siang"). Keep it concise.
- "price": The total final price as an integer number only (e.g. 25000). No currency symbols, dots, commas, or decimals.
- "category": A single-word category describing the spend, such as "jajan", "makan", "belanja", "transport", "tagihan", "kesehatan", "hiburan", or "lainnya".
- "date": Date printed on receipt in YYYY-MM-DD format if visible, otherwise null.

If this image is not a receipt or the total cannot be found, return:
{ "error": "Image is not a receipt or total price could not be found" }
`.trim();

export async function extractReceiptFromBuffer(buffer, mimeType = 'image/jpeg', options = {}) {
  const client = options.aiClient || getAiClient(options.apiKey);
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash';

  const base64Data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : buffer;

  const response = await client.models.generateContent({
    model,
    contents: [
      { text: RECEIPT_PROMPT },
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Empty response received from Gemini model.');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse model output: ${err.message}. Output was: ${text}`);
  }

  // If Gemini returned an array of items, pick the first or combined
  if (Array.isArray(data)) {
    data = data[0];
  }

  if (!data || data.error) {
    throw new Error(data?.error || 'Could not extract valid receipt details.');
  }

  const rawPrice = data.price;
  const numPrice = typeof rawPrice === 'number' ? Math.round(rawPrice) : parseInt(String(rawPrice).replace(/\D/g, ''), 10);
  if (!numPrice || Number.isNaN(numPrice) || numPrice <= 0) {
    throw new Error('Could not identify a valid total price from this receipt.');
  }

  const item = (options.customItem || data.item || 'Belanja').trim();
  const category = (options.customCategory || data.category || 'lainnya').trim().toLowerCase();
  const date = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;

  return {
    item,
    price: numPrice,
    category,
    date,
  };
}

export async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image from Discord (${res.status} ${res.statusText})`);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType.split(';')[0].trim(),
  };
}

export async function handleReceiptCommand({
  imageUrl,
  buffer,
  mimeType,
  createdAt = new Date(),
  channelConfig,
  appendSpend,
  customCategory,
  customItem,
  aiClient,
}) {
  if (!channelConfig || !channelConfig.spreadsheetId) {
    return (
      '⚠️ **No Google Sheet is configured for this channel yet.**\n' +
      'Please set one first using `/set-sheet`:\n' +
      '`/set-sheet sheet:<Google Sheet URL or ID> tab:<Tab Name>`\n\n' +
      '*The bot will remember it for this channel so you only have to do this once!*'
    );
  }

  let imgBuffer = buffer;
  let imgMime = mimeType || 'image/jpeg';

  if (!imgBuffer && imageUrl) {
    const downloaded = await downloadImage(imageUrl);
    imgBuffer = downloaded.buffer;
    imgMime = downloaded.mimeType;
  }

  if (!imgBuffer) {
    return '❌ Please attach an image of your receipt.';
  }

  let extracted;
  try {
    extracted = await extractReceiptFromBuffer(imgBuffer, imgMime, {
      customCategory,
      customItem,
      aiClient,
    });
  } catch (err) {
    return `❌ Could not read receipt: ${err.message}`;
  }

  const date = extracted.date || jakartaDate(createdAt);
  const { price, item, category } = extracted;

  try {
    await appendSpend([date, price, item, category], {
      spreadsheetId: channelConfig.spreadsheetId,
      tab: channelConfig.tab,
    });
  } catch (err) {
    console.error('appendSpend failed:', err);
    return `❌ Failed to save to Google Sheet: ${err.message}`;
  }

  return `✅ **Saved!** ${date} | ${price} | ${item} | ${category}\n*(Spreadsheet: \`${channelConfig.spreadsheetId.slice(0, 6)}...\` | Tab: \`${channelConfig.tab}\`)*`;
}
