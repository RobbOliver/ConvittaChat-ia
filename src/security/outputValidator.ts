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
const KNOWN_PRICES = new Set(menu.map((item) => formatBRL(item.priceCents)));
const KNOWN_NAMES = menu.map((item) => item.name.toLowerCase());

const LEAK_MARKERS = ['<contexto_negocio>', '<mensagem_cliente>', 'REGRAS DE SEGURANÇA', 'prompt de sistema'];

export function validateOutput(reply: string): ValidationResult {
  const warnings: string[] = [];

  const pricesMentioned = reply.match(PRICE_PATTERN) ?? [];
  for (const raw of pricesMentioned) {
    const normalized = raw.replace(/\s/g, '');
    if (!KNOWN_PRICES.has(normalized)) {
      warnings.push(`Preço "${raw}" mencionado na resposta não corresponde a nenhum item do cardápio.`);
    }
  }

  // Menu-item names are short and can legitimately appear as substrings of normal sentences, so
  // this only flags the reply if it uses "cardápio"/"marmita"/menu language at all AND that
  // language doesn't match anything real — a coarse check, not a precise one, by design.
  const mentionsMenuTopic = /marmita|card[áa]pio|prato/i.test(reply);
  const mentionsKnownItem = KNOWN_NAMES.some((name) => reply.toLowerCase().includes(name));
  if (mentionsMenuTopic && !mentionsKnownItem && menu.length > 0) {
    warnings.push('A resposta fala sobre o cardápio mas não cita nenhum item reconhecido — possível invenção.');
  }

  for (const marker of LEAK_MARKERS) {
    if (reply.includes(marker)) {
      warnings.push(`Resposta contém "${marker}" — possível vazamento do prompt de sistema.`);
    }
  }

  return { ok: warnings.length === 0, warnings };
}
