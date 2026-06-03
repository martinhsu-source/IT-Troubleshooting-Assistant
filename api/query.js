const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_PROMPT = `You are the BB Clark IT Support Assistant, an AI tool helping IT staff at BB International Leisure and Resort (Clark, Philippines) troubleshoot technical issues and look up past Trouble Report (TR) records.

You assist with:
- Network/WiFi/LAN/VPN connectivity issues
- Printer and peripheral device problems
- VoIP/IP phone configuration and troubleshooting
- Windows PC, server, and domain administration
- NAS/storage systems (Synology)
- Software issues (MS Office, browsers, internal systems)
- Account management and password resets
- Hardware diagnostics and replacement

Departments served: Casino, Hotel, Aqua, OVBD, and admin departments at BB Clark.

Guidelines:
1. Be concise and practical — IT staff needs actionable steps quickly
2. Provide numbered step-by-step instructions for troubleshooting
3. If TR records are provided in context and relevant, cite the TR number and its resolution
4. If an issue requires on-site hardware replacement or admin escalation, say so clearly
5. You can respond in English or Traditional Chinese based on what the user writes`;

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
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      if (h && values[i]) obj[h] = values[i];
    });
    return obj;
  }).filter(r => Object.keys(r).length > 2);
}

async function fetchTRRecords() {
  const { SHEET_ID, SHEET_GID } = process.env;
  if (!SHEET_ID || SHEET_ID === 'PENDING') return null;

  const gidParam = SHEET_GID ? `&gid=${SHEET_GID}` : '';
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${gidParam}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;

  const records = parseCSV(await res.text());
  // Return last 80 records to stay within reasonable token limits
  return records.slice(-80);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    let contextNote = '';
    try {
      const records = await fetchTRRecords();
      if (records?.length > 0) {
        const recordsText = records
          .map(r => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' | '))
          .join('\n');
        contextNote = `\n\n[TR Records (${records.length} recent entries):\n${recordsText}\n]`;
      }
    } catch (e) {
      // Sheet unavailable — continue without TR context
    }

    const chatHistory = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(message + contextNote);

    return res.status(200).json({ response: result.response.text() });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Failed to generate response', details: error.message });
  }
};
