import OpenAI from 'openai';
import { env } from '../config/env.js';

/**
 * OpenRouter speaks the OpenAI Chat Completions API, so the official `openai` SDK works
 * unmodified — just point `baseURL` at OpenRouter and use an OpenRouter key. `HTTP-Referer`/
 * `X-Title` are OpenRouter-specific (used for their usage dashboards/rankings), not required by
 * the SDK itself.
 */
export const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': env.APP_URL,
    'X-Title': env.APP_NAME,
  },
});
