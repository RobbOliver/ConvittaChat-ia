import { formatBRL } from '../core/format.js';
import type { CatalogItem } from '../core/types.js';

/**
 * Second line of defense — deterministic, code-level checks on the model's *reply*, not just its
 * input. Prompt instructions ("only use the provided context") are a strong nudge but not a
 * guarantee; a model can still hallucinate a price or an item under the right pressure. This
 * doesn't rewrite the reply (that's a product decision, not a security one) — it flags anything
 * that doesn't check out against the actual catalog data, so the caller can decide whether to show
 * a warning, log it for review, or regenerate.
 */

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  /** True when the reply mentions a "R$ X" price that doesn't match any real catalog price —
   * distinct from the generic `warnings` list because the caller (chat.ts) acts on this one
   * specifically: a wrong price is a financial-correctness issue, not just an observability flag,
   * so it triggers a regeneration attempt rather than just being logged. */
  hasPriceMismatch: boolean;
}

const PRICE_PATTERN = /R\$\s?(\d{1,4}(?:[.,]\d{2})?)/g;

// toLocaleString('pt-BR', {style:'currency', ...}) inserts a NON-BREAKING space (U+00A0)
// between "R$" and the number, not a regular one — a model writing plain text never does
// that, so both sides must go through the exact same whitespace-stripping before comparison,
// or every real price mismatches its own known-good value.
function normalizePrice(value: string): string {
  return value.replace(/[\s\u00a0]/g, '');
}

// Catalog names can carry a parenthetical size/detail ("Marmita G (700g)") that a model naturally
// omits when referring to the item conversationally ("a marmita G") — match against both the full
// name and everything before the parenthetical, so a normal phrasing doesn't get flagged.
function baseName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A correct "we don't have that" refusal is exactly the grounded behavior the system prompt asks
// for — it legitimately names no real item, so it shouldn't itself read as a possible invention.
const DECLINE_PATTERN =
  /n[ãa]o\s+(temos|tenho|est[áa])|n[ãa]o\s+consta|vou\s+confirmar|n[ãa]o\s+dispon[íi]vel/i;

// Generic commerce vocabulary — deliberately not tied to food/retail/services specifically, just
// "this reply seems to be talking about what's for sale".
const MENTIONS_CATALOG_TOPIC = /produto|item|cat[áa]logo|servi[çc]o|card[áa]pio|pre[çc]o/i;

const LEAK_MARKERS = ['<contexto_negocio>', '<mensagem_cliente>', 'REGRAS DE SEGURANÇA', 'prompt de sistema'];

// parseStructuredReply.ts already strips these before `reply` ever gets here — this is purely an
// observability tripwire. If one of these ever fires, sanitizeReplyText() has a gap worth
// investigating; it's not itself a second attempt at cleaning the text (that's a mutation, and
// mutating the reply is parseStructuredReply.ts's job, not this read-only validator's).
const RESIDUAL_FRAMING_PATTERN = /<\/?resposta>|<\/?extracao>|^\s*(user|response)\s+safety\s*:/im;

export function validateOutput(reply: string, catalog: CatalogItem[]): ValidationResult {
  const warnings: string[] = [];

  const knownPrices = new Set(
    catalog.flatMap((item) =>
      item.pricingMode === 'BY_SIZE' && item.sizes?.length
        ? item.sizes.map((size) => normalizePrice(formatBRL(size.priceCents)))
        : [normalizePrice(formatBRL(item.priceCents))],
    ),
  );
  const knownNames = catalog.flatMap((item) => [item.name.toLowerCase(), baseName(item.name).toLowerCase()]);
  const knownLastWords = Array.from(
    new Set(catalog.map((item) => baseName(item.name).split(/\s+/).pop()?.toLowerCase()).filter((w): w is string => !!w)),
  );

  let hasPriceMismatch = false;
  const pricesMentioned = reply.match(PRICE_PATTERN) ?? [];
  for (const raw of pricesMentioned) {
    if (!knownPrices.has(normalizePrice(raw))) {
      warnings.push(`Preço "${raw}" mencionado na resposta não corresponde a nenhum item do catálogo.`);
      hasPriceMismatch = true;
    }
  }

  // Catalog-item names are short and can legitimately appear as substrings of normal sentences,
  // so this only flags the reply if it uses catalog-topic language at all AND that language
  // doesn't match anything real — a coarse check, not a precise one, by design.
  const mentionsCatalogTopic = MENTIONS_CATALOG_TOPIC.test(reply);
  const mentionsKnownItem =
    knownNames.some((name) => reply.toLowerCase().includes(name)) ||
    knownLastWords.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(reply));
  const isDecline = DECLINE_PATTERN.test(reply);
  if (mentionsCatalogTopic && !mentionsKnownItem && !isDecline && catalog.length > 0) {
    warnings.push('A resposta fala sobre o catálogo mas não cita nenhum item reconhecido — possível invenção.');
  }

  for (const marker of LEAK_MARKERS) {
    if (reply.includes(marker)) {
      warnings.push(`Resposta contém "${marker}" — possível vazamento do prompt de sistema.`);
    }
  }

  if (RESIDUAL_FRAMING_PATTERN.test(reply)) {
    warnings.push(
      'Resposta ainda contém marcação de framing/safety após o parser — sanitizeReplyText pode ter uma lacuna, investigar.',
    );
  }

  return { ok: warnings.length === 0, warnings, hasPriceMismatch };
}
