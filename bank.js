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

// USER_ENTERED would turn these into formulas (#ERROR!); a leading ' keeps them as text.
export const escapeText = (s) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

export function parseAmount(val) {
  if (typeof val === 'number') return Math.abs(val);
  if (!val) return 0;
  let s = String(val).trim().replace(/^(IDR|Rp)\s*/i, '');
  // Format like 300,329.00 (comma thousands, dot decimal)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '');
    return parseFloat(s) || 0;
  }
  // Format like 300.329,00 (dot thousands, comma decimal)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }
  // Fallback: strip anything other than digits and decimal point
  const cleaned = s.replace(/[^\d.]/g, '');
  return parseFloat(cleaned) || 0;
}

export function normalizeDate(d, fallbackDate) {
  if (typeof d === 'string') {
    const trimmed = d.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      const year = dmy[3];
      return `${year}-${month}-${day}`;
    }
  }
  return fallbackDate;
}

function buildBankPrompt(bankName = 'BCA') {
  return `
You are an expert financial assistant analyzing a bank statement document (PDF or image).
The document is a bank statement or mutasi rekening from bank: "${bankName}".

Extract EVERY individual transaction listed in the statement.

For each transaction, extract:
- "date": The date of the transaction in YYYY-MM-DD format (e.g., "2026-11-08"). If printed as DD/MM/YYYY or DD/MM, convert to YYYY-MM-DD. If the date is marked as "PEND" (pending / today's transaction in BCA), determine the date from the description/reference code (e.g. "1011/..." indicates 10 November) or use the statement period end date.
- "description": The full description or keterangan of the transaction. Clean up extra line breaks and merge multi-line notes into a single line. Preserve sender/recipient, channel (e.g. TRSF E-BANKING, TARIKAN ATM), and reference numbers.
- "type": "CR" for Credit / Uang Masuk (money coming into the account), or "DB" for Debit / Uang Keluar (money leaving the account).
  * In Indonesian bank statements (BCA, Mandiri, BRI, BNI, etc.):
    - DB / D / Debit = Uang Keluar (transfers out, ATM cash withdrawals, payments, fees, card purchases)
    - CR / C / Kredit = Uang Masuk (transfers in, salary, deposits, interest)
- "amount": The transaction amount as a positive number (no currency symbols, dots, commas, or DB/CR letters).
- "money_in": The amount if this transaction is Credit / Uang Masuk (CR), otherwise 0.
- "money_out": The amount if this transaction is Debit / Uang Keluar (DB), otherwise 0.
- "balance": The daily ending balance or balance (Saldo Akhir Harian / Saldo) after this transaction if printed in the statement, otherwise null.

Important rules:
- Extract all transactions in chronological order (from oldest date to newest date). If the statement lists transactions newest-first, reverse them so that earlier transactions come first.
- Do NOT include beginning balance (saldo awal), summary totals, or statement headers as transactions.
- Always ensure each transaction has either money_in > 0 or money_out > 0.

Example output:
[
  {
    "date": "2026-11-08",
    "description": "5379412170773880 TARIKAN ATM 08/11",
    "type": "DB",
    "amount": 700000,
    "money_in": 0,
    "money_out": 700000,
    "balance": null
  },
  {
    "date": "2026-11-10",
    "description": "1011/FTSCY/WS95031 FLIPTECH LENTERA I TRSF E-BANKING DB",
    "type": "DB",
    "amount": 300329,
    "money_in": 0,
    "money_out": 300329,
    "balance": null
  },
  {
    "date": "2026-11-10",
    "description": "1011/FTSCY/WS95031 PENI LESTARI TRSF E-BANKING CR",
    "type": "CR",
    "amount": 300000,
    "money_in": 300000,
    "money_out": 0,
    "balance": null
  }
]

If this document is not a bank statement or no transactions could be found, return:
{ "error": "Document is not a bank statement or no transactions could be found" }
`.trim();
}

export async function extractBankStatementFromBuffer(buffer, mimeType = 'application/pdf', options = {}) {
  const client = options.aiClient || getAiClient(options.apiKey);
  const model = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const bank = options.bank || 'BCA';

  const base64Data = Buffer.isBuffer(buffer) ? buffer.toString('base64') : buffer;
  const prompt = buildBankPrompt(bank);

  const response = await client.models.generateContent({
    model,
    contents: [
      { text: prompt },
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

  if (!Array.isArray(data)) {
    if (data && data.error) {
      throw new Error(data.error);
    }
    data = [data];
  }

  if (data.length === 0) {
    throw new Error('No transactions found in the bank statement.');
  }

  const transactions = [];
  for (const entry of data) {
    if (!entry || entry.error) continue;

    const totalAmount = parseAmount(entry.amount);
    let moneyIn = parseAmount(entry.money_in);
    let moneyOut = parseAmount(entry.money_out);

    const type = String(entry.type || '').toUpperCase();
    if (type === 'CR' || type === 'CREDIT' || type === 'KREDIT' || type === 'MASUK') {
      if (!moneyIn && totalAmount) moneyIn = totalAmount;
      moneyOut = 0;
    } else if (type === 'DB' || type === 'DEBIT' || type === 'DEBET' || type === 'KELUAR') {
      if (!moneyOut && totalAmount) moneyOut = totalAmount;
      moneyIn = 0;
    } else {
      if (moneyIn > 0 && !moneyOut) {
        // credit
      } else if (moneyOut > 0 && !moneyIn) {
        // debit
      } else if (totalAmount > 0) {
        // fallback default debit if unspecified
        moneyOut = totalAmount;
      }
    }

    if (moneyIn <= 0 && moneyOut <= 0) continue;

    let balance = null;
    if (entry.balance !== null && entry.balance !== undefined && entry.balance !== '') {
      const b = parseAmount(entry.balance);
      if (!Number.isNaN(b)) {
        balance = b;
      }
    }

    const description = (entry.description || '').trim();
    if (!description) continue;

    transactions.push({
      date: entry.date && typeof entry.date === 'string' ? entry.date.trim() : null,
      description,
      type: moneyIn > 0 ? 'CR' : 'DB',
      amount: moneyIn > 0 ? moneyIn : moneyOut,
      moneyIn,
      moneyOut,
      balance,
    });
  }

  if (transactions.length === 0) {
    throw new Error('Could not identify any valid transactions from this bank statement.');
  }

  return transactions;
}

export async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download file from Discord (${res.status} ${res.statusText})`);
  }
  const contentType = res.headers.get('content-type') || 'application/pdf';
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType.split(';')[0].trim(),
  };
}

export async function handleBankCommand({
  fileUrl,
  fileName,
  fileContentType,
  buffer,
  mimeType,
  bank = 'bca',
  createdAt = new Date(),
  channelConfig,
  appendSpend,
  customTab,
  aiClient,
}) {
  if (!channelConfig || !channelConfig.spreadsheetId) {
    return (
      '⚠️ **No Google Sheet is configured for this channel yet.**\n' +
      'Please set one first using `/set-sheet`:\n' +
      '`/set-sheet sheet_name:<Sheet/Tab Name> [url:<Google Sheet URL>]`\n\n' +
      '*The bot will remember it for this channel so you only have to do this once!*'
    );
  }

  let docBuffer = buffer;
  let docMime = mimeType;

  if (!docBuffer && fileUrl) {
    const downloaded = await downloadFile(fileUrl);
    docBuffer = downloaded.buffer;
    docMime = downloaded.mimeType;
  }

  if (!docBuffer) {
    return '❌ Please attach a bank statement file (PDF or image).';
  }

  // Refine MIME type if generic
  if (!docMime || docMime === 'application/octet-stream') {
    if (fileName?.toLowerCase().endsWith('.pdf')) {
      docMime = 'application/pdf';
    } else if (fileContentType && fileContentType !== 'application/octet-stream') {
      docMime = fileContentType;
    } else {
      docMime = 'application/pdf';
    }
  }

  let transactions;
  try {
    transactions = await extractBankStatementFromBuffer(docBuffer, docMime, {
      bank,
      aiClient,
    });
  } catch (err) {
    return `❌ Could not read bank statement: ${err.message}`;
  }

  const fallbackDate = jakartaDate(createdAt);
  const targetTab = (customTab || channelConfig.tab || 'Sheet1').trim();

  // Template: Tanggal | Keterangan | Uang Masuk | Uang Keluar | Saldo Akhir Harian
  const rows = transactions.map((t) => [
    normalizeDate(t.date, fallbackDate),
    escapeText(t.description),
    t.moneyIn > 0 ? t.moneyIn : '',
    t.moneyOut > 0 ? t.moneyOut : '',
    t.balance !== null ? t.balance : '',
  ]);

  try {
    await appendSpend(rows, {
      spreadsheetId: channelConfig.spreadsheetId,
      tab: targetTab,
      columns: 'A:E',
    });
  } catch (err) {
    console.error('appendSpend failed:', err);
    return `❌ Failed to save to Google Sheet: ${err.message}`;
  }

  const grandMoneyIn = transactions.reduce((sum, t) => sum + (t.moneyIn || 0), 0);
  const grandMoneyOut = transactions.reduce((sum, t) => sum + (t.moneyOut || 0), 0);

  const bankNameUpper = bank.toUpperCase();
  const header = `✅ **Saved ${transactions.length} transaction${transactions.length > 1 ? 's' : ''} from ${bankNameUpper} statement!**`;

  const lines = transactions.map((t) => {
    if (t.moneyIn > 0) {
      return `  🟢 +${t.moneyIn.toLocaleString('id-ID')} — ${t.description}`;
    }
    return `  🔴 -${t.moneyOut.toLocaleString('id-ID')} — ${t.description}`;
  });

  const summary = [
    `📥 **Uang Masuk: Rp ${grandMoneyIn.toLocaleString('id-ID')}**`,
    `📤 **Uang Keluar: Rp ${grandMoneyOut.toLocaleString('id-ID')}**`,
    `*(Sheet: \`${targetTab}\`)*`,
  ].join('\n');

  // Ensure message stays within Discord's 2000 character limit
  let shown = lines.length;
  const compose = () => {
    const list = lines.slice(0, shown);
    const more = shown < lines.length ? `  …and ${lines.length - shown} more transactions` : null;
    return [header, ...list, more, summary].filter(Boolean).join('\n');
  };

  while (compose().length > 2000 && shown > 0) {
    shown--;
  }

  return compose();
}
