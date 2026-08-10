import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY não configurada — copie .env.example para .env e preencha'),
  OPENROUTER_MODEL: z.string().min(1).default('anthropic/claude-3.5-haiku'),
  APP_URL: z.string().min(1).default('https://convittachat-frontend.onrender.com'),
  APP_NAME: z.string().min(1).default('Convitta Chat IA'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuração inválida em .env:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
