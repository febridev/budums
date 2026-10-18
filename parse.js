// "<item...> <price> <category>", e.g. "jajan kopi 25000 jajan"
export function parseSpend(text) {
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return null;
  const category = words.pop();
  const price = words.pop();
  if (!/^\d+$/.test(price)) return null;
  return { item: words.join(' '), price: Number(price), category };
}

// en-CA formats as YYYY-MM-DD
const jakarta = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });

export function jakartaDate(date) {
  return jakarta.format(date);
}
