import type { ExtractedData } from './types.js';

export interface ParsedReply {
  reply: string;
  extracted?: ExtractedData;
}

const RESPOSTA_PATTERN = /<resposta>([\s\S]*?)<\/resposta>/i;
const EXTRACAO_PATTERN = /<extracao>([\s\S]*?)<\/extracao>/i;

/**
 * Splits the model's raw output into the customer-facing reply and an optional structured
 * extraction block. The extraction contract is a nudge, not a guarantee — free/weaker models
 * often ignore formatting instructions entirely, so this degrades gracefully: no <resposta> tag
 * found means the whole output is treated as the reply (today's behavior, unchanged), and a
 * malformed/missing <extracao> block just means nothing gets extracted. Either way the
 * customer-facing text is never affected by extraction parsing failures.
 */
export function parseStructuredReply(raw: string): ParsedReply {
  const respostaMatch = raw.match(RESPOSTA_PATTERN);
  const reply = respostaMatch ? respostaMatch[1].trim() : raw.trim();

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

    return Object.keys(extracted).length > 0 ? { reply, extracted } : { reply };
  } catch {
    // Malformed JSON from the model — discard the extraction, keep the reply intact.
    return { reply };
  }
}
