import { createSign } from 'crypto';

// Semantic column roles — ROLES order determines priority in conflict resolution
const ROLES = [
  { key: 'id',       patterns: ['TR-', 'TR No', 'TR_NO', 'Ticket No', 'Ticket', 'NO.', 'No.', 'Number', 'ID'] },
  { key: 'date',     patterns: ['Received Date', 'Report Date', 'DATE', 'Date', '日期'] },
  { key: 'category', patterns: ['Issue Type', 'CATEGORY', 'Category', 'DEPARTMENT', 'Department', 'Dept', 'TYPE', 'Type'] },
  { key: 'issue',    patterns: ['ISSUE DESCRIPTION', 'Issue Description', 'ISSUE', 'Issue', 'Problem', 'Subject', 'Concern'] },
  { key: 'detail',   patterns: ['DESCRIPTION', 'Description', 'Detail', 'Details'] },
  { key: 'solution', patterns: ['ACTION TAKEN', 'Action Taken', 'RESOLUTION', 'Resolution', 'SOLUTION', 'Solution', 'ACTION', 'FIX', 'Fix', 'Remark', 'Remarks', 'Report', 'Analyzation'] },
  { key: 'status',   patterns: ['STATUS', 'Status', 'State', 'Result'] },
];

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

// Build role → column index map with conflict detection so each column is only claimed once
function buildColMap(headers, canonicalNames = {}) {
  const map = {};
  const used = new Set();

  for (const { key, patterns } of ROLES) {
    const search = canonicalNames[key] ? [canonicalNames[key], ...patterns] : patterns;
    let found = -1;
    outer: for (const p of search) {
      for (let i = 0; i < headers.length; i++) {
        if (!used.has(i) && headers[i].toLowerCase().includes(p.toLowerCase())) {
          found = i;
          break outer;
        }
      }
    }
    if (found !== -1) used.add(found);
    map[key] = found;
  }
  return map;
}

// Extract actual column names from the resolved map (used as canonical reference for archive)
function resolveCanonicalNames(headers, colMap) {
  const names = {};
  for (const { key } of ROLES) {
    const idx = colMap[key];
    if (idx >= 0) names[key] = headers[idx];
  }
  return names;
}

const PLACEHOLDER_RE = /^(fill\s*up|fill\s*in|select|enter|type\s*here|example|sample|n\/a|tbd)/i;

function parseRecords(values, headerIdx, colMap) {
  return values.slice(headerIdx + 1).map(row => {
    const get = i => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
    const id = get(colMap.id);
    if (!id || PLACEHOLDER_RE.test(id)) return null;

    // Combine issue + detail (e.g. "ISSUE" + "DESCRIPTION" columns) if both present
    const issuePart  = get(colMap.issue);
    const detailPart = get(colMap.detail);
    const issue = (issuePart && detailPart)
      ? `${issuePart}: ${detailPart}`
      : (issuePart || detailPart);

    const rawStatus = get(colMap.status).toLowerCase();
    let status = 'Resolved';
    if (rawStatus.includes('pending') || rawStatus.includes('open')) status = 'Pending';
    else if (rawStatus.includes('escalat')) status = 'Escalated';



    return {
      id,
      date:     get(colMap.date),
      category: get(colMap.category) || 'General',
      issue,
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

    // Parse current sheet → capture actual column names as canonical reference
    const curHeaderIdx = findHeaderRowIndex(currentValues);
    const curHeaders   = currentValues[curHeaderIdx]?.map(h => String(h || '').trim()) ?? [];
    const curColMap    = buildColMap(curHeaders);
    const canonical    = resolveCanonicalNames(curHeaders, curColMap);
    const currentRecords = parseRecords(currentValues, curHeaderIdx, curColMap);

    // Parse archive using canonical names as priority
    let archiveRecords = [];
    let archColMap = {};
    let archHeaders = [];
    let archInvalid = [];
    if (archiveValues.length) {
      const archHeaderIdx = findHeaderRowIndex(archiveValues);
      archHeaders = archiveValues[archHeaderIdx]?.map(h => String(h || '').trim()) ?? [];
      archColMap  = buildColMap(archHeaders, canonical);
      archiveRecords = parseRecords(archiveValues, archHeaderIdx, archColMap);

      // Find invalid rows: have ID but no issue/solution
      const get = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');
      const archInvalid = archiveValues.slice(archHeaderIdx + 1)
        .map((row, rowIdx) => {
          const id = get(row, archColMap.id);
          if (!id || PLACEHOLDER_RE.test(id)) return null;
          const issuePart  = get(row, archColMap.issue);
          const detailPart = get(row, archColMap.detail);
          const issue = (issuePart && detailPart) ? `${issuePart}: ${detailPart}` : (issuePart || detailPart);
          const solution   = get(row, archColMap.solution);
          if (issue || solution) return null;
          return { rowIdx: archHeaderIdx + 1 + rowIdx + 1, id, date: get(row, archColMap.date) };
        })
        .filter(Boolean);
      console.log('Archive invalid rows:', JSON.stringify(archInvalid));

    }

    console.log('Current colMap:', curColMap, '| canonical:', canonical);
    console.log('Archive colMap:', archColMap, '| headers:', archHeaders.slice(0, 15));
    console.log(`Records — current: ${currentRecords.length}, archive: ${archiveRecords.length}`);

    const allRecords = [...archiveRecords, ...currentRecords];
    return res.status(200).json({ records: allRecords, total: allRecords.length, _archiveInvalid: archInvalid ?? [] });

  } catch (error) {
    console.error('Records error:', error.message);
    return res.status(500).json({ error: error.message, records: [] });
  }
}
