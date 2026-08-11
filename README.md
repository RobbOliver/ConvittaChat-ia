# Convitta Chat — IA

Camada de IA do Convitta Chat: um assistente de atendimento via OpenRouter, **agnóstico de tipo de
negócio** — persona, catálogo e regras vêm de quem chama o serviço (o backend do Convitta Chat,
populado pelas Configurações de IA de cada conta), com múltiplas camadas de defesa contra prompt
injection e alucinação.

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
prompt exato — sistema + contexto do negócio + mensagem do cliente delimitada — que seria enviado,
usando `src/knowledge/exampleBusiness.ts` (um negócio fictício só pra esse teste local). Use isso
toda vez que editar `src/prompts/systemPrompt.ts` ou `src/core/buildBusinessContext.ts`.

**Enviar de verdade e ver a resposta do modelo:**

```bash
npm run send -- "Quanto custa a marmita G?"
```

## Rodando como serviço HTTP

Além dos CLIs acima (pra testar/revisar), há um servidor HTTP stateless em `src/server.ts` —
recebe uma mensagem (mais o negócio/cliente de quem está perguntando), devolve a resposta da IA, e
não guarda nenhuma conversa (quem guarda o histórico é o backend do Convitta Chat; este serviço só
processa).

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
    -d '{
      "message": "Quanto custa o corte masculino?",
      "history": [],
      "business": {
        "name": "Studio Bela Vista",
        "persona": "Tom acolhedor e elegante.",
        "hours": "Terça a sábado, 9h às 19h.",
        "paymentMethods": ["Pix", "Cartão"],
        "catalog": [
          { "id": "corte-masc", "name": "Corte masculino", "priceCents": 6000, "available": true }
        ]
      },
      "customer": {
        "fields": [{ "key": "endereco", "value": null }],
        "objective": "Confirmar horário e fechar agendamento"
      }
    }'
  ```

  `business` e `customer` são **opcionais** — se omitidos (só os CLIs locais fazem isso), o
  serviço cai no fixture de exemplo (`exampleBusiness.ts`), nunca em produção real. Nada aqui
  presume o tipo de negócio: `catalog` serve pra produto, serviço ou prato, e `persona`/
  `extraRules` são texto livre definido por quem administra a conta.

  Resposta:
  ```json
  {
    "reply": "Olá! O corte masculino custa R$ 60,00...",
    "blocked": false,
    "warnings": [],
    "model": "openrouter/free",
    "extracted": {
      "fields": { "endereco": "Rua Tal, 123" },
      "objective": "confirmar horário de sábado",
      "newFacts": ["prefere atendimento à tarde"]
    }
  }
  ```
  `blocked: true` quando o sanitizador recusou a mensagem antes de chamar o modelo (nesse caso
  `blockReason` explica por quê, e `reply` é a mensagem de recusa — `business.fallbackMessage` se
  configurada, senão um texto genérico). `warnings` traz qualquer coisa que o `outputValidator.ts`
  achou suspeita na resposta — vazio na maioria das vezes, não é motivo pra bloquear a resposta
  sozinho, é sinal pra revisão humana se for logado. `extracted` é sempre opcional e best-effort —
  se o modelo não seguir o formato pedido (comum em modelos gratuitos), simplesmente não vem, e a
  resposta ao cliente nunca é afetada por isso.

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
| `SERVICE_API_KEY` | um segredo longo e aleatório — gere com `openssl rand -hex 32`, o mesmo valor vai em `IA_SERVICE_API_KEY` no backend |
| `APP_URL` | a URL pública deste próprio serviço no Render |
| `APP_NAME` | `Convitta Chat IA` |

`PORT` não precisa ser definida — o Render injeta essa variável automaticamente.

**Build Command:** `npm install && npm run build`
**Start Command:** `npm run start`

Depois de configurar e o deploy subir, `GET https://SEU-SERVICO.onrender.com/health` deve
responder `{"ok":true}`.

**Por que `typescript` e os pacotes `@types/*` estão em `dependencies`, não em `devDependencies`**:
com `NODE_ENV=production` definido (que é exigido acima), o instalador de pacotes do Render pula
`devDependencies` — e como o Build Command roda `tsc` de verdade nesse mesmo ambiente, o próprio
compilador e os tipos do Node/Express precisam sobreviver a esse corte. Não mova esses pacotes de
volta para `devDependencies`; isso quebra o build exatamente como aconteceu antes dessa correção
(confirmado reproduzindo localmente com `npm install --omit=dev && npm run build`).

## Estrutura

```
src/
  config/env.ts              # carrega e valida variáveis de ambiente (zod)
  openrouter/client.ts        # cliente OpenRouter (SDK oficial da OpenAI, baseURL trocada)
  knowledge/exampleBusiness.ts # fixture de exemplo — só usado pelos CLIs locais, nunca em produção
  core/
    types.ts                  # formas compartilhadas (BusinessInput, CustomerInput, CatalogItem...)
    buildBusinessContext.ts   # monta o bloco <contexto_negocio> a partir de um BusinessInput real
    assemblePrompt.ts         # monta o array de mensagens (técnica "sandwich" de reforço de regras)
    parseStructuredReply.ts   # separa <resposta> de um <extracao> opcional na saída do modelo
    chat.ts                   # orquestra sanitize -> assemble -> OpenRouter -> parse -> validate
  prompts/systemPrompt.ts     # persona genérica + regras de segurança (grounding, escopo, anti-injection)
  security/
    inputSanitizer.ts         # bloqueia/neutraliza tentativas de prompt injection ANTES do modelo
    outputValidator.ts        # confere a resposta do modelo contra o catálogo real DEPOIS do modelo
  cli/
    preview.ts                 # ferramenta de revisão (sem chamada de API)
    send.ts                     # chamada real
  server.ts                     # servidor HTTP (Express) — /health e /chat
```

## Camadas de segurança

Nenhuma camada sozinha é tratada como suficiente — a defesa é em profundidade:

1. **Isolamento por delimitador** — a mensagem do cliente é envolvida em
   `<mensagem_cliente>...</mensagem_cliente>` e o prompt de sistema instrui explicitamente que
   conteúdo ali dentro nunca é uma instrução, mesmo que pareça uma. O mesmo isolamento vale pra
   tudo que o admin configurou (persona, regras extras) — entra em `<contexto_negocio>` como
   dado, nunca vira instrução de sistema.
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
   dados reais do catálogo, e se a resposta não vazou nenhum trecho do prompt de sistema.

As 5 regras de segurança do prompt e os padrões de bloqueio do sanitizador **não são
configuráveis** pelo admin da conta — só persona, catálogo, regras de negócio extras e mensagem de
fallback são. Isso é deliberado: enfraquecer essas camadas por configuração destruiria a garantia
que elas existem pra dar.

Isso reduz bastante o risco, mas nenhuma defesa baseada em prompt é 100% — é sensato tratar isso
como redução de risco, não como garantia absoluta, especialmente antes de dar ao assistente
qualquer ação com efeito real (finalizar um pedido, cobrar um valor).

## Integração com o Convitta Chat

O backend (`backend/src/modules/ai/`) chama este serviço via `POST /chat` sempre que uma
conversa individual (nunca grupo) com automação ligada recebe uma mensagem nova — monta `business`
a partir das Configurações de IA da conta (persona, catálogo, regras) e `customer` a partir dos
campos personalizados, objetivo e memória de longo prazo daquele contato específico. A resposta
(`reply`) é enviada de volta pelo WhatsApp pelo mesmo caminho usado para mensagens manuais, e
`extracted` (quando presente) é gravado nos campos/objetivo/memória do contato — tudo em código,
a IA só decide o quê, nunca como persistir.

## Antes de usar em produção

`src/knowledge/exampleBusiness.ts` contém dados de **exemplo** (nome, catálogo e preços
fictícios de uma marmitaria) — usado só pelos CLIs locais (`preview`/`send`) pra ter algo pra
mostrar sem precisar de conta configurada. Em produção, o backend sempre envia os dados reais de
cada conta; este arquivo nunca é usado fora de teste local.
