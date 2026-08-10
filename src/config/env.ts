import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY não configurada — copie .env.example para .env e preencha'),
  OPENROUTER_MODEL: z.string().min(1).default('openrouter/free'),
  APP_URL: z.string().min(1).default('https://convittachat-frontend.onrender.com'),
  APP_NAME: z.string().min(1).default('Convitta Chat IA'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  // Shared secret the caller (the Convitta Chat backend, or you testing with curl) sends back as
  // the `x-api-key` header — without it, this service's public URL would accept chat requests
  // from anyone on the internet, burning OpenRouter usage on our dime. Optional locally for quick
  // testing; enforced as required in production, see the check below.
  SERVICE_API_KEY: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuração inválida em .env:');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.SERVICE_API_KEY) {
  console.error(
    'SERVICE_API_KEY é obrigatória quando NODE_ENV=production — defina essa variável no Render antes de aceitar tráfego público (senão qualquer pessoa na internet pode chamar /chat).',
  );
  process.exit(1);
}
