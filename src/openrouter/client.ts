import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env, openRouterApiKeys } from '../config/env.js';

/**
 * OpenRouter speaks the OpenAI Chat Completions API, so the official `openai` SDK works
 * unmodified — just point `baseURL` at OpenRouter and use an OpenRouter key. `HTTP-Referer`/
 * `X-Title` are OpenRouter-specific (used for their usage dashboards/rankings), not required by
 * the SDK itself.
 *
 * Supports one or more keys (OPENROUTER_API_KEYS / OPENROUTER_API_KEY, see config/env.ts) so the
 * service can fail over to a second OpenRouter account when the first hits its free-tier daily
 * limit or goes down — each key gets its own client instance since the SDK bakes the key in at
 * construction time, and callOpenRouter() below tries them in order on every request.
 */

function maskKey(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '****';
}

export interface KeyEntry {
  label: string;
  /** Epoch ms this key should be skipped until — 0 means available right now. Mutated in place as
   * calls fail, so state persists across requests without any external store. */
  exhaustedUntil: number;
  call: (messages: ChatCompletionMessageParam[]) => Promise<ChatCompletion>;
}

const TRANSIENT_FAILURE_COOLDOWN_MS = 60_000;

export function isRateLimitError(error: unknown): boolean {
  return (error as { status?: number })?.status === 429;
}

/** OpenRouter's own account-specific reset time when the response carries it (authoritative),
 * falling back to the next UTC midnight — OpenRouter's documented free-tier daily reset — when the
 * header is missing or unparseable, so a rate-limited key is never retried before it's actually
 * likely to work again. */
export function resolveResetTime(error: unknown, now: number = Date.now()): number {
  const headers = (error as { headers?: Headers })?.headers;
  const raw = typeof headers?.get === 'function' ? headers.get('x-ratelimit-reset') : null;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > now) return parsed;

  const nextMidnightUtc = new Date(now);
  nextMidnightUtc.setUTCHours(24, 0, 0, 0);
  return nextMidnightUtc.getTime();
}

/**
 * Tries every currently-usable entry in order, marking one exhausted (until its rate-limit reset,
 * or a short cooldown for any other kind of failure) and moving to the next whenever a call fails.
 * Only throws once every entry has either failed just now or was already marked exhausted from an
 * earlier call — same "the caller just sees an error" contract the single-key version always had.
 * A plain function (not tied to the module-level pool) so this rotation logic can be unit-tested
 * with fake entries, no real OpenRouter account or network call required.
 */
export async function tryKeysInOrder(
  entries: KeyEntry[],
  messages: ChatCompletionMessageParam[],
  now: number = Date.now(),
): Promise<ChatCompletion> {
  const usable = entries.filter((entry) => entry.exhaustedUntil <= now);
  if (usable.length === 0) {
    throw new Error(
      `Todas as ${entries.length} chave(s) da OpenRouter estão indisponíveis no momento (limite diário ou falha recente).`,
    );
  }

  let lastError: unknown;
  for (const entry of usable) {
    try {
      return await entry.call(messages);
    } catch (error) {
      entry.exhaustedUntil = isRateLimitError(error) ? resolveResetTime(error, now) : now + TRANSIENT_FAILURE_COOLDOWN_MS;
      console.warn(
        `OpenRouter falhou usando ${entry.label}${usable.length > 1 ? ' — tentando a próxima chave' : ''}: ${(error as Error).message}`,
      );
      lastError = error;
    }
  }
  throw lastError;
}

const pool: KeyEntry[] = openRouterApiKeys.map((key, i) => {
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultHeaders: {
      'HTTP-Referer': env.APP_URL,
      'X-Title': env.APP_NAME,
    },
  });
  return {
    label: `chave #${i + 1} (${maskKey(key)})`,
    exhaustedUntil: 0,
    call: (messages) =>
      client.chat.completions.create({
        model: env.OPENROUTER_MODEL,
        messages,
        temperature: 0.3,
        // Customer replies are short by design; capping this bounds worst-case cost and reduces
        // the odds of the model getting cut off mid-<resposta> (parseStructuredReply.ts still
        // degrades safely if that happens, but avoiding it in the first place is cheaper).
        max_tokens: 1000,
      }),
  };
});

export function callOpenRouter(messages: ChatCompletionMessageParam[]): Promise<ChatCompletion> {
  return tryKeysInOrder(pool, messages);
}
