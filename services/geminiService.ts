import { TroubleshootingRecord, AIResponse } from '../types';

export const getSmartSolution = async (
  currentIssue: string,
  records: TroubleshootingRecord[],
  lang: string = 'en'
): Promise<AIResponse> => {
  const response = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ issue: currentIssue, records, lang }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || 'Query failed');
  }

  return response.json();
};

export const loadTRRecords = async (): Promise<TroubleshootingRecord[]> => {
  const response = await fetch('/api/records');
  if (!response.ok) return [];
  const data = await response.json();
  return data.records ?? [];
};
