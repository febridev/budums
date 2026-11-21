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
Analyze this receipt image and extract EVERY individual line item purchased.

Return a JSON array where each element has:
- "item": The name of the individual product or item exactly as printed (e.g. "Es Kopi Susu", "Roti Bakar Coklat", "Nasi Goreng"). Keep the original name, do NOT summarize multiple items into one.
- "category": A short expense category in Indonesian for this item (e.g. "makanan", "minuman", "belanja", "jajan", "transportasi", "kebutuhan").
- "qty": The quantity purchased (integer, default 1 if not shown).
- "unit_price": The price per single unit as an integer (e.g. 15000). No currency symbols, dots, commas, or decimals.
- "total_price": The line total as an integer (qty × unit_price, e.g. 30000 for 2x 15000).
- "date": Date printed on receipt in YYYY-MM-DD format if visible, otherwise null. Use the same date for all items.

Important rules:
- Extract each purchased item as a separate entry in the array.
- Do NOT include subtotals, totals, tax lines, discounts, or payment method lines as items.
- If there is only one item, still return an array with one element.
- If qty is not shown, assume 1 and set unit_price = total_price.

Example output:
[
  { "item": "Es Kopi Susu", "category": "minuman", "qty": 1, "unit_price": 24000, "total_price": 24000, "date": "2026-11-17" },
  { "item": "Roti Bakar Coklat", "category": "makanan", "qty": 2, "unit_price": 18000, "total_price": 36000, "date": "2026-11-17" }
]

If this image is not a receipt or no items can be found, return:
{ "error": "Image is not a receipt or items could not be found" }
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

  // Handle error response
  if (!Array.isArray(data)) {
    if (data && data.error) {
      throw new Error(data.error);
    }
    // Single object → wrap in array
    data = [data];
  }

  if (data.length === 0) {
    throw new Error('No items found on the receipt.');
  }

  const items = [];
  for (const entry of data) {
    if (!entry || entry.error) continue;

    const qty = Math.max(1, parseInt(entry.qty, 10) || 1);

    // Parse unit_price
    const rawUnit = entry.unit_price;
    const unitPrice = typeof rawUnit === 'number' ? Math.round(rawUnit) : parseInt(String(rawUnit).replace(/\D/g, ''), 10);

    // Parse total_price (fallback: qty * unit_price)
    const rawTotal = entry.total_price;
    let totalPrice = typeof rawTotal === 'number' ? Math.round(rawTotal) : parseInt(String(rawTotal || '').replace(/\D/g, ''), 10);
    if (!totalPrice || Number.isNaN(totalPrice) || totalPrice <= 0) {
      totalPrice = (unitPrice || 0) * qty;
    }

    // Derive unit_price from total if missing
    const finalUnit = (unitPrice && unitPrice > 0) ? unitPrice : Math.round(totalPrice / qty);

    if (!totalPrice || totalPrice <= 0) continue;

    const rawCategory = entry.category;
    const category = (
      options.customCategory ||
      (typeof rawCategory === 'string' && rawCategory.trim() ? rawCategory.trim() : 'belanja')
    );

    items.push({
      item: (options.customItem || entry.item || 'Belanja').trim(),
      category,
      qty,
      unitPrice: finalUnit,
      totalPrice,
      date: entry.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : null,
    });
  }

  if (items.length === 0) {
    throw new Error('Could not identify any valid items with prices from this receipt.');
  }

  return items;
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
  customTab,
  aiClient,
  layout = 'standard',
}) {
  if (!channelConfig || !channelConfig.spreadsheetId) {
    return (
      '⚠️ **No Google Sheet is configured for this channel yet.**\n' +
      'Please set one first using `/set-sheet`:\n' +
      '`/set-sheet sheet_name:<Sheet/Tab Name> [url:<Google Sheet URL>]`\n\n' +
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

  let items;
  try {
    items = await extractReceiptFromBuffer(imgBuffer, imgMime, {
      customCategory,
      customItem,
      aiClient,
    });
  } catch (err) {
    return `❌ Could not read receipt: ${err.message}`;
  }

  const fallbackDate = jakartaDate(createdAt);
  const targetTab = (customTab || channelConfig.tab || 'Sheet1').trim();

  let rows;
  let columns = 'A:F';

  if (layout === 'daily') {
    // Layout for /receipt-daily: Tanggal | Keterangan | Kategori | Jumlah Uang
    columns = 'A:D';
    rows = items.map((it) => [
      it.date || fallbackDate,
      it.item,
      customCategory || it.category || 'belanja',
      it.totalPrice,
    ]);
  } else {
    // Layout for /receipt: TGL | Kode_Barcode | Nama_Barang | Qty | Harga_Satuan | Total_Harga
    rows = items.map((it) => [
      it.date || fallbackDate,
      '',  // Kode_Barcode (empty)
      it.item,
      it.qty,
      it.unitPrice,
      it.totalPrice,
    ]);
  }

  try {
    await appendSpend(rows, {
      spreadsheetId: channelConfig.spreadsheetId,
      tab: targetTab,
      columns,
    });
  } catch (err) {
    console.error('appendSpend failed:', err);
    return `❌ Failed to save to Google Sheet: ${err.message}`;
  }

  // Build confirmation message listing every item
  const grandTotal = items.reduce((sum, it) => sum + it.totalPrice, 0);
  const lines = items.map((it) => {
    const qtyStr = it.qty > 1 ? ` x${it.qty}` : '';
    const catStr = layout === 'daily' ? ` (${it.category})` : '';
    return `  • ${it.item}${qtyStr}${catStr} — ${it.totalPrice.toLocaleString('id-ID')}`;
  });

  return (
    `✅ **Saved ${items.length} item${items.length > 1 ? 's' : ''}!**\n` +
    lines.join('\n') + '\n' +
    `  **Total: ${grandTotal.toLocaleString('id-ID')}**\n` +
    `*(Sheet: \`${targetTab}\`)*`
  );
}

export async function handleReceiptDailyCommand(options) {
  return handleReceiptCommand({ ...options, layout: 'daily' });
}
