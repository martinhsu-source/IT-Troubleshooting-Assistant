
export interface TroubleshootingRecord {
  id: string;
  date: string;
  issue: string;
  category: string;
  solution: string;
  status: 'Resolved' | 'Pending' | 'Escalated';
}

export interface AIResponse {
  analysis: string;
  suggestedSolution: string;
  confidenceScore: number;
  relatedRecordIds: string[];
}
