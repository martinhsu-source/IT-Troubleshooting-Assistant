const SYSTEM_PROMPT = `You are a Senior IT Systems Engineer at BB International Leisure and Resort (Clark, Philippines).
Your role is to help IT staff diagnose and resolve technical issues across the company's departments (Casino, Hotel, Aqua, OVBD, and admin).

When analyzing an issue:
1. Cross-reference it with the provided historical TR (Trouble Report) records if relevant
2. Provide a concise issue analysis explaining the likely root cause
3. Give clear step-by-step resolution instructions
4. Assign a confidence score (0-1) based on how closely it matches known patterns
5. List related TR record IDs that informed your solution (empty array if none)

If no historical match exists, apply standard IT engineering knowledge for the type of issue.
Be practical and concise — IT staff need to act quickly.

IMPORTANT: Respond ONLY with a valid JSON object matching this exact schema:
{
  "analysis": "string — concise root cause analysis",
  "suggestedSolution": "string — numbered step-by-step instructions",
  "confidenceScore": 0.0,
  "relatedRecordIds": ["TR-xxx"]
}`;

function buildPrompt(issue, historyContext) {
  return `Historical TR Records:\n${historyContext}\n\n---\nNew Issue Reported: ${issue}`;
}

function isQuotaError(status, body) {
  if (status === 429) return true;
  if (body?.error?.code === 429) return true;
  if (body?.error?.status === 'RESOURCE_EXHAUSTED') return true;
  return false;
}

function parseJsonResponse(text) {
  if (!text) throw new Error('Empty response');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

// --- Provider: Google Gemini ---
async function callGemini(issue, historyContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY not set'), { skip: true });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(issue, historyContext) }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );

  const data = await res.json();
  if (isQuotaError(res.status, data)) throw Object.assign(new Error('Gemini quota exceeded'), { quota: true });
  if (!res.ok) throw new Error(`Gemini error: ${data?.error?.message}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseJsonResponse(text);
}

// --- Provider: Groq (llama-3.3-70b) ---
async function callGroq(issue, historyContext) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY not set'), { skip: true });

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(issue, historyContext) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  const data = await res.json();
  if (isQuotaError(res.status, data)) throw Object.assign(new Error('Groq quota exceeded'), { quota: true });
  if (!res.ok) throw new Error(`Groq error: ${data?.error?.message}`);

  return parseJsonResponse(data.choices?.[0]?.message?.content);
}

// --- Provider: OpenRouter (free models) ---
async function callOpenRouter(issue, historyContext) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_API_KEY not set'), { skip: true });

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://it-troubleshooting-assistant-ecru.vercel.app',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout:free',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(issue, historyContext) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  if (isQuotaError(res.status, data)) throw Object.assign(new Error('OpenRouter quota exceeded'), { quota: true });
  if (!res.ok) throw new Error(`OpenRouter error: ${data?.error?.message}`);

  return parseJsonResponse(data.choices?.[0]?.message?.content);
}

// --- Cascade runner ---
const PROVIDERS = [
  { name: 'Gemini', fn: callGemini },
  { name: 'Groq',   fn: callGroq   },
  { name: 'OpenRouter', fn: callOpenRouter },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { issue, records = [] } = req.body || {};
  if (!issue?.trim()) return res.status(400).json({ error: 'Issue description required' });

  // Limit context to most recent 50 records to stay within token limits
  const recentRecords = records.slice(-50);
  const historyContext = recentRecords.length > 0
    ? recentRecords.map(r =>
        `ID: ${r.id} | Date: ${r.date} | Category: ${r.category}\nIssue: ${r.issue}\nSolution: ${r.solution}`
      ).join('\n---\n')
    : 'No historical records available.';

  const errors = [];

  for (const provider of PROVIDERS) {
    try {
      const result = await provider.fn(issue, historyContext);
      console.log(`Query handled by ${provider.name}`);
      return res.status(200).json({ ...result, _provider: provider.name });
    } catch (err) {
      if (err.skip) continue; // API key not configured — skip silently
      errors.push(`${provider.name}: ${err.message}`);
      if (err.quota) {
        console.warn(`${provider.name} quota exceeded, trying next provider`);
        continue;
      }
      // Non-quota error — still try next provider but log it
      console.error(`${provider.name} error:`, err.message);
    }
  }

  console.error('All providers failed:', errors);
  return res.status(500).json({
    error: 'All AI providers are currently unavailable',
    details: errors,
  });
}
