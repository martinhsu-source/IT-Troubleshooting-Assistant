import { OAuth2Client } from 'google-auth-library';

// --- CSV fallback parser (used when OAuth is not yet configured) ---
function parseCSVLine(line) {
  const result = [];
  let cell = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cell.trim()); cell = ''; }
    else { cell += ch; }
  }
  result.push(cell.trim());
  return result;
}

// --- Column mapper: fuzzy-match header names to TroubleshootingRecord fields ---
function findCol(headers, ...patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(p.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function mapRowsToRecords(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(h => String(h || '').trim());

  const idIdx  = findCol(headers, 'TR-', 'TR No', 'TR_NO', 'Ticket', 'NO.', 'ID');
  const dateIdx = findCol(headers, 'DATE', 'Date', '日期');
  const catIdx  = findCol(headers, 'CATEGORY', 'Category', 'TYPE', 'Type', 'CAT');
  const issueIdx = findCol(headers, 'DESCRIPTION', 'Description', 'ISSUE', 'Issue', 'Problem', 'REMARKS', 'Subject');
  const solIdx   = findCol(headers, 'RESOLUTION', 'Resolution', 'SOLUTION', 'Solution', 'ACTION', 'FIX');
  const statusIdx = findCol(headers, 'STATUS', 'Status', 'State');

  return values.slice(1).map(row => {
    const get = i => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
    const id = get(idIdx);
    if (!id) return null;

    const rawStatus = get(statusIdx).toLowerCase();
    let status = 'Resolved';
    if (rawStatus.includes('pending') || rawStatus.includes('open')) status = 'Pending';
    else if (rawStatus.includes('escalat')) status = 'Escalated';

    return {
      id,
      date: get(dateIdx),
      category: get(catIdx) || 'General',
      issue: get(issueIdx),
      solution: get(solIdx),
      status,
    };
  }).filter(r => r && r.id && (r.issue || r.solution));
}

// --- OAuth2 token helper ---
function makeAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;

  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return client;
}

async function getAccessToken(client) {
  const { token } = await client.getAccessToken();
  return token;
}

// Find the tab title from a numeric gid
async function resolveTabName(token, sheetId, gid) {
  if (!gid) return null;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const tab = data.sheets?.find(s => s.properties?.sheetId === Number(gid));
  return tab?.properties?.title ?? null;
}

async function fetchSheetValues(token, sheetId, gid) {
  const tabName = await resolveTabName(token, sheetId, gid);
  const range = tabName ? encodeURIComponent(`${tabName}!A:Z`) : 'A%3AZ';

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    console.error(`Sheet ${sheetId} fetch error: ${res.status} ${await res.text()}`);
    return [];
  }
  const data = await res.json();
  return data.values ?? [];
}

// --- Handler ---
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    SHEET_ID, SHEET_GID,
    SHEET_ID_ARCHIVE, SHEET_GID_ARCHIVE,
  } = process.env;

  if (!SHEET_ID) {
    return res.status(200).json({ records: [], message: 'SHEET_ID not configured' });
  }

  const authClient = makeAuthClient();
  if (!authClient) {
    return res.status(200).json({
      records: [],
      message: 'Google OAuth not configured yet. Run scripts/get-google-token.js to set up.',
    });
  }

  try {
    const token = await getAccessToken(authClient);

    // Fetch current + archive sheets in parallel
    const fetches = [fetchSheetValues(token, SHEET_ID, SHEET_GID)];
    if (SHEET_ID_ARCHIVE) {
      fetches.push(fetchSheetValues(token, SHEET_ID_ARCHIVE, SHEET_GID_ARCHIVE));
    }

    const results = await Promise.allSettled(fetches);

    const archiveRecords = results[1]?.status === 'fulfilled'
      ? mapRowsToRecords(results[1].value)
      : [];
    const currentRecords = results[0]?.status === 'fulfilled'
      ? mapRowsToRecords(results[0].value)
      : [];

    // Archive first (older), current last (newer)
    const allRecords = [...archiveRecords, ...currentRecords].slice(-300);

    return res.status(200).json({ records: allRecords, total: allRecords.length });
  } catch (error) {
    console.error('Records error:', error);
    return res.status(500).json({ error: error.message, records: [] });
  }
}
