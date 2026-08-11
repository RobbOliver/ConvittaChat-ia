import { formatBRL } from './format.js';
import type { BusinessInput } from './types.js';

/**
 * The literal text block injected into the prompt as the assistant's only source of truth about
 * the business. Generic by construction — every field is optional except name/catalog, so it
 * renders sensibly whether the admin filled in everything or nothing yet.
 */
export function buildBusinessContext(business: BusinessInput): string {
  const catalogLines = business.catalog
    .filter((item) => item.available)
    .map(
      (item) =>
        `- ${item.name} (id: ${item.id}) — ${formatBRL(item.priceCents)}${item.description ? ` — ${item.description}` : ''}`,
    )
    .join('\n');

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
