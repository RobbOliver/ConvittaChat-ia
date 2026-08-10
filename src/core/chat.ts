import { env } from '../config/env.js';
import { buildBusinessContext } from '../knowledge/marmitaria.js';
import { openrouter } from '../openrouter/client.js';
import { sanitizeUserInput } from '../security/inputSanitizer.js';
import { validateOutput } from '../security/outputValidator.js';
import { assemblePrompt, type ChatTurn } from './assemblePrompt.js';

export interface ChatResult {
  reply: string;
  blocked: boolean;
  blockReason?: string;
  warnings: string[];
  model: string;
}

const REFUSAL_FALLBACK =
  'Não posso continuar com essa mensagem. Se quiser, me conta o que você gostaria de pedir hoje que eu ajudo! 🍱';

/**
 * The full pipeline, in order: sanitize input -> (short-circuit if hard-blocked) -> assemble the
 * sandwiched prompt -> call OpenRouter -> validate the reply against real menu data. Every layer
 * runs even on a normal, friendly message — the cost is negligible and there's no "trusted"
 * shortcut, since the whole point is that no single layer is assumed sufficient on its own.
 */
export async function runMarmitariaAssistant(userMessage: string, history: ChatTurn[] = []): Promise<ChatResult> {
  const { sanitized, flags, blocked, blockReason } = sanitizeUserInput(userMessage);
  if (blocked) {
    return { reply: REFUSAL_FALLBACK, blocked: true, blockReason, warnings: flags, model: env.OPENROUTER_MODEL };
  }

  const businessContext = buildBusinessContext();
  const messages = assemblePrompt({ businessContext, userMessage: sanitized, history });

  const completion = await openrouter.chat.completions.create({
    model: env.OPENROUTER_MODEL,
    messages,
    temperature: 0.3,
  });

  const reply = completion.choices[0]?.message?.content ?? '';
  const validation = validateOutput(reply);

  return {
    reply,
    blocked: false,
    warnings: [...flags, ...validation.warnings],
    model: env.OPENROUTER_MODEL,
  };
}
