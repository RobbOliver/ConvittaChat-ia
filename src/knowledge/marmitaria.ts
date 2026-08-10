/**
 * The assistant's entire factual world — everything it's allowed to state as fact must come from
 * here, not from the model's own "knowledge". This is what both the system prompt's grounding
 * instruction and outputValidator.ts's checks are anchored to: if a price or item isn't in this
 * file, the assistant is instructed to say so instead of guessing, and a reply that mentions one
 * anyway gets flagged. EXEMPLO — troque pelos dados reais da marmitaria antes de usar em produção.
 */

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: 'marmita' | 'bebida' | 'sobremesa' | 'adicional';
  available: boolean;
}

export interface BusinessInfo {
  name: string;
  hours: string;
  deliveryAreas: string[];
  paymentMethods: string[];
  minOrderCents: number | null;
  policies: string[];
}

export const businessInfo: BusinessInfo = {
  name: 'Marmitaria Sabor Caseiro',
  hours: 'Segunda a sábado, 10h30 às 14h30 (almoço) e 18h às 21h (jantar). Fechado aos domingos.',
  deliveryAreas: ['Centro', 'Jardim das Flores', 'Vila Nova'],
  paymentMethods: ['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'],
  minOrderCents: 2500,
  policies: [
    'Pedidos feitos até 30 minutos antes do fechamento ainda são aceitos.',
    'Entrega gratuita acima de R$ 50,00; abaixo disso, taxa fixa de R$ 5,00.',
    'Cancelamento só é possível antes de o pedido entrar em preparo.',
  ],
};

export const menu: MenuItem[] = [
  {
    id: 'marmita-p',
    name: 'Marmita P (300g)',
    description: 'Arroz, feijão, 1 proteína e 2 acompanhamentos do dia.',
    priceCents: 1800,
    category: 'marmita',
    available: true,
  },
  {
    id: 'marmita-m',
    name: 'Marmita M (500g)',
    description: 'Arroz, feijão, 1 proteína e 3 acompanhamentos do dia.',
    priceCents: 2200,
    category: 'marmita',
    available: true,
  },
  {
    id: 'marmita-g',
    name: 'Marmita G (700g)',
    description: 'Arroz, feijão, 2 proteínas e 3 acompanhamentos do dia.',
    priceCents: 2800,
    category: 'marmita',
    available: true,
  },
  {
    id: 'marmita-fit',
    name: 'Marmita Fit',
    description: 'Arroz integral, frango grelhado, legumes no vapor. Sem fritura.',
    priceCents: 2400,
    category: 'marmita',
    available: true,
  },
  {
    id: 'suco-laranja',
    name: 'Suco de laranja (500ml)',
    description: 'Suco natural, feito na hora.',
    priceCents: 700,
    category: 'bebida',
    available: true,
  },
  {
    id: 'refrigerante-lata',
    name: 'Refrigerante (lata)',
    description: '',
    priceCents: 600,
    category: 'bebida',
    available: true,
  },
  {
    id: 'pudim',
    name: 'Pudim de leite (fatia)',
    description: '',
    priceCents: 800,
    category: 'sobremesa',
    available: true,
  },
];

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** The literal text block injected into the prompt as the assistant's only source of truth. */
export function buildBusinessContext(): string {
  const menuLines = menu
    .filter((item) => item.available)
    .map((item) => `- ${item.name} (id: ${item.id}) — ${formatBRL(item.priceCents)}${item.description ? ` — ${item.description}` : ''}`)
    .join('\n');

  return [
    `Nome: ${businessInfo.name}`,
    `Horário: ${businessInfo.hours}`,
    `Áreas de entrega: ${businessInfo.deliveryAreas.join(', ')}`,
    `Formas de pagamento: ${businessInfo.paymentMethods.join(', ')}`,
    businessInfo.minOrderCents ? `Pedido mínimo: ${formatBRL(businessInfo.minOrderCents)}` : null,
    `Políticas:\n${businessInfo.policies.map((p) => `- ${p}`).join('\n')}`,
    `Cardápio disponível:\n${menuLines}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
