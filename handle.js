import { parseSpend, jakartaDate } from './parse.js';

// Returns the reply text, or null when the bot should stay silent.
export async function handleSpend(text, createdAt, append, options = {}) {
  if (!text.trim()) return null; // image-only post, or MessageContent intent off
  const spend = parseSpend(text);
  if (!spend) return 'Format: <item> <price> <category>, e.g. jajan kopi 25000 jajan';
  const { item, price, category } = spend;
  const date = jakartaDate(createdAt);
  // Layout for daily spend (same layout as /receipt-daily): Tanggal | Keterangan | Kategori | Jumlah Uang
  try {
    await append([date, item, category, price], {
      ...options,
      columns: options.columns || 'A:D',
    });
  } catch (err) {
    console.error('append failed:', err);
    return `❌ not saved: ${err.message}`;
  }
  return `✅ ${date} | ${price} | ${item} | ${category}`;
}
