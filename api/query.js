import { GoogleGenAI, Type } from '@google/genai';

const SYSTEM_PROMPT = `You are a Senior IT Systems Engineer at BB International Leisure and Resort (Clark, Philippines).
Your role is to help IT staff diagnose and resolve technical issues across the company's departments (Casino, Hotel, Aqua, OVBD, and admin).

When analyzing an issue:
1. Cross-reference it with the provided historical TR (Trouble Report) records if relevant
2. Provide a concise issue analysis explaining the likely root cause
3. Give clear step-by-step resolution instructions
4. Assign a confidence score (0-1) based on how closely it matches known patterns
5. List related TR record IDs that informed your solution (empty array if none)

If no historical match exists, apply standard IT engineering knowledge for the type of issue.
Be practical and concise — IT staff need to act quickly.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    analysis: {
      type: Type.STRING,
      description: 'Concise analysis of the issue and its likely root cause, referencing historical patterns if applicable.',
    },
    suggestedSolution: {
      type: Type.STRING,
      description: 'Step-by-step resolution instructions. Use numbered steps.',
    },
    confidenceScore: {
      type: Type.NUMBER,
      description: 'Probability (0.0–1.0) that this solution is correct based on available information.',
    },
    relatedRecordIds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of TR record IDs from history that directly informed this solution.',
    },
  },
  required: ['analysis', 'suggestedSolution', 'confidenceScore', 'relatedRecordIds'],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { issue, records = [] } = req.body || {};
  if (!issue?.trim()) return res.status(400).json({ error: 'Issue description required' });

  try {
    const historyContext = records.length > 0
      ? records.map(r =>
          `ID: ${r.id} | Date: ${r.date} | Category: ${r.category}\nIssue: ${r.issue}\nSolution: ${r.solution}`
        ).join('\n---\n')
      : 'No historical records available.';

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `New Issue Reported: ${issue}`,
      config: {
        systemInstruction: `${SYSTEM_PROMPT}\n\nHistorical TR Records:\n${historyContext}`,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const parsed = JSON.parse(result.text ?? '{}');
    return res.status(200).json(parsed);
  } catch (error) {
    console.error('Query error:', error);
    return res.status(500).json({
      error: 'Failed to generate response',
      details: error.message,
    });
  }
}
