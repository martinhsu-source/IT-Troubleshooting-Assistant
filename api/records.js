// --- CSV / column helpers ---
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
  const idIdx   = findCol(headers, 'TR-', 'TR No', 'TR_NO', 'Ticket', 'NO.', 'ID');
  const dateIdx = findCol(headers, 'DATE', 'Date', '日期');
  const catIdx  = findCol(headers, 'CATEGORY', 'Category', 'TYPE', 'Type');
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
    return { id, date: get(dateIdx), category: get(catIdx) || 'General', issue: get(issueIdx), solution: get(solIdx), status };
  }).filter(r => r && r.id && (r.issue || r.solution));
}

// --- OAuth: direct HTTP token exchange (no library dependency) ---
async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google OAuth env vars not set');
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`OAuth token error: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

// --- Sheets API helpers ---
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
    const err = await res.json().catch(() => ({}));
    console.error(`Sheet ${sheetId} error:`, err);
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

  const { SHEET_ID, SHEET_GID, SHEET_ID_ARCHIVE, SHEET_GID_ARCHIVE } = process.env;
  if (!SHEET_ID) return res.status(200).json({ records: [], message: 'SHEET_ID not configured' });

  try {
    const token = await getAccessToken();

    const fetches = [fetchSheetValues(token, SHEET_ID, SHEET_GID)];
    if (SHEET_ID_ARCHIVE) fetches.push(fetchSheetValues(token, SHEET_ID_ARCHIVE, SHEET_GID_ARCHIVE));

    const results = await Promise.allSettled(fetches);

    const currentRecords = results[0]?.status === 'fulfilled' ? mapRowsToRecords(results[0].value) : [];
    const archiveRecords = results[1]?.status === 'fulfilled' ? mapRowsToRecords(results[1].value) : [];

    const allRecords = [...archiveRecords, ...currentRecords].slice(-300);
    return res.status(200).json({ records: allRecords, total: allRecords.length });

  } catch (error) {
    console.error('Records error:', error.message);
    return res.status(500).json({ error: error.message, records: [] });
  }
}
