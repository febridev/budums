import { sheets, auth } from '@googleapis/sheets';

// A1 notation: quote the tab name and double any apostrophes in it.
export function rangeFor(tab) {
  return `'${tab.replaceAll("'", "''")}'!A:D`;
}

let client; // created on first append, so importing needs no credentials

export async function appendSpend(row, { spreadsheetId, tab } = {}) {
  client ??= sheets({
    version: 'v4',
    auth: new auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] }),
  });
  const targetId = spreadsheetId || process.env.SPREADSHEET_ID;
  const targetTab = tab || process.env.SHEET_TAB || 'Sheet1';
  await client.spreadsheets.values.append({
    spreadsheetId: targetId,
    range: rangeFor(targetTab),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}
