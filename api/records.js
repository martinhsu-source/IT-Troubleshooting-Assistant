import { createSign } from 'crypto';

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

function findHeaderRowIndex(values) {
  // Scan first 5 rows; pick the one with the most column-name matches
  const probes = ['no', 'date', 'category', 'type', 'description', 'issue',
                  'resolution', 'solution', 'status', 'remarks', 'action'];
  let best = 0, bestScore = 0;
  for (let i = 0; i < Math.min(5, values.length); i++) {
    const row = values[i].map(h => String(h || '').toLowerCase());
    const score = probes.filter(p => row.some(h => h.includes(p))).length;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function mapRowsToRecords(values) {
  if (!values || values.length < 2) return [];
  const headerIdx = findHeaderRowIndex(values);
  const headers = values[headerIdx].map(h => String(h || '').trim());
  const idIdx   = findCol(headers, 'TR-', 'TR No', 'TR_NO', 'Ticket', 'NO.', 'ID');
  const dateIdx = findCol(headers, 'DATE', 'Date', '日期');
  const catIdx  = findCol(headers, 'CATEGORY', 'Category', 'TYPE', 'Type');
  const issueIdx = findCol(headers, 'DESCRIPTION', 'Description', 'ISSUE', 'Issue', 'Problem', 'REMARKS', 'Subject');
  const solIdx   = findCol(headers, 'RESOLUTION', 'Resolution', 'SOLUTION', 'Solution', 'ACTION', 'FIX');
  const statusIdx = findCol(headers, 'STATUS', 'Status', 'State');

  return values.slice(headerIdx + 1).map(row => {
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

// --- Service Account JWT auth ---
async function getServiceAccountToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');

  const sa = JSON.parse(raw);
  const privateKey = sa.private_key.replace(/\\n/g, '\n');
  const clientEmail = sa.client_email;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const input   = `${header}.${payload}`;

  const sign = createSign('RSA-SHA256');
  sign.update(input);
  const sig = sign.sign(privateKey, 'base64url');
  const jwt = `${input}.${sig}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`SA token error: ${data.error} — ${data.error_description}`);
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
    const token = await getServiceAccountToken();

    const fetches = [fetchSheetValues(token, SHEET_ID, SHEET_GID)];
    if (SHEET_ID_ARCHIVE) fetches.push(fetchSheetValues(token, SHEET_ID_ARCHIVE, SHEET_GID_ARCHIVE));

    const results = await Promise.allSettled(fetches);

    const currentRecords = results[0]?.status === 'fulfilled' ? mapRowsToRecords(results[0].value) : [];
    const archiveRecords = results[1]?.status === 'fulfilled' ? mapRowsToRecords(results[1].value) : [];

    const allRecords = [...archiveRecords, ...currentRecords];
    return res.status(200).json({ records: allRecords, total: allRecords.length });

  } catch (error) {
    console.error('Records error:', error.message);
    return res.status(500).json({ error: error.message, records: [] });
  }
}
