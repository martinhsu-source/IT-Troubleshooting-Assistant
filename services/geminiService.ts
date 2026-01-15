
import { GoogleGenAI, Type } from "@google/genai";
import { TroubleshootingRecord, AIResponse } from "../types";

export const getSmartSolution = async (
  currentIssue: string,
  history: TroubleshootingRecord[]
): Promise<AIResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  const historyContext = history.map(r => 
    `ID: ${r.id}\nIssue: ${r.issue}\nCategory: ${r.category}\nSolution: ${r.solution}`
  ).join('\n---\n');

  const systemPrompt = `You are a Senior IT Systems Engineer. 
Your task is to analyze a new IT issue and find the most relevant solutions from the provided "Troubleshooting Records".
If a direct match isn't found, use your expert knowledge to suggest the most likely fix based on the historical patterns.

Historical Records:
${historyContext}`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `New Issue: ${currentIssue}`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: {
            type: Type.STRING,
            description: "An analysis of how this issue relates to historical records.",
          },
          suggestedSolution: {
            type: Type.STRING,
            description: "Step-by-step instructions to solve the issue.",
          },
          confidenceScore: {
            type: Type.NUMBER,
            description: "Probability (0-1) that this solution is correct.",
          },
          relatedRecordIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of IDs from history that helped inform this solution.",
          }
        },
        required: ["analysis", "suggestedSolution", "confidenceScore", "relatedRecordIds"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}") as AIResponse;
    return data;
  } catch (error) {
    console.error("Failed to parse AI response:", error);
    return {
      analysis: "Could not perform detailed analysis.",
      suggestedSolution: "General troubleshooting: Check connections, restart system, and verify logs.",
      confidenceScore: 0,
      relatedRecordIds: []
    };
  }
};
