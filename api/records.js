import { createSign } from 'crypto';

// Semantic column roles — ordered from most specific to most generic
const ROLES = [
  { key: 'id',       patterns: ['TR No', 'TR_NO', 'TR-', 'Ticket No', 'Ticket', 'NO.', 'No.', 'ID'] },
  { key: 'date',     patterns: ['Report Date', 'DATE', 'Date', '日期', 'Timestamp'] },
  { key: 'category', patterns: ['CATEGORY', 'Category', 'Dept', 'Department', 'TYPE', 'Type'] },
  { key: 'issue',    patterns: ['DESCRIPTION', 'Description', 'ISSUE', 'Issue', 'Problem', 'Subject', 'Concern', 'REMARKS', 'Remarks'] },
  { key: 'solution', patterns: ['RESOLUTION', 'Resolution', 'SOLUTION', 'Solution', 'ACTION TAKEN', 'Action Taken', 'ACTION', 'FIX', 'Fix'] },
  { key: 'status',   patterns: ['STATUS', 'Status', 'State', 'Result'] },
];

function findCol(headers, ...patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(p.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Scan first 5 rows and return the index of the most likely header row
function findHeaderRowIndex(values) {
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

// Build role → column index map from a header row
// canonicalNames: actual column names resolved from the reference (current) sheet,
// prepended to each role's search list so they take priority
function buildColMap(headers, canonicalNames = {}) {
  const map = {};
  for (const { key, patterns } of ROLES) {
    const enhanced = canonicalNames[key]
      ? [canonicalNames[key], ...patterns]
      : patterns;
    map[key] = findCol(headers, ...enhanced);
  }
  return map;
}

// Extract the actual column name that resolved for each role in the reference sheet
function resolveCanonicalNames(headers, colMap) {
  const names = {};
  for (const { key } of ROLES) {
    const idx = colMap[key];
    if (idx >= 0) names[key] = headers[idx];
  }
  return names;
}

function parseRecords(values, headerIdx, colMap) {
  return values.slice(headerIdx + 1).map(row => {
    const get = i => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
    const id = get(colMap.id);
    if (!id) return null;
    const rawStatus = get(colMap.status).toLowerCase();
    let status = 'Resolved';
    if (rawStatus.includes('pending') || rawStatus.includes('open')) status = 'Pending';
    else if (rawStatus.includes('escalat')) status = 'Escalated';
    return {
      id,
      date:     get(colMap.date),
      category: get(colMap.category) || 'General',
      issue:    get(colMap.issue),
      solution: get(colMap.solution),
      status,
    };
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

    const currentValues = results[0]?.status === 'fulfilled' ? results[0].value : [];
    const archiveValues = results[1]?.status === 'fulfilled' ? results[1].value : [];

    // Step 1: parse current sheet and capture its actual column names as canonical reference
    const curHeaderIdx = findHeaderRowIndex(currentValues);
    const curHeaders   = currentValues[curHeaderIdx]?.map(h => String(h || '').trim()) ?? [];
    const curColMap    = buildColMap(curHeaders);
    const canonical    = resolveCanonicalNames(curHeaders, curColMap);
    console.log('Current sheet columns:', canonical);

    const currentRecords = parseRecords(currentValues, curHeaderIdx, curColMap);

    // Step 2: parse archive using canonical names as priority patterns
    let archiveRecords = [];
    if (archiveValues.length) {
      const archHeaderIdx = findHeaderRowIndex(archiveValues);
      const archHeaders   = archiveValues[archHeaderIdx]?.map(h => String(h || '').trim()) ?? [];
      const archColMap    = buildColMap(archHeaders, canonical);
      console.log('Archive sheet columns:', archColMap, 'headers sample:', archHeaders.slice(0, 10));
      archiveRecords = parseRecords(archiveValues, archHeaderIdx, archColMap);
    }

    console.log(`Records — current: ${currentRecords.length}, archive: ${archiveRecords.length}`);

    const allRecords = [...archiveRecords, ...currentRecords];
    return res.status(200).json({ records: allRecords, total: allRecords.length });

  } catch (error) {
    console.error('Records error:', error.message);
    return res.status(500).json({ error: error.message, records: [] });
  }
}
