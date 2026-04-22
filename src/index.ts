import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GeminiService } from './services/gemini.service';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3003;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const geminiService = new GeminiService();

app.post('/explain', async (req: Request, res: Response) => {
  try {
    const { question, userAnswer, correctAnswer, options } = req.body;
    console.log('[AI] Received Request:', JSON.stringify(req.body, null, 2));

    if (!question || userAnswer === undefined || correctAnswer === undefined) {
      console.warn('[AI] Missing fields:', { question: !!question, userAnswer, correctAnswer });
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const explanation = await geminiService.explainQuestion({
      question,
      options: options || [],
      userAnswer,
      correctAnswer
    });

    res.status(200).json({ explanation });
  } catch (error: any) {
    console.error('[AI Error]', error.message);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
});

app.post('/answer', async (req: Request, res: Response) => {
  try {
    const { question, options } = req.body;
    if (!question || !Array.isArray(options) || options.length === 0) {
      return res.status(400).json({ message: 'question and options are required' });
    }
    const correctIndex = await geminiService.answerQuestion(question, options);
    res.status(200).json({ correctIndex });
  } catch (error: any) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Internal server error' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`AI Service running on http://0.0.0.0:${port}`);
});
