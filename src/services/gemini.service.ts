import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Free-tier models in descending preference (2.0 family retired March 2026)
const FREE_TIER_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];

// Groq free-tier models — up to 14,400 req/day
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

export interface ExplanationRequest {
  question: string;
  options: any[];
  userAnswer: string | number;
  correctAnswer: string | number;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private groq: Groq;

  constructor() {
    this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    this.groq = new Groq({ apiKey: GROQ_API_KEY });
  }

  private isQuotaError(error: any): boolean {
    const msg: string = error?.message ?? '';
    return msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate');
  }

  private parseOptionNumber(raw: string): number {
    const match = raw.match(/[1-4]/);
    if (!match) throw new Error(`Unexpected response: "${raw}"`);
    return parseInt(match[0], 10);
  }

  async answerQuestion(question: string, options: { index: number; value: string }[]): Promise<number> {
    const optionList = options.map(o => `${o.index}. ${o.value.trim()}`).join('\n');

    const prompt = `You are an expert exam question analyzer.

Question: ${question.replace(/<[^>]*>/g, '')}

Options:
${optionList}

Reply with ONLY the number (1, 2, 3, or 4) of the correct option. No explanation, no extra text.`;

    // Try Groq first (generous free tier — up to 14,400 req/day)
    if (GROQ_API_KEY) {
      for (const model of GROQ_MODELS) {
        try {
          const completion = await this.groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 5,
            temperature: 0,
          });
          const raw = completion.choices[0]?.message?.content?.trim() ?? '';
          return this.parseOptionNumber(raw);
        } catch (err: any) {
          if (this.isQuotaError(err)) continue;
          break;
        }
      }
    }

    // Fallback to Gemini
    let lastError: any;
    for (const modelName of FREE_TIER_MODELS) {
      try {
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        return this.parseOptionNumber(raw);
      } catch (error: any) {
        lastError = error;
        if (this.isQuotaError(error)) continue;
        break;
      }
    }

    if (this.isQuotaError(lastError)) {
      throw Object.assign(new Error('AI quota limit reached. Please try again in a few minutes.'), { status: 429 });
    }
    throw new Error(lastError?.message || 'Failed to determine correct answer.');
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

    // Try Groq first (generous free tier)
    if (GROQ_API_KEY) {
      console.log('[AI] Trying Groq for explanation first...');
      for (const model of GROQ_MODELS) {
        try {
          const completion = await this.groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.3,
          });
          const text = completion.choices[0]?.message?.content?.trim() ?? '';
          if (text) return text;
        } catch (err: any) {
          console.error(`[Groq Error] model=${model}`, err.message);
          if (this.isQuotaError(err)) continue;
          break;
        }
      }
    }

    // Fallback to Gemini
    let lastError: any;
    for (const modelName of FREE_TIER_MODELS) {
      try {
        console.log(`[AI] Falling back to Gemini model: ${modelName}`);
        const model = this.genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result.response.text().trim() || 'No explanation generated.';
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
    throw new Error(lastError?.message || 'Failed to generate explanation from AI services.');
  }
}
