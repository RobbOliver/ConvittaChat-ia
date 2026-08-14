import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  // Either works — OPENROUTER_API_KEYS (comma-separated) takes priority when set and enables
  // automatic failover across accounts (see openrouter/client.ts); OPENROUTER_API_KEY alone still
  // works unchanged for a single-key setup. At least one of the two is required (checked below,
  // not here, since Zod can't express "at least one of these two fields" cleanly).
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEYS: z.string().min(1).optional(),
  // Pinned to google/gemini-2.5-flash-lite as of 2026-08-14, after a real 75-call benchmark against
  // 5 candidates (gpt-4.1-nano, gemini-2.5-flash-lite, openrouter/free, deepseek-v4-flash-0731,
  // ling-3.0-flash) using production prompt/parsing code: 93% success, fastest+most consistent
  // latency, best cost-per-successful-reply of the group. Both "openrouter/free" (10 different
  // underlying models across 15 calls) and a single pinned free model (upstream pool going flaky
  // for extended stretches, no fallback) were tried and rejected for reliability, not price — the
  // reasoning: { exclude: true } on every call (openrouter/client.ts) and isLikelyReasoningLeak()
  // (core/parseStructuredReply.ts) stay regardless of which model is pinned here, as a permanent
  // second layer against a reasoning-capable model ever leaking chain-of-thought to a customer.
  OPENROUTER_MODEL: z.string().min(1).default('google/gemini-2.5-flash-lite'),
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

/** One or more OpenRouter API keys, in the order they'll be tried — see openrouter/client.ts for
 * the failover logic that rotates to the next one when a key hits its daily limit or errors out. */
export const openRouterApiKeys: string[] = (
  env.OPENROUTER_API_KEYS
    ? env.OPENROUTER_API_KEYS.split(',')
    : env.OPENROUTER_API_KEY
      ? [env.OPENROUTER_API_KEY]
      : []
)
  .map((key) => key.trim())
  .filter(Boolean);

if (openRouterApiKeys.length === 0) {
  console.error(
    'Nenhuma chave da OpenRouter configurada — defina OPENROUTER_API_KEY (uma) ou OPENROUTER_API_KEYS (várias, separadas por vírgula) no .env.',
  );
  process.exit(1);
}

if (env.NODE_ENV === 'production' && !env.SERVICE_API_KEY) {
  console.error(
    'SERVICE_API_KEY é obrigatória quando NODE_ENV=production — defina essa variável no Render antes de aceitar tráfego público (senão qualquer pessoa na internet pode chamar /chat).',
  );
  process.exit(1);
}
