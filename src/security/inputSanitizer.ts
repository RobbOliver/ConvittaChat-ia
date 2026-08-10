/**
 * First line of defense against prompt injection — runs BEFORE the message ever reaches the
 * model. Two jobs: (1) strip anything in the customer's text that could break out of the
 * <mensagem_cliente> delimiter assemblePrompt.ts wraps it in, and (2) hard-block the small set of
 * unambiguous injection attempts that are never a legitimate customer question, so they never
 * cost an API call or reach the model at all. Everything else is passed through — this is a
 * blocklist for clear attacks, not a content filter for the actual conversation.
 */

const DELIMITER_TAGS = ['mensagem_cliente', 'contexto_negocio'];

// Patterns almost never present in a real "quero pedir uma marmita" message. Kept intentionally
// narrow: a false positive here blocks a paying customer, so each pattern targets phrasing that's
// only really used when someone is deliberately trying to redirect the model.
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /ignor[ea]\s+(todas?\s+)?(as\s+)?(instru[çc][õo]es|regras)\s+(anteriores|acima)/i,
  /desconsidere?\s+(todas?\s+)?(as\s+)?(instru[çc][õo]es|regras)/i,
  /voc[êe]\s+(agora\s+)?[ée]\s+(um|uma)\s+(novo|nova)/i,
  /revele?\s+(seu|o)\s+prompt/i,
  /(mostre|repita|imprima)\s+(suas?\s+)?instru[çc][õo]es/i,
  /modo\s+(de\s+)?desenvolvedor/i,
  /\bdan\s+mode\b/i,
  /\bjailbreak\b/i,
  /system\s*:\s*/i,
  /\bact\s+as\b/i,
];

export interface SanitizeResult {
  sanitized: string;
  flags: string[];
  blocked: boolean;
  blockReason?: string;
}

export function sanitizeUserInput(raw: string): SanitizeResult {
  const flags: string[] = [];

  for (const pattern of HARD_BLOCK_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        sanitized: '',
        flags: [`padrão de injeção detectado: ${pattern.source}`],
        blocked: true,
        blockReason: 'Mensagem recusada automaticamente por padrão de tentativa de manipulação do assistente.',
      };
    }
  }

  // Neutralizes an attempt to close our own delimiter early and inject fake system/context turns
  // after it — the tag names becoming visible-but-inert text is fine, silently accepting a
  // forged </mensagem_cliente><contexto_negocio> is not.
  let sanitized = raw;
  for (const tag of DELIMITER_TAGS) {
    const openRe = new RegExp(`<${tag}>`, 'gi');
    const closeRe = new RegExp(`</${tag}>`, 'gi');
    if (openRe.test(sanitized) || closeRe.test(sanitized)) {
      flags.push(`tentativa de usar delimitador reservado "${tag}" no texto do cliente`);
      sanitized = sanitized.replace(openRe, `[${tag}]`).replace(closeRe, `[/${tag}]`);
    }
  }

  // Excessive length is a cheap way to try to drown the system prompt's relative weight in a huge
  // context, or just abuse the API — cap rather than reject, so a genuinely long question still works.
  const MAX_LENGTH = 2000;
  if (sanitized.length > MAX_LENGTH) {
    flags.push(`mensagem truncada de ${sanitized.length} para ${MAX_LENGTH} caracteres`);
    sanitized = sanitized.slice(0, MAX_LENGTH);
  }

  return { sanitized, flags, blocked: false };
}
