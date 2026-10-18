import { sheets, auth } from '@googleapis/sheets';

// A1 notation: quote the tab name and double any apostrophes in it.
export function rangeFor(tab) {
  return `'${tab.replaceAll("'", "''")}'!A:D`;
}

let client; // created on first append, so importing needs no credentials

export async function appendSpend(row) {
  client ??= sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  });
  await client.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: rangeFor(process.env.SHEET_TAB),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}
