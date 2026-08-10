import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from './config/env.js';
import { runMarmitariaAssistant } from './core/chat.js';

/**
 * Stateless HTTP wrapper around runMarmitariaAssistant() — no conversation storage here on
 * purpose. The Convitta Chat backend already persists messages in Postgres; this service just
 * takes a message (plus however much recent history the caller wants to include) and returns a
 * reply. Keeping it stateless means it can restart/redeploy/scale freely with nothing to lose.
 */

const app = express();

app.use(cors());
app.use(express.json({ limit: '20kb' })); // a customer message is never legitimately bigger than this

app.get('/', (_req, res) => {
  res.json({ name: env.APP_NAME, status: 'ok', model: env.OPENROUTER_MODEL });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Applies only to /chat — the actual OpenRouter-calling route — not /health, so uptime checks
// (Render, or anything else polling health) never count against the limit.
const chatRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições — aguarde um minuto e tente novamente.' },
});

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.SERVICE_API_KEY) {
    next(); // no key configured (local dev only — production refuses to boot without one, see env.ts)
    return;
  }
  if (req.header('x-api-key') !== env.SERVICE_API_KEY) {
    res.status(401).json({ error: 'Chave de API ausente ou inválida (header x-api-key).' });
    return;
  }
  next();
}

const chatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .max(20)
    .optional(),
});

app.post('/chat', chatRateLimit, requireApiKey, async (req: Request, res: Response) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Corpo da requisição inválido', details: parsed.error.issues });
    return;
  }

  try {
    const result = await runMarmitariaAssistant(parsed.data.message, parsed.data.history);
    res.json(result);
  } catch (error) {
    console.error('Erro ao consultar o OpenRouter:', error);
    res.status(502).json({ error: 'Falha ao consultar o modelo de IA. Tente novamente.' });
  }
});

// Catches anything thrown/rejected anywhere above (including inside async handlers — Express 5
// forwards rejected promises here automatically) and returns clean JSON instead of Express's
// default HTML error page or an unhandled crash.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno.' });
});

app.listen(env.PORT, () => {
  console.log(`Convitta Chat IA ouvindo na porta ${env.PORT} — modelo: ${env.OPENROUTER_MODEL}`);
  if (!env.SERVICE_API_KEY) {
    console.warn('Atenção: SERVICE_API_KEY não configurada — /chat está aberto sem autenticação.');
  }
});
