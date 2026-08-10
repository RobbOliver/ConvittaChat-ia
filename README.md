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

## Rodando como serviço HTTP

Além dos CLIs acima (pra testar/revisar), há um servidor HTTP stateless em `src/server.ts` —
recebe uma mensagem, devolve a resposta da IA, e não guarda nenhuma conversa (quem guarda o
histórico é o backend do Convitta Chat; este serviço só processa).

**Local:**

```bash
npm run dev:server   # tsx watch, recarrega sozinho a cada mudança
```

Sobe em `http://localhost:3001` por padrão (`PORT` no `.env` muda a porta).

**Endpoints:**

- `GET /health` — checagem de saúde (sem autenticação; é o que o Render usa pra saber se o serviço está de pé).
- `GET /` — informação básica (nome, status, modelo em uso).
- `POST /chat` — o endpoint de verdade. Limitado a 20 requisições/minuto por IP.

  ```bash
  curl -X POST http://localhost:3001/chat \
    -H "Content-Type: application/json" \
    -H "x-api-key: SUA_SERVICE_API_KEY" \
    -d '{"message": "Quanto custa a marmita G?", "history": []}'
  ```

  Resposta:
  ```json
  {
    "reply": "A marmita G custa R$ 28,00 e entregamos na Vila Nova.",
    "blocked": false,
    "warnings": [],
    "model": "openrouter/free"
  }
  ```
  `blocked: true` quando o sanitizador recusou a mensagem antes de chamar o modelo (nesse caso
  `blockReason` explica por quê). `warnings` traz qualquer coisa que o `outputValidator.ts`
  achou suspeita na resposta — vazio na maioria das vezes, não é motivo pra bloquear a resposta
  sozinho, é sinal pra revisão humana se for logado.

**Autenticação**: todo `POST /chat` exige o header `x-api-key` batendo com `SERVICE_API_KEY` do
`.env`. Localmente, se você deixar `SERVICE_API_KEY` em branco, a autenticação fica desligada (só
por conveniência de teste). **Em produção isso não é permitido** — o servidor se recusa a subir
se `NODE_ENV=production` e `SERVICE_API_KEY` não estiver definida, exatamente pra nunca deixar o
endpoint público sem trava por esquecimento.

## Deploy no Render

O Render detecta esse repositório como um projeto Node e por padrão tenta rodar `yarn start` —
que só funciona se as variáveis de ambiente abaixo estiverem configuradas primeiro no painel do
serviço (aba **Environment**):

| Variável | Valor |
|---|---|
| `OPENROUTER_API_KEY` | sua chave real da OpenRouter |
| `OPENROUTER_MODEL` | `openrouter/free` (ou outro id do catálogo) |
| `NODE_ENV` | `production` |
| `SERVICE_API_KEY` | um segredo longo e aleatório — gere com `openssl rand -hex 32` |
| `APP_URL` | a URL pública deste próprio serviço no Render |
| `APP_NAME` | `Convitta Chat IA` |

`PORT` não precisa ser definida — o Render injeta essa variável automaticamente.

**Build Command:** `npm install && npm run build`
**Start Command:** `npm run start`

Depois de configurar e o deploy subir, `GET https://SEU-SERVICO.onrender.com/health` deve
responder `{"ok":true}`.

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
  server.ts                 # servidor HTTP (Express) — /health e /chat
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

O servidor HTTP (`src/server.ts`) já está pronto e deployável — o que falta é o **backend do
Convitta Chat de fato chamá-lo**. Isso ainda não foi feito: nenhuma conversa do Inbox aciona esse
serviço hoje. Quando for a hora, o caminho natural é o `ConversationsController`/`WhatsappService`
do backend (`backend/src/modules/...`) fazer um `POST /chat` pra este serviço (com `x-api-key`)
quando uma mensagem chega numa conversa marcada para atendimento automático, e usar `reply` como o
texto a enviar de volta pelo WhatsApp — reaproveitando o mesmo `sock.sendMessage` que já existe
pra mensagens manuais.

## Antes de usar em produção

`src/knowledge/marmitaria.ts` contém dados de **exemplo** (nome, cardápio e preços fictícios) —
troque pelos dados reais da marmitaria antes de qualquer uso real. É esse arquivo, e só ele, que
define o que o assistente pode afirmar como fato.
