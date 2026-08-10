import { formatBRL, menu } from '../knowledge/marmitaria.js';

/**
 * Second line of defense — deterministic, code-level checks on the model's *reply*, not just its
 * input. Prompt instructions ("only use the provided context") are a strong nudge but not a
 * guarantee; a model can still hallucinate a price or an item under the right pressure. This
 * doesn't rewrite the reply (that's a product decision, not a security one) — it flags anything
 * that doesn't check out against the actual menu data, so the caller can decide whether to show a
 * warning, log it for review, or regenerate.
 */

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
}

const PRICE_PATTERN = /R\$\s?(\d{1,4}(?:[.,]\d{2})?)/g;

// toLocaleString('pt-BR', {style:'currency', ...}) inserts a NON-BREAKING space (U+00A0)
// between "R$" and the number, not a regular one — a model writing plain text never does
// that, so both sides must go through the exact same whitespace-stripping before comparison,
// or every real price mismatches its own known-good value.
function normalizePrice(value: string): string {
  return value.replace(/[\s\u00a0]/g, '');
}

const KNOWN_PRICES = new Set(menu.map((item) => normalizePrice(formatBRL(item.priceCents))));

// Menu names carry a parenthetical size/detail ("Marmita G (700g)") that a model naturally omits
// when referring to the item conversationally ("a marmita G") — match against both the full name
// and everything before the parenthetical, so a normal phrasing doesn't get flagged as unknown.
function baseName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}

const KNOWN_NAMES = menu.flatMap((item) => [item.name.toLowerCase(), baseName(item.name).toLowerCase()]);

// A model listing several sizes together ("temos P, M, G e Fit") never repeats the full "marmita"
// prefix per item — only the last significant word (P/M/G/Fit) distinguishes them. Matched as a
// whole word so a stray "p" elsewhere in the reply doesn't count.
const KNOWN_LAST_WORDS = Array.from(
  new Set(menu.map((item) => baseName(item.name).split(/\s+/).pop()?.toLowerCase()).filter((w): w is string => !!w)),
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A correct "we don't have that" refusal is exactly the grounded behavior the system prompt asks
// for — it legitimately names no real item, so it shouldn't itself read as a possible invention.
const DECLINE_PATTERN =
  /n[ãa]o\s+(temos|tenho|est[áa])|n[ãa]o\s+consta|vou\s+confirmar|n[ãa]o\s+dispon[íi]vel/i;

const LEAK_MARKERS = ['<contexto_negocio>', '<mensagem_cliente>', 'REGRAS DE SEGURANÇA', 'prompt de sistema'];

export function validateOutput(reply: string): ValidationResult {
  const warnings: string[] = [];

  const pricesMentioned = reply.match(PRICE_PATTERN) ?? [];
  for (const raw of pricesMentioned) {
    if (!KNOWN_PRICES.has(normalizePrice(raw))) {
      warnings.push(`Preço "${raw}" mencionado na resposta não corresponde a nenhum item do cardápio.`);
    }
  }

  // Menu-item names are short and can legitimately appear as substrings of normal sentences, so
  // this only flags the reply if it uses "cardápio"/"marmita"/menu language at all AND that
  // language doesn't match anything real — a coarse check, not a precise one, by design.
  const mentionsMenuTopic = /marmita|card[áa]pio|prato/i.test(reply);
  const mentionsKnownItem =
    KNOWN_NAMES.some((name) => reply.toLowerCase().includes(name)) ||
    KNOWN_LAST_WORDS.some((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(reply));
  const isDecline = DECLINE_PATTERN.test(reply);
  if (mentionsMenuTopic && !mentionsKnownItem && !isDecline && menu.length > 0) {
    warnings.push('A resposta fala sobre o cardápio mas não cita nenhum item reconhecido — possível invenção.');
  }

  for (const marker of LEAK_MARKERS) {
    if (reply.includes(marker)) {
      warnings.push(`Resposta contém "${marker}" — possível vazamento do prompt de sistema.`);
    }
  }

  return { ok: warnings.length === 0, warnings };
}
