import { jakartaDate } from './parse.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const BAD = "❌ couldn't read items, try a clearer photo";

function validDate(d) {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t) && t.toISOString().slice(0, 10) === d; // rejects 2026-13-40, 2026-02-30
}

const validItem = (it) =>
  typeof it?.name === 'string' && it.name.trim() !== ''
  && typeof it.qty === 'number' && Number.isFinite(it.qty) && it.qty > 0
  && Number.isInteger(it.price)
  && (it.barcode == null || typeof it.barcode === 'string');

// USER_ENTERED would turn these into formulas (#ERROR!); a leading ' keeps them as text.
const text = (s) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

// Returns the reply text; failures become reply text too.
export async function handleReceipt(attachment, createdAt, read, append) {
  if (!TYPES.includes(attachment.contentType)) return 'Attach a photo (jpg, png, webp)';
  if (attachment.size > MAX_BYTES) return `Photo too large (${(attachment.size / 1048576).toFixed(1)} MB), max 5 MB`;

  let receipt;
  try {
    receipt = await read(attachment.url, attachment.contentType);
  } catch (err) {
    console.error('read failed:', err);
    return `❌ not read: ${err.message}`;
  }
  const items = receipt?.items;
  if (!Array.isArray(items) || !items.length || !items.every(validItem)) return BAD;

  const date = validDate(receipt.date) ? receipt.date : jakartaDate(createdAt);
  const rows = items.map(({ barcode, name, qty, price }) => [
    date, barcode?.trim() ? `'${barcode.trim()}` : '', text(name.trim()), qty, price,
  ]);
  try {
    await append(rows);
  } catch (err) {
    console.error('append failed:', err);
    return `❌ not saved: ${err.message}`;
  }

  const sum = Math.round(items.reduce((s, it) => s + it.qty * it.price, 0));
  const header = `✅ ${items.length} items saved · ${date} · Σ ${sum}`;
  const lines = items.map((it) => `${it.name.trim()} ×${it.qty} @${it.price}`);
  const warning = typeof receipt.total === 'number' && receipt.total !== sum
    ? `⚠️ items sum ${sum}, receipt total ${receipt.total}` : null;
  // Drop item lines from the end until the reply fits Discord's 2000-char limit.
  let shown = lines.length;
  const compose = () => [header, ...lines.slice(0, shown), shown < lines.length ? `…and ${lines.length - shown} more` : null, warning]
    .filter((l) => l !== null).join('\n');
  while (compose().length > 2000) shown--;
  return compose();
}
