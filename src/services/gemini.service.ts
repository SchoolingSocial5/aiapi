import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Free-tier models in descending preference (2.0 family retired March 2026)
const FREE_TIER_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];

export interface ExplanationRequest {
  question: string;
  options: any[];
  userAnswer: string | number;
  correctAnswer: string | number;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }

  private isQuotaError(error: any): boolean {
    const msg: string = error?.message ?? '';
    return msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate');
  }

  async explainQuestion(data: ExplanationRequest): Promise<string> {
    const { question, options, userAnswer, correctAnswer } = data;

    const prompt = `
      You are an educational AI assistant helping a student understand their exam results.

      Question: ${question}
      Options: ${JSON.stringify((options || []).map((o: any) => o?.value || o))}
      Student's Answer: ${userAnswer}
      Correct Answer: ${correctAnswer}

      Respond using EXACTLY one of the two formats below. Do not add any extra text, greetings, or labels outside these formats.

      If the student answered correctly:
      CORRECT\n
      [A concise, encouraging explanation of why the answer is correct. Max 3-4 sentences.]

      If the student answered incorrectly:
      FAILED\n
      [A kind, supportive explanation of why their answer was wrong and why the correct answer is right. Max 3-4 sentences.]\n
      ANSWER\n
      [The correct answer value only, exactly as provided above.]

      Rules:
      - Use plain text only (no markdown like **bold**).
      - The first line must be either CORRECT or FAILED — nothing else.
      - Each section must be separated by a line break as shown.
      - Do not include labels like "Explanation:" or "Correct Answer:" in your response.
    `;

    let lastError: any;
    for (const modelName of FREE_TIER_MODELS) {
      try {
        console.log(`[AI] Trying model: ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim() || 'No explanation generated.';
      } catch (error: any) {
        console.error(`[Gemini Error] model=${modelName}`, error.message);
        lastError = error;
        if (this.isQuotaError(error)) {
          continue;
        }
        break;
      }
    }

    if (this.isQuotaError(lastError)) {
      throw Object.assign(new Error('AI quota limit reached. Please try again in a few minutes.'), { status: 429 });
    }
    throw new Error(lastError?.message || 'Failed to generate explanation from Gemini API.');
  }
}
