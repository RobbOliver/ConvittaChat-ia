import type { BusinessInput } from '../core/types.js';

/**
 * A fictitious example business, used ONLY by the local CLI tools (`preview`/`send`) so they have
 * something to render without needing the real backend running or an account configured. Never
 * used in production — there, the Convitta Chat backend always sends the admin's real `business`
 * data (see server.ts's `/chat` contract), whatever kind of business that happens to be.
 */
export const exampleBusiness: BusinessInput = {
  name: 'Marmitaria Sabor Caseiro (exemplo)',
  persona: 'Tom caloroso e direto, como quem atende no balcão.',
  hours: 'Segunda a sábado, 10h30 às 14h30 (almoço) e 18h às 21h (jantar). Fechado aos domingos.',
  serviceAreas: ['Centro', 'Jardim das Flores', 'Vila Nova'],
  paymentMethods: ['Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'],
  minOrderCents: 2500,
  policies: [
    'Pedidos feitos até 30 minutos antes do fechamento ainda são aceitos.',
    'Entrega gratuita acima de R$ 50,00; abaixo disso, taxa fixa de R$ 5,00.',
    'Cancelamento só é possível antes de o pedido entrar em preparo.',
  ],
  catalog: [
    {
      id: 'marmita-p',
      name: 'Marmita P (300g)',
      description: 'Arroz, feijão, 1 proteína e 2 acompanhamentos do dia.',
      pricingMode: 'FLAT',
      priceCents: 1800,
      available: true,
    },
    {
      id: 'marmita-m',
      name: 'Marmita M (500g)',
      description: 'Arroz, feijão, 1 proteína e 3 acompanhamentos do dia.',
      pricingMode: 'FLAT',
      priceCents: 2200,
      available: true,
    },
    {
      id: 'marmita-g',
      name: 'Marmita G (700g)',
      description: 'Arroz, feijão, 2 proteínas e 3 acompanhamentos do dia.',
      pricingMode: 'FLAT',
      priceCents: 2800,
      available: true,
    },
    {
      id: 'marmita-fit',
      name: 'Marmita Fit',
      description: 'Arroz integral, frango grelhado, legumes no vapor. Sem fritura.',
      pricingMode: 'FLAT',
      priceCents: 2400,
      available: true,
    },
    {
      id: 'suco-laranja',
      name: 'Suco de laranja (500ml)',
      description: 'Suco natural, feito na hora.',
      pricingMode: 'FLAT',
      priceCents: 700,
      available: true,
    },
    {
      id: 'refrigerante-lata',
      name: 'Refrigerante (lata)',
      description: '',
      pricingMode: 'FLAT',
      priceCents: 600,
      available: true,
    },
    {
      id: 'pudim',
      name: 'Pudim de leite (fatia)',
      description: '',
      pricingMode: 'FLAT',
      priceCents: 800,
      available: true,
    },
  ],
};
