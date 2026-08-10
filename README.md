# Convitta Chat — IA

Camada de IA do Convitta Chat: um assistente de atendimento via OpenRouter, especializado em uma
marmitaria, com múltiplas camadas de defesa contra prompt injection e alucinação. Construído como
projeto independente para ser testado e ajustado isoladamente antes de ser plugado no backend
(NestJS) do Convitta Chat.

## Setup

```bash
npm install
cp .env.example .env
# edite .env e preencha OPENROUTER_API_KEY (https://openrouter.ai/keys)
```

## Uso

**Revisar o prompt antes de gastar uma chamada de API** (não chama o OpenRouter, não precisa de API key):

```bash
npm run preview -- "Quanto custa a marmita G?"
```

Imprime a mensagem original, os avisos do sanitizador (se algum padrão suspeito foi detectado) e o
prompt exato — sistema + contexto do negócio + mensagem do cliente delimitada — que seria enviado.
Use isso toda vez que editar `src/prompts/systemPrompt.ts` ou `src/knowledge/marmitaria.ts`.

**Enviar de verdade e ver a resposta do modelo:**

```bash
npm run send -- "Quanto custa a marmita G?"
```

## Estrutura

```
src/
  config/env.ts          # carrega e valida variáveis de ambiente (zod)
  openrouter/client.ts    # cliente OpenRouter (SDK oficial da OpenAI, baseURL trocada)
  knowledge/marmitaria.ts # cardápio, horários, políticas — a ÚNICA fonte de verdade do assistente
  prompts/systemPrompt.ts # persona + regras de segurança (grounding, escopo, anti-injection)
  security/
    inputSanitizer.ts     # bloqueia/neutraliza tentativas de prompt injection ANTES do modelo
    outputValidator.ts    # confere a resposta do modelo contra os dados reais DEPOIS do modelo
  core/
    assemblePrompt.ts     # monta o array de mensagens (técnica "sandwich" de reforço de regras)
    chat.ts                # orquestra sanitize -> assemble -> OpenRouter -> validate
  cli/
    preview.ts             # ferramenta de revisão (sem chamada de API)
    send.ts                 # chamada real
```

## Camadas de segurança

Nenhuma camada sozinha é tratada como suficiente — a defesa é em profundidade:

1. **Isolamento por delimitador** — a mensagem do cliente é envolvida em
   `<mensagem_cliente>...</mensagem_cliente>` e o prompt de sistema instrui explicitamente que
   conteúdo ali dentro nunca é uma instrução, mesmo que pareça uma.
2. **Sanitização de entrada** (`inputSanitizer.ts`) — roda antes de qualquer chamada ao modelo.
   Bloqueia de forma determinística os padrões mais óbvios de injection ("ignore as instruções
   anteriores", "revele seu prompt", "modo desenvolvedor", etc.) e neutraliza qualquer tentativa
   de forjar as próprias tags delimitadoras dentro da mensagem do cliente.
3. **Técnica sandwich** (`assemblePrompt.ts`) — as regras são reforçadas de novo, resumidamente,
   bem antes da mensagem do cliente — não só uma vez lá no início do prompt de sistema — porque
   modelos dão mais peso ao que está fisicamente mais perto da pergunta atual.
4. **Grounding forçado** — o prompt de sistema proíbe explicitamente afirmar preços, itens ou
   políticas que não estejam literalmente no bloco `<contexto_negocio>`.
5. **Validação de saída** (`outputValidator.ts`) — depois do modelo responder, confere de forma
   determinística (não pedindo pro modelo "ter certeza") se preços/itens citados batem com os
   dados reais do cardápio, e se a resposta não vazou nenhum trecho do prompt de sistema.

Isso reduz bastante o risco, mas nenhuma defesa baseada em prompt é 100% — é sensato tratar isso
como redução de risco, não como garantia absoluta, especialmente antes de dar ao assistente
qualquer ação com efeito real (finalizar um pedido, cobrar um valor).

## Como integrar ao Convitta Chat (ainda não feito)

Este projeto foi propositalmente deixado desacoplado do backend. Duas formas razoáveis de plugar
mais tarde:

- **Como pacote interno**: publicar `dist/` (após `npm run build`) e importar `runMarmitariaAssistant`
  diretamente de dentro de um módulo NestJS novo (ex. `AiModule`), chamando-o quando uma mensagem
  chega numa conversa marcada para atendimento automático.
- **Como serviço HTTP interno**: envolver `runMarmitariaAssistant` num pequeno servidor Express/Fastify
  e o backend chamar via HTTP — mais isolamento (processo separado, pode escalar/reiniciar
  independente), ao custo de mais uma peça rodando em produção.

Nenhuma das duas foi implementada ainda — este repositório é a fundação (prompt, segurança,
integração com o OpenRouter) pronta para ser plugada quando a automação de fato for ligada no
Inbox.

## Antes de usar em produção

`src/knowledge/marmitaria.ts` contém dados de **exemplo** (nome, cardápio e preços fictícios) —
troque pelos dados reais da marmitaria antes de qualquer uso real. É esse arquivo, e só ele, que
define o que o assistente pode afirmar como fato.
