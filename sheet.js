import { sheets, auth } from '@googleapis/sheets';

// A1 notation: quote the tab name and double any apostrophes in it.
export function rangeFor(tab, cols = 'A:D') {
  return `'${tab.replaceAll("'", "''")}'!${cols}`;
}

let client; // created on first append, so importing needs no credentials

async function append(spreadsheetId, tab, cols, rows) {
  client ??= sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  });
  await client.spreadsheets.values.append({
    spreadsheetId,
    range: rangeFor(tab, cols),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

export async function appendSpend(row) {
  await append(process.env.SPREADSHEET_ID, process.env.SHEET_TAB, 'A:D', [row]);
}

// All rows of one receipt in one call, so a receipt is saved fully or not at all.
export async function appendReceipt(rows) {
  await append(process.env.RECEIPT_SPREADSHEET_ID, process.env.RECEIPT_SHEET_TAB, 'A:E', rows);
}
