const PROMPT = `Read this shopping receipt and return its line items.
Return one entry per purchased line, with price as the UNIT price in rupiah (an integer).
Put each discount on its own entry with qty 1 and a negative price.
Leave out subtotal, tax, payment, change and loyalty-point lines.
Set barcode to the printed barcode or PLU, or null if there is none.
Set date to the receipt date as YYYY-MM-DD, or null if unreadable.
Set total to the final amount paid, or null if unreadable.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['date', 'total', 'items'],
  properties: {
    date: { type: ['string', 'null'] },
    total: { type: ['integer', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['barcode', 'name', 'qty', 'price'],
        properties: {
          barcode: { type: ['string', 'null'] },
          name: { type: 'string' },
          qty: { type: 'number' },
          price: { type: 'integer' },
        },
      },
    },
  },
};

// Returns the parsed receipt, or null when the model's content is not JSON. Throws on network/API errors.
export async function readReceipt(url, contentType) {
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`download ${img.status}`);
  // base64, so reading doesn't depend on the provider fetching Discord's signed CDN links
  const dataUrl = `data:${contentType};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] }],
      response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema: SCHEMA } },
      provider: { require_parameters: true }, // only route to providers that honour the schema
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.error?.message}`);
  try {
    return JSON.parse(body.choices[0].message.content);
  } catch {
    return null;
  }
}
