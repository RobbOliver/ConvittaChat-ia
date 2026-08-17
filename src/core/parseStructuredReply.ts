import type { ExtractedData } from './types.js';

export interface ParsedReply {
  reply: string;
  extracted?: ExtractedData;
  /** True when a <resposta> tag (closed or opened-but-unclosed) was actually found in the model's
   * raw output — false only for the full raw-fallback path, where the entire raw output is being
   * treated as the reply because no tag appeared anywhere. Since buildOutputContract() in
   * systemPrompt.ts now unconditionally instructs every model to wrap its reply in <resposta>,
   * false here is always an abnormal situation — chat.ts uses this (combined with
   * isLikelyReasoningLeak below) to decide whether to trust this text as a real customer reply. */
  tagFound: boolean;
}

const RESPOSTA_PATTERN = /<resposta>([\s\S]*?)<\/resposta>/i;
// The model got cut off before closing the tag (e.g. hit a length limit) — still extract
// everything after the opening tag rather than falling through to the raw-output path below.
const RESPOSTA_UNCLOSED_PATTERN = /<resposta>([\s\S]*)$/i;
const EXTRACAO_PATTERN = /<extracao>([\s\S]*?)<\/extracao>/i;
// If <resposta> never closed, anything from a stray <extracao> onward belongs to the extraction
// block, not the reply — strip it so it can't end up quoted verbatim to the customer.
const EXTRACAO_TAIL = /<extracao>[\s\S]*$/i;

// Leftover framing tags that must never survive into a customer-facing message, whichever path
// produced `reply` — belt-and-suspenders on top of the primary <resposta> extraction above.
const LEADING_OR_TRAILING_TAG = /^\s*<[^>]+>\s*|\s*<\/?[^>]+>\s*$/g;

// Free/weaker models routed by openrouter/free occasionally preface their answer with a raw
// safety/moderation self-report ("User Safety: safe", "Response Safety: safe") instead of, or
// ahead of, the <resposta> tag. That's internal model telemetry, never something a customer
// should see — stripped here so it can't survive into the raw-output fallback path either.
const SAFETY_PREAMBLE_LINE =
  /^[ \t]*(user|response|content|input|output)[ \t]+(safety|moderation|classification)[ \t]*:[ \t]*.*$/gim;

/**
 * Strips framing artifacts that must never reach the customer, regardless of which extraction
 * path produced the text: leftover <tag> wrappers at the very start/end of the string, and known
 * safety/moderation self-report preambles some models emit ahead of their actual answer. Runs
 * iteratively since stripping one layer (e.g. a tag) can reveal another (e.g. a safety line right
 * beneath it).
 */
export function sanitizeReplyText(text: string): string {
  let result = text.trim();
  let previous: string;
  do {
    previous = result;
    result = result.replace(SAFETY_PREAMBLE_LINE, '').trim();
    result = result.replace(LEADING_OR_TRAILING_TAG, '').trim();
  } while (result !== previous && result.length > 0);
  return result;
}

/**
 * Splits the model's raw output into the customer-facing reply and an optional structured
 * extraction block. The extraction contract is a nudge, not a guarantee — free/weaker models
 * often ignore formatting instructions entirely, so this degrades gracefully in three steps: a
 * well-formed <resposta>...</resposta> (normal case), an opened-but-never-closed <resposta> (the
 * model got cut off — still extract everything after the tag), and finally the whole raw output
 * when no tag appears at all. Every path goes through sanitizeReplyText before being returned, so
 * a failure in the primary parse can never leak framing/safety text verbatim to the customer.
 */
export function parseStructuredReply(raw: string): ParsedReply {
  const respostaMatch = raw.match(RESPOSTA_PATTERN);
  const unclosedMatch = !respostaMatch ? raw.match(RESPOSTA_UNCLOSED_PATTERN) : null;
  const tagFound = Boolean(respostaMatch || unclosedMatch);
  const rawReplyText = respostaMatch
    ? respostaMatch[1]
    : (unclosedMatch?.[1] ?? raw).replace(EXTRACAO_TAIL, '');
  const reply = sanitizeReplyText(rawReplyText);

  const extracaoMatch = raw.match(EXTRACAO_PATTERN);
  if (!extracaoMatch) return { reply, tagFound };

  try {
    const parsed: unknown = JSON.parse(extracaoMatch[1].trim());
    if (typeof parsed !== 'object' || parsed === null) return { reply, tagFound };

    const obj = parsed as Record<string, unknown>;
    const extracted: ExtractedData = {};

    if (obj.campos && typeof obj.campos === 'object') {
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj.campos as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) fields[key] = value.trim();
      }
      if (Object.keys(fields).length > 0) extracted.fields = fields;
    }

    if (typeof obj.objetivo === 'string' && obj.objetivo.trim()) {
      extracted.objective = obj.objetivo.trim();
    } else if (obj.objetivo === null) {
      extracted.objective = null;
    }

    if (Array.isArray(obj.fatos_novos)) {
      const facts = obj.fatos_novos.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
      if (facts.length > 0) extracted.newFacts = facts;
    }

    if (typeof obj.endereco === 'string' && obj.endereco.trim()) {
      extracted.address = obj.endereco.trim();
    }

    if (
      obj.pedido_confirmado &&
      typeof obj.pedido_confirmado === 'object' &&
      !Array.isArray(obj.pedido_confirmado)
    ) {
      const order: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj.pedido_confirmado as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) order[key] = value.trim();
        else if (typeof value === 'number' || typeof value === 'boolean') order[key] = String(value);
      }
      if (Object.keys(order).length > 0) extracted.confirmedOrder = order;
    }

    if (typeof obj.proximo_no === 'string' && obj.proximo_no.trim()) {
      extracted.nextNode = obj.proximo_no.trim();
    }

    return Object.keys(extracted).length > 0 ? { reply, tagFound, extracted } : { reply, tagFound };
  } catch {
    // Malformed JSON from the model — discard the extraction, keep the reply intact.
    return { reply, tagFound };
  }
}

// Real customer replies are short WhatsApp messages by design — systemPrompt.ts asks for short,
// practical text and caps multi-bubble replies at 4 short parts. A leaked chain-of-thought trace
// (the confirmed production incident: "O cliente disse... Preciso analisar isso baseado no
// contexto... Primeiro, o objetivo da conversa é...") runs to hundreds of words instead. Length
// alone used to trip this at just 1000 chars — a real production flow with a detailed catalog-
// formatting instruction (categories, sizes, prices, per-item descriptions) legitimately produced
// a well-formed ~1200-char menu that got discarded outright. The phrasing check below stays the
// precise, length-independent signal (still sufficient on its own, however short or long the
// reply); this is now only the blunt length-alone backstop, raised well beyond anything a real
// (if long) catalog/policy answer would ever reach.
const EXCESSIVE_LENGTH_THRESHOLD = 4000; // characters — well beyond even a large formatted catalog reply

// Meta-reasoning phrasing characteristic of a model narrating its own chain-of-thought instead of
// answering — a genuine customer-facing reply talks TO the customer, never ABOUT "o cliente" in
// third person, and never narrates its own thinking. Includes English variants too: DeepSeek
// R1-class models (the confirmed root cause here) are documented to often reason in English even
// mid-Portuguese-conversation, so a Portuguese-only pattern would miss that case entirely.
const META_REASONING_PATTERN =
  /\b(o\s+cliente\s+(disse|perguntou|quer|pediu|mencionou)|preciso\s+(analisar|verificar|confirmar|considerar|entender)|vou\s+(analisar|considerar|verificar|responder)|deixa(?:-me|\s+eu)?\s+(pensar|analisar)|primeiro,?\s+(preciso|vou|devo)|com\s+base\s+no\s+contexto|analisando\s+(a|o|essa|esse)\s+(situação|mensagem|pedido|contexto)|the\s+customer\s+(said|asked|wants|mentioned)|i\s+need\s+to\s+(analyze|check|confirm|consider)|let\s+me\s+(think|analyze|consider)|first,?\s+i\s+(need|should|must))\b/i;

/**
 * Content-shape heuristic, independent of tag detection: does this text look like a leaked
 * reasoning trace rather than a real customer-facing reply? Deliberately a separate pure function
 * from `tagFound` (not folded into one combined check) so it stays independently unit-testable
 * against synthetic text, and so the caller (chat.ts) controls how the two signals combine.
 */
export function isLikelyReasoningLeak(reply: string): boolean {
  return reply.length > EXCESSIVE_LENGTH_THRESHOLD || META_REASONING_PATTERN.test(reply);
}
