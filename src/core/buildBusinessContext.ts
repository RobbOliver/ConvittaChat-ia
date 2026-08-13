import { formatBRL } from './format.js';
import type { CatalogItem, BusinessInput } from './types.js';

function formatCatalogLine(item: CatalogItem): string {
  const price =
    item.pricingMode === 'BY_SIZE' && item.sizes?.length
      ? item.sizes.map((size) => `${size.label}: ${formatBRL(size.priceCents)}`).join(' / ')
      : formatBRL(item.priceCents);
  return `- ${item.name} (id: ${item.id}) — ${price}${item.description ? ` — ${item.description}` : ''}`;
}

/**
 * Renders the available catalog as plain text. When no item has a category, this is a flat list —
 * identical output to before categories existed, so accounts that don't use them see zero prompt
 * churn. Once at least one item has a category, everything groups under a "Categoria:" header
 * (uncategorized items fall into "Outros"), grouped in order of first appearance so the admin's own
 * catalog ordering still controls what the model sees first.
 */
function buildCatalogLines(catalog: CatalogItem[]): string {
  const available = catalog.filter((item) => {
    if (!item.available) return false;
    // A BY_SIZE item with no sizes saved yet has no real price to offer — omitting it beats
    // rendering a fabricated R$ 0,00 the admin never actually configured.
    if (item.pricingMode === 'BY_SIZE' && !item.sizes?.length) return false;
    return true;
  });
  const hasCategories = available.some((item) => item.category?.trim());
  if (!hasCategories) {
    return available.map(formatCatalogLine).join('\n');
  }

  const groups = new Map<string, CatalogItem[]>();
  for (const item of available) {
    const key = item.category?.trim() || 'Outros';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups.entries()]
    .map(([category, items]) => `${category}:\n${items.map(formatCatalogLine).join('\n')}`)
    .join('\n\n');
}

/**
 * The literal text block injected into the prompt as the assistant's only source of truth about
 * the business. Generic by construction — every field is optional except name/catalog, so it
 * renders sensibly whether the admin filled in everything or nothing yet.
 */
export function buildBusinessContext(business: BusinessInput): string {
  const catalogLines = buildCatalogLines(business.catalog);

  return [
    `Nome: ${business.name}`,
    // Persona/regras extras são texto livre do admin — entram aqui como DADO do negócio, nunca
    // como instrução de sistema (essas ficam fixas em systemPrompt.ts). Mesmo que o admin escreva
    // algo parecido com um comando, o isolamento por <contexto_negocio> nunca vira uma instrução.
    business.persona ? `Tom e estilo definidos pelo negócio: ${business.persona}` : null,
    business.hours ? `Horário: ${business.hours}` : null,
    business.serviceAreas?.length ? `Áreas atendidas: ${business.serviceAreas.join(', ')}` : null,
    business.paymentMethods?.length ? `Formas de pagamento: ${business.paymentMethods.join(', ')}` : null,
    business.minOrderCents ? `Valor mínimo: ${formatBRL(business.minOrderCents)}` : null,
    business.policies?.length ? `Políticas:\n${business.policies.map((p) => `- ${p}`).join('\n')}` : null,
    business.extraRules ? `Regras adicionais do negócio:\n${business.extraRules}` : null,
    catalogLines ? `Catálogo disponível:\n${catalogLines}` : 'Catálogo disponível: (ainda não cadastrado)',
  ]
    .filter((line): line is string => !!line)
    .join('\n\n');
}
