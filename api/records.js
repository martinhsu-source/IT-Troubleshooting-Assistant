function parseCSVLine(line) {
  const result = [];
  let cell = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  result.push(cell.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => parseCSVLine(line));
  return { headers, rows };
}

// Find column index by trying multiple name patterns (case-insensitive)
function findCol(headers, ...patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(p.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function mapToRecord(headers, row) {
  const get = (idx) => (idx >= 0 && row[idx] ? row[idx].trim() : '');

  const idIdx = findCol(headers, 'TR-', 'TR No', 'TR_NO', 'Ticket', 'ID', 'NO.');
  const dateIdx = findCol(headers, 'DATE', 'Date', '日期');
  const catIdx = findCol(headers, 'CATEGORY', 'Category', 'TYPE', 'Type', 'CAT');
  const issueIdx = findCol(headers, 'DESCRIPTION', 'Description', 'ISSUE', 'Issue', 'Problem', 'REMARKS', 'Subject');
  const solIdx = findCol(headers, 'RESOLUTION', 'Resolution', 'SOLUTION', 'Solution', 'FIX', 'ACTION', 'Remarks');
  const statusIdx = findCol(headers, 'STATUS', 'Status', 'State');

  const id = get(idIdx) || `ROW-${Math.random().toString(36).slice(2, 6)}`;
  if (!id || id === '') return null;

  const rawStatus = get(statusIdx).toLowerCase();
  let status = 'Resolved';
  if (rawStatus.includes('pending') || rawStatus.includes('open')) status = 'Pending';
  else if (rawStatus.includes('escalat')) status = 'Escalated';

  return {
    id,
    date: get(dateIdx) || '',
    category: get(catIdx) || 'General',
    issue: get(issueIdx) || '',
    solution: get(solIdx) || '',
    status,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SHEET_ID, SHEET_GID } = process.env;

  if (!SHEET_ID || SHEET_ID === 'PENDING') {
    return res.status(200).json({ records: [], message: 'SHEET_ID not configured' });
  }

  try {
    const gidParam = SHEET_GID ? `&gid=${SHEET_GID}` : '';
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${gidParam}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      return res.status(200).json({
        records: [],
        message: 'Could not fetch sheet — ensure it is shared as "Anyone with the link can view"',
      });
    }

    const csvText = await response.text();
    const { headers, rows } = parseCSV(csvText);

    const records = rows
      .map(row => mapToRecord(headers, row))
      .filter(r => r && r.id && (r.issue || r.solution))
      .slice(-200); // Cap at last 200 records

    return res.status(200).json({ records, total: records.length });
  } catch (error) {
    console.error('Records fetch error:', error);
    return res.status(200).json({ records: [], message: error.message });
  }
}
