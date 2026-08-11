import { env } from '../config/env.js';
import { exampleBusiness } from '../knowledge/exampleBusiness.js';
import { openrouter } from '../openrouter/client.js';
import { sanitizeUserInput } from '../security/inputSanitizer.js';
import { validateOutput } from '../security/outputValidator.js';
import { assemblePrompt, type ChatTurn } from './assemblePrompt.js';
import { buildBusinessContext } from './buildBusinessContext.js';
import { parseStructuredReply } from './parseStructuredReply.js';
import type { BusinessInput, CustomerInput, ExtractedData } from './types.js';

export interface ChatResult {
  reply: string;
  blocked: boolean;
  blockReason?: string;
  warnings: string[];
  model: string;
  extracted?: ExtractedData;
}

const REFUSAL_FALLBACK =
  'Não posso continuar com essa mensagem. Se quiser, me conta o que você gostaria de pedir hoje que eu ajudo!';

/**
 * The full pipeline, in order: sanitize input -> (short-circuit if hard-blocked) -> assemble the
 * sandwiched prompt -> call OpenRouter -> parse the structured reply -> validate the customer-
 * facing text against real catalog data. Every layer runs even on a normal, friendly message —
 * the cost is negligible and there's no "trusted" shortcut, since the whole point is that no
 * single layer is assumed sufficient on its own.
 *
 * `business` is omitted only by the local CLI tools (`preview`/`send`), which fall back to
 * `exampleBusiness` — a fictitious fixture, never used in production. The real Convitta Chat
 * backend always sends the admin's actual `business` data on every call.
 */
export async function runAssistant(
  userMessage: string,
  history: ChatTurn[] = [],
  business: BusinessInput = exampleBusiness,
  customer?: CustomerInput,
): Promise<ChatResult> {
  const { sanitized, flags, blocked, blockReason } = sanitizeUserInput(userMessage);
  if (blocked) {
    return {
      reply: business.fallbackMessage || REFUSAL_FALLBACK,
      blocked: true,
      blockReason,
      warnings: flags,
      model: env.OPENROUTER_MODEL,
    };
  }

  const businessContext = buildBusinessContext(business);
  const messages = assemblePrompt({
    businessName: business.name,
    businessContext,
    userMessage: sanitized,
    history,
    customer,
  });

  const completion = await openrouter.chat.completions.create({
    model: env.OPENROUTER_MODEL,
    messages,
    temperature: 0.3,
  });

  const rawReply = completion.choices[0]?.message?.content ?? '';
  const { reply, extracted } = parseStructuredReply(rawReply);
  const validation = validateOutput(reply, business.catalog);

  return {
    reply,
    blocked: false,
    warnings: [...flags, ...validation.warnings],
    model: env.OPENROUTER_MODEL,
    extracted,
  };
}
