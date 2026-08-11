import type { ExtractedData } from './types.js';

export interface ParsedReply {
  reply: string;
  extracted?: ExtractedData;
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
  const rawReplyText = respostaMatch
    ? respostaMatch[1]
    : (unclosedMatch?.[1] ?? raw).replace(EXTRACAO_TAIL, '');
  const reply = sanitizeReplyText(rawReplyText);

  const extracaoMatch = raw.match(EXTRACAO_PATTERN);
  if (!extracaoMatch) return { reply };

  try {
    const parsed: unknown = JSON.parse(extracaoMatch[1].trim());
    if (typeof parsed !== 'object' || parsed === null) return { reply };

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

    return Object.keys(extracted).length > 0 ? { reply, extracted } : { reply };
  } catch {
    // Malformed JSON from the model — discard the extraction, keep the reply intact.
    return { reply };
  }
}
