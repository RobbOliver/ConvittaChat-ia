import type { ChatCompletion } from 'openai/resources/chat/completions';
import { env } from '../config/env.js';
import { exampleBusiness } from '../knowledge/exampleBusiness.js';
import { callOpenRouter } from '../openrouter/client.js';
import { sanitizeUserInput } from '../security/inputSanitizer.js';
import { validateOutput } from '../security/outputValidator.js';
import { assemblePrompt, type ChatTurn } from './assemblePrompt.js';
import { buildBusinessContext } from './buildBusinessContext.js';
import { isLikelyReasoningLeak, parseStructuredReply } from './parseStructuredReply.js';
import type { BusinessInput, CustomerInput, ExtractedData, FlowStepInput, ImageInput } from './types.js';

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

// Distinct from REFUSAL_FALLBACK on purpose — that one reads as a refusal ("não posso continuar"),
// appropriate for a blocked injection attempt. This path is different: the customer did nothing
// wrong, the model's own output just wasn't safe to relay (see isLikelyReasoningLeak below).
const PARSING_FAILURE_FALLBACK =
  'Deixa eu confirmar isso direitinho com a equipe e te retorno rapidinho!';

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
  flow?: FlowStepInput,
  image?: ImageInput,
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
    flow,
    image,
  });

  // Tries every configured OpenRouter key in order, failing over automatically when one hits its
  // daily rate limit or errors out — see openrouter/client.ts. Only throws once all of them fail.
  let completion = await callOpenRouter(messages);
  let { reply, extracted, suspectedReasoningLeak } = interpretCompletion(completion, business, flow);
  let validation = validateOutput(reply, business.catalog);
  let priceRetryWarning: string | undefined;

  // A wrong price is a financial-correctness issue, not just a logging concern — prompt wording
  // alone ("only use catalog prices") isn't a guarantee against a small/free model misreading a
  // number, so this gives it one genuine second attempt at a fresh generation (not a text-splice
  // fix, which risks patching the wrong item's price into the wrong sentence) before ever falling
  // back. Only retries on THIS specific failure — every other validation warning stays
  // observability-only, same as before.
  if (!suspectedReasoningLeak && validation.hasPriceMismatch) {
    const retryMessages: typeof messages = [
      ...messages,
      { role: 'assistant', content: completion.choices[0]?.message?.content ?? '' },
      {
        role: 'system',
        content:
          'Sua resposta anterior mencionou um preço que não corresponde a nenhum item do catálogo em <contexto_negocio>. Gere a resposta de novo, respondendo à mesma mensagem do cliente, citando os preços EXATAMENTE como aparecem no catálogo — não arredonde, não estime, não some de cabeça. Mantenha o mesmo formato de resposta (<resposta> e, se aplicável, <extracao>).',
      },
    ];
    try {
      const retryCompletion = await callOpenRouter(retryMessages);
      const retryResult = interpretCompletion(retryCompletion, business, flow);
      const retryValidation = validateOutput(retryResult.reply, business.catalog);
      if (!retryValidation.hasPriceMismatch) {
        completion = retryCompletion;
        reply = retryResult.reply;
        extracted = retryResult.extracted;
        suspectedReasoningLeak = retryResult.suspectedReasoningLeak;
        validation = retryValidation;
      } else {
        // Two independent generations both got the price wrong — more likely a genuinely
        // confusing catalog (e.g. very similar item names) than a one-off slip, so stop retrying
        // and refuse to relay either wrong price to the customer.
        reply = business.fallbackMessage || PARSING_FAILURE_FALLBACK;
        extracted = undefined;
        validation = { ok: true, warnings: [], hasPriceMismatch: false };
        priceRetryWarning =
          'Preço incorreto persistiu mesmo após nova tentativa — resposta substituída por fallback para não repassar um valor errado ao cliente.';
      }
    } catch {
      // OpenRouter failure on the retry itself — same "don't relay a wrong price" principle applies.
      reply = business.fallbackMessage || PARSING_FAILURE_FALLBACK;
      extracted = undefined;
      validation = { ok: true, warnings: [], hasPriceMismatch: false };
      priceRetryWarning =
        'Preço incorreto detectado e a nova tentativa falhou — resposta substituída por fallback para não repassar um valor errado ao cliente.';
    }
  }

  return {
    reply,
    blocked: false,
    warnings: [
      ...flags,
      ...validation.warnings,
      ...(priceRetryWarning ? [priceRetryWarning] : []),
      ...(suspectedReasoningLeak
        ? [
            'Resposta do modelo foi substituída por fallback: conteúdo bruto não continha a tag ' +
              '<resposta> e apresentava sinais de raciocínio interno vazado (tamanho excessivo e/ou ' +
              'linguagem de meta-raciocínio).',
          ]
        : []),
    ],
    model: env.OPENROUTER_MODEL,
    extracted,
  };
}

/**
 * Parses one OpenRouter completion into a trustworthy (reply, extracted, suspectedReasoningLeak)
 * triple — factored out so the price-mismatch retry above can run the exact same interpretation
 * logic on a second completion without duplicating it.
 */
function interpretCompletion(
  completion: ChatCompletion,
  business: BusinessInput,
  flow: FlowStepInput | undefined,
): { reply: string; extracted: ExtractedData | undefined; suspectedReasoningLeak: boolean } {
  const rawReply = completion.choices[0]?.message?.content ?? '';
  const { reply: parsedReply, extracted: parsedExtracted, tagFound } = parseStructuredReply(rawReply);

  // Defense-in-depth against a reasoning-capable model routed by openrouter/free leaking its whole
  // chain-of-thought into `content` instead of (or alongside) a real answer — see
  // openrouter/client.ts's `reasoning: { exclude: true }` for the primary defense at the source.
  // Only ever considered when no <resposta> tag was found at all: buildOutputContract() in
  // systemPrompt.ts unconditionally instructs every model to use that tag now, so its total
  // absence is always abnormal, never the routine "weak model ignored the format" case that used
  // to make an untagged reply a normal, trusted path.
  const suspectedReasoningLeak = !tagFound && isLikelyReasoningLeak(parsedReply);
  if (suspectedReasoningLeak) {
    console.warn(
      `[chat] Resposta descartada — parece raciocínio interno vazado, não uma resposta ao cliente ` +
        `(modelo roteado: ${completion.model}, ${parsedReply.length} chars, sem tag <resposta>). ` +
        `Prévia: ${parsedReply.slice(0, 200)}${parsedReply.length > 200 ? '…' : ''}`,
    );
  }

  // If the raw output wasn't trustworthy enough to show the customer, it isn't trustworthy enough
  // to silently persist as customer state either (e.g. a hallucinated pedido_confirmado buried in
  // a reasoning ramble) — discard both together.
  const reply = suspectedReasoningLeak ? business.fallbackMessage || PARSING_FAILURE_FALLBACK : parsedReply;
  const extracted = suspectedReasoningLeak ? undefined : discardUnknownRoute(parsedExtracted, flow);
  return { reply, extracted, suspectedReasoningLeak };
}

/**
 * Defense-in-depth on top of the prompt instruction ("NUNCA invente um valor fora dessa lista" in
 * systemPrompt.ts) — a weaker/free model can still ignore that instruction and echo something
 * that isn't one of the routing options it was given, or invent one when no `flow` was sent at
 * all this turn. Silently dropping `nextNode` in that case (not the whole extraction) means the
 * caller's interpreter just treats it as "stay at the current node", the same safe behavior as if
 * the model had simply omitted the key like it was told to when uncertain.
 */
function discardUnknownRoute(extracted: ExtractedData | undefined, flow?: FlowStepInput): ExtractedData | undefined {
  if (!extracted?.nextNode) return extracted;
  const validLabels = flow?.routingOptions?.map((o) => o.label) ?? [];
  if (validLabels.includes(extracted.nextNode)) return extracted;
  const rest: ExtractedData = { ...extracted };
  delete rest.nextNode;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
