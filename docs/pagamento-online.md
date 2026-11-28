# Pagamento online do Taaki Delivery (Mercado Pago, Split 1:1)

Plano escrito em 2026-11-25, a partir da `main` em `08886ef` (merge do lote do mapa). Cada etapa abaixo é uma sessão separada, numa branch própria, com commits pequenos em português e sem merge nem push sem autorização do dono.

## 1. Estado atual (o que o pagamento vai tocar)

### Como o pedido nasce hoje

- O app e o site usam a mesma rota: `POST /api/cliente/pedidos` (canal `SITE`; o app manda `lojaSlug`). O PDV usa `POST /api/equipe/pedidos` (canal `WHATSAPP`) e as comandas (`SALAO`).
- Tudo passa por `criarPedido` (`api/src/services/pedido.service.js`): checagem de idempotência, distância (fora da transação) e uma transação que confere loja aberta (só `SITE`), produtos, taxa da área de entrega, frete grátis, total esperado (`PRECO_ALTERADO`), forma de pagamento, **baixa o estoque**, **pega o número do dia** (`ContadorPedido`), grava o pedido com status inicial `CONFIRMADO` e **cria o `TrabalhoImpressao` PEDIDO**.
- Depois do commit saem `pedido:novo` e `impressao:nova` na sala `equipe:<lojaId>`. Ou seja: **hoje o pedido chega ao PDV (painel e impressora) no mesmo instante em que é criado**.
- O pagamento é sempre na entrega: `formaPagamento` (`PIX`, `DINHEIRO`, `DEBITO`, `CREDITO`) é só a intenção do cliente; a equipe confirma (e pode trocar) a forma ao finalizar (`PATCH /equipe/pedidos/:id/finalizar`), o que exige caixa aberto e grava `caixaId`. O "pago agora" do PDV grava `pagoEm` (CHECK: `pagoEm` exige forma **e** `caixaId`).

### Status que existem

- `ABERTO` (comanda do salão e "Em aberto" do delivery), `CONFIRMADO` (inicial do site/app e do WhatsApp; o PDV mostra "Em aberto"), `EM_PREPARO`, `SAIU_ENTREGA` (uso interno do PDV), `FINALIZADO` e `CANCELADO`.
- `STATUS_ABERTOS` (os quatro primeiros) governa fila do PDV, finalizar, cancelar, alterar status e o bloqueio do fechamento de caixa. Cancelar devolve o estoque (ESTORNO das VENDA) e cria cupom de CANCELAMENTO.

### O que não existe hoje

- Nenhum conceito de entregador, de "entrega pela plataforma" ou de "motoboy próprio" (nem na `Loja`, nem no `Pedido`).
- A taxa por km (`shared/src/taxaKm.js`) está pronta e testada, mas **não é cobrada**: o pedido usa a taxa da área de entrega da loja.
- Nenhuma campanha da plataforma (frete grátis ou desconto bancado pela plataforma). O frete grátis atual é configuração **da loja** (`Loja.freteGratis*`); desconto só existe no PDV (`descontoCentavos`, canal `WHATSAPP`).
- Nenhuma criptografia simétrica no código (só HMAC dos refresh tokens e bcrypt).
- O app não tem `expo-web-browser` nem `expo-clipboard` (só `expo-linking`).

## 2. Decisões já tomadas (não reabrir)

- **Mercado Pago Split 1:1.** Cada loja conecta a **própria** conta Mercado Pago por OAuth (authorization code, scope `offline_access`). O valor dos produtos cai na conta da loja; a plataforma recebe a taxa de entrega pelo split.
- **Pix dentro do app**: Checkout Transparente, `POST /v1/payments` com `payment_method_id: "pix"` e `application_fee`, autenticado com o `access_token` **da loja**. **Não usar a API Orders** (`/v1/orders`).
- **Cartão de crédito**: Checkout Pro (`POST /checkout/preferences` com `marketplace_fee`, token **da loja**), aberto em navegador in-app (`expo-web-browser`). Permite pagar sem conta Mercado Pago. **Sem parcelamento.**
- **Maquininha da loja** só para lojas com motoboy próprio. **Dinheiro na entrega continua.**
- **Receita**: a plataforma **não** cobra comissão por pedido. As lojas pagam mensalidade, cobrada fora deste sistema (fora do escopo).
- **Taxa de entrega com entregador da plataforma**: R$ 1,00 + R$ 0,90/km (a regra já existe; não mexer nela). Essa taxa é da plataforma: **95% para o entregador, 5% para a plataforma**. Loja com motoboy próprio cobra a própria taxa, que é dela.
- **Comissão enviada ao Mercado Pago** (`application_fee` / `marketplace_fee`), calculada **sempre no servidor**: loja com entregador da plataforma = taxa de entrega cobrada do cliente (frete grátis = zero); loja com motoboy próprio = zero. **Zero = não enviar o campo.**
- **Registro por pedido** com entregador da plataforma: valor devido ao entregador (95% da taxa de entrega, **mesmo com frete grátis**) e a parte da plataforma (5%), para a conferência do pagamento diário dos entregadores. Pagar os entregadores continua manual e fora do escopo.
- **Frete grátis da campanha** é bancado pela plataforma: o cliente não paga a taxa e a plataforma paga o entregador do próprio bolso. Não gera crédito à loja.
- **Desconto em produto bancado pela plataforma** vira **crédito da loja** no fechamento semanal (o split não manda dinheiro da plataforma para a loja).
- **Tarifa do Mercado Pago** sai da loja, sobre o total do pedido. O sistema não compensa.
- **Pix expira em 15 minutos.**
- Pedido pago online nasce **`AGUARDANDO_PAGAMENTO`** e só chega ao PDV depois de aprovado.
- **Dinheiro na entrega com entregador da plataforma**: o entregador entrega o valor inteiro à loja, a loja confirma "recebi o dinheiro" no PDV e fica devendo a taxa de entrega, acertada no fechamento semanal.
- **Fora do escopo deste lote**: o saldo diário dos entregadores (soma das entregas do dia na retaguarda/admin). Só os valores por pedido ficam gravados para esse lote futuro.

## 3. Visão geral da solução

- **Duas dimensões novas no pedido**, gravadas na criação e nunca recalculadas: quem entrega (`PLATAFORMA` ou `LOJA`) e como paga (`NA_ENTREGA` ou `ONLINE`, com o meio online `PIX` ou `CARTAO`).
- **Um registro de pagamento por tentativa** (`PagamentoOnline`), com o id do Mercado Pago, o status do Mercado Pago, o valor, a comissão enviada, a expiração e o retorno cru resumido (sem dado de cartão, que nunca passa pelo servidor).
- **A fonte da verdade é sempre `GET /v1/payments/:id`** com o token da loja: o webhook só avisa que algo mudou; o app consulta o próprio pedido. Nenhuma mudança de status vem do corpo do webhook ou do app.
- **Transições condicionadas** (`UPDATE … WHERE status = 'AGUARDANDO_PAGAMENTO'`), como já é feito em finalizar e cancelar: webhook, consulta do app e rotina de expiração podem rodar ao mesmo tempo e só um vence.
- **Divisão do dinheiro calculada num lugar só** (`shared/src/split.js`, puro e testado), usada pela API (valor enviado ao Mercado Pago, valores gravados) e pela tela (prévia).
- **Tokens da loja cifrados** com AES-256-GCM (`node:crypto`), chave em variável de ambiente; nunca saem da API, nunca vão a log.
- **Liga e desliga em dois níveis**: variável `PAGAMENTO_ONLINE` (plataforma inteira, vazia = desligado) e `Loja.pagamentoOnlineAtivo` (cada loja, só vale com a conta conectada e saudável). Desligado = tudo como hoje.

## 4. Etapas

### Etapa 2 — Base (CONCLUÍDA em 2026-11-25, branch `feat/pagamento-online`)

**Feito** (o texto abaixo foi o plano; onde diverge, vale isto e as Decisões da Etapa 2):
- Migrations `20261126120000_pagamento_online_status` (`AGUARDANDO_PAGAMENTO`, `EXPIRADO`) e `20261126120100_pagamento_online_base` (só aditiva, menos `numeroDia` que aceita nulo só nesses dois status), aplicadas no banco de dev com `migrate diff` sem diferença. Modelos `ConexaoMercadoPago`, `Pagamento`, `EventoWebhook`, `UsoCampanhaFreteGratis`, `LancamentoLoja` (com `TAXA_ENTREGA_COMPLEMENTO`; trigger: só inserção, só pode ganhar o fechamento) e `FechamentoSemanal`; `Loja.modoEntrega` (`PROPRIO` padrão) e `pagamentoOnlineAtivo`; `Pedido.origemFreteGratis`, `origemTaxaEntrega` (`KM` | `AREA`), `valorEntregadorCentavos`, `valorPlataformaEntregaCentavos`.
- `shared/src/split.js` (`calcularSplit`, `dividirTaxaEntrega`) e `shared/src/formasPagamento.js`.
- `api/src/lib/cifra.js` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) e `api/src/lib/pagamentoOnline.js` (`PAGAMENTO_ONLINE_ATIVO`, `FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS`); a API não sobe com a flag ligada e a chave inválida.
- `api/src/services/campanha.service.js` (elegível, reservar, usar, liberar); finalizar usa, cancelar libera.
- Pedidos aguardando pagamento e expirados fora do PDV (`ehDaLoja` e lista do dia); o expirado não bloqueia a exclusão da conta.
- `criarPedido`: em loja `PLATAFORMA`, pedido do cliente sem pino = 422 `PINO_OBRIGATORIO` e, pago na entrega, só dinheiro (422 `FORMA_INDISPONIVEL`; retirada e "pago agora" aceitam todas). `formasPagamento` na config pública.
- Piso do frete grátis da loja `PLATAFORMA` (API e retaguarda › Configurações, conferido no Chrome a 390 e 1280 px).

**Pendências para as próximas etapas** (anotadas aqui para não se perderem):
- Etapa 3: ao o ADMIN mudar uma loja para `PLATAFORMA`, conferir o piso do frete grátis já ligado (hoje só o `PUT /retaguarda/config` confere).
- Etapa 4: app e site usam o mesmo canal `SITE`. Pagamento online e campanha "só no app" precisam de uma forma de distinguir o app (canal novo ou campo de origem). Até lá, o site numa loja `PLATAFORMA` leva `PINO_OBRIGATORIO` (o site não marca pino).
- Etapa 4: a criação liga a reserva da campanha, a aprovação o uso e a expiração a liberação (as funções existem); o `split.js` entra no `criarPedido`, que grava origem da taxa e divisão 95/5.
- Etapa 4: taxa digitada no PDV (`taxaEntregaCentavos`) em loja `PLATAFORMA`: definir se vale e com que origem.
- Etapa 4: o app oferece "verifique seu telefone para ganhar frete grátis na primeira compra" no checkout.


Objetivo: banco, status, flags, criptografia e cálculo do split, sem nenhuma chamada ao Mercado Pago, sem telas novas e sem mudar a criação do pedido (que passa a usar o split na etapa 4). Com a flag desligada, tudo fica como hoje. Texto revisto em 2026-11-25 conforme as Decisões.

Migrations (não destrutivas; os CHECKs no SQL, como nas outras):
- `<data>_pagamento_online_status`: só os valores novos do enum `StatusPedido` (`AGUARDANDO_PAGAMENTO`, `EXPIRADO`), em migration própria porque o Postgres exige commit antes de usar o valor (como foi com `ADMIN`).
- `<data>_pagamento_online_base`:
  - `Loja.modoEntrega` (`PLATAFORMA` | `PROPRIO`, padrão `PROPRIO`: todas as lojas existentes, a Cabana inclusive; só o ADMIN altera, na etapa 3) e `Loja.pagamentoOnlineAtivo` (padrão false).
  - `ConexaoMercadoPago` (uma por loja): `lojaId` único, `mpUserId`, `accessTokenCifrado`, `refreshTokenCifrado`, `publicKey`, `expiraEm`, `status` (`CONECTADA` | `EXPIRADA` | `DESCONECTADA`), `conectadaEm`.
  - `Pagamento`: `pedidoId`, `metodo` (`PIX` | `CARTAO_ONLINE`), `status` (`PENDENTE` | `APROVADO` | `RECUSADO` | `EXPIRADO` | `REEMBOLSADO` | `REEMBOLSO_PENDENTE`), `mpPaymentId` e `mpPreferenceId` (únicos), `valorTotalCentavos`, `valorPlataformaCentavos` (o que vai no split; 0 = campo omitido), `idempotencyKey` (única), `expiraEm`, `pixQrCode`, `pixQrCodeBase64`, `dadosMp` (JSON com os campos relevantes da resposta, sem dado pessoal além do necessário), `criadoEm`, `atualizadoEm`.
  - `EventoWebhook`: dedupe (chave única) e auditoria, sem dado pessoal.
  - `Pedido`: `numeroDia` opcional (nulo enquanto aguarda pagamento; atribuído só na aprovação, Decisão 6; o único `[lojaId, dataRef, numeroDia]` continua valendo para os números preenchidos), `origemFreteGratis` (`NENHUM` | `LOJA` | `CAMPANHA`, padrão `NENHUM`), `valorEntregadorCentavos` e `valorPlataformaEntregaCentavos` (só com entregador da plataforma; CHECK: os dois ou nenhum).
  - `UsoCampanhaFreteGratis`: `telefone` único (um por telefone), `pedidoId`, `situacao` e datas. Só conta como usado quando o pedido é aprovado ou concluído; expirado ou cancelado não consome.
  - `LancamentoLoja` (livro-razão): `lojaId`, `pedidoId` opcional, `tipo` (`TAXA_ENTREGA_DINHEIRO` | `CREDITO_CAMPANHA` | `AJUSTE_MANUAL` | `ESTORNO`), `valorCentavos` com sinal, `observacao`, `fechamentoId` opcional, `criadoEm`.
  - `FechamentoSemanal`: `lojaId`, `inicio`, `fim` (segunda a domingo pelo dia operacional, Decisão 15), `saldoCentavos`, `status` (`ABERTO` | `AGUARDANDO_PAGAMENTO` | `QUITADO`), `quitadoEm`, `observacao`.
  - E-mail do cliente (Decisão 13): `Cliente.email` já existe; nada a criar.

Código:
- `shared/src/split.js` (puro): recebe subtotal, `modoEntrega`, a taxa (por km via `taxaKm.js` em `PLATAFORMA`, da área em `PROPRIO`), o frete grátis da loja e a elegibilidade da campanha; devolve o valor cobrado do cliente, `origemFreteGratis`, o valor da plataforma no split, `valorEntregador` (95% meio para cima) e `valorPlataformaEntrega`, e o crédito da loja (taxa da área quando é campanha em loja `PROPRIO`). Segue as Decisões 4, 12 e 16 (os dois frete grátis juntos: vale o da loja e a campanha não é consumida).
- `shared/src/formasPagamento.js` (puro): formas por tipo de loja e disponibilidade do online (Decisão 11).
- `api/src/lib/cifra.js`: AES-256-GCM com `TOKEN_ENCRYPTION_KEY` (hex de 32 bytes); `server.js` não sobe com `PAGAMENTO_ONLINE_ATIVO` ligado e a chave ausente ou inválida.
- `api/src/lib/pagamentoOnline.js`: leitura da flag e `pagamentoOnlineDisponivel(loja, conexao)` (flag ligada + `pagamentoOnlineAtivo` + conexão `CONECTADA`).
- Service da campanha (reservar, confirmar, liberar) com as transições testadas; ligado à criação e à aprovação do pedido na etapa 4.
- Pedidos `AGUARDANDO_PAGAMENTO` e `EXPIRADO` fora do PDV (lista do dia, inclusive "Todos"), da fila de impressão, do fechamento de caixa e do relatório de cancelados.

Variáveis (só os nomes, vazias, no `.env.example` e no `api/.env.railway`): `PAGAMENTO_ONLINE_ATIVO`, `TOKEN_ENCRYPTION_KEY`. As do Mercado Pago (`MP_*`) entram na etapa 3, quando forem lidas pelo código (o teste do `.env.example` só aceita variável lida).

Testes: cifra (ida e volta, chave errada falha, dado adulterado falha); split em todos os casos (`PLATAFORMA` e `PROPRIO`; sem frete grátis; frete grátis da loja; campanha; os dois juntos; arredondamento 95/5); campanha só consumida na aprovação, não consumida em expirado ou cancelado, uma por telefone; formas por tipo de loja; flag desligada mantém o comportamento atual; `AGUARDANDO_PAGAMENTO` e `EXPIRADO` fora do PDV e do caixa; CHECKs da migration (com o caso de NULL).

Commits previstos:
- `feat(api): status AGUARDANDO_PAGAMENTO e EXPIRADO no pedido`
- `feat(api): modelos do pagamento online (conexão, pagamento, webhook, campanha, livro-razão, fechamento)`
- `feat(shared): cálculo do split e da taxa de entrega por modo de entrega`
- `feat(shared): formas de pagamento por tipo de loja`
- `feat(api): cifra dos tokens da loja (AES-256-GCM) e flag do pagamento online`
- `feat(api): campanha de frete grátis da primeira compra (reserva, uso, liberação)`
- `feat(api): pedidos aguardando pagamento e expirados fora do PDV`
- `docs: etapa 2 do pagamento online`

### Etapa 3 — OAuth da loja, módulo do Mercado Pago e modo de entrega (CONCLUÍDA em 2026-11-25, branch `feat/pagamento-online`)

**Feito** (vale isto e as Decisões da Etapa 3 onde o plano abaixo divergir):
- `api/src/lib/mercadoPago.js` (único ponto de saída; teste garante) e `api/src/lib/estadoOauth.js` (state HMAC com `MP_STATE_SECRET`, 10 min; volta só para `https://taakidelivery.com.br` ou localhost fora de produção; senão `https://taakidelivery.com.br/parceiro`).
- Migration `20261126130000_pagamento_online_conexao`: campanha com `telefoneHash` (HMAC-SHA256 com `CAMPANHA_TELEFONE_SECRET`), índice parcial da conta única (`CONECTADA`/`EXPIRADA`) e `AlertaPlataforma` (tipo `RENOVACAO_MP_FALHOU`).
- Retaguarda: `GET /retaguarda/pagamento-online`, `POST …/conectar { origem }`, `POST …/desconectar { confirmar }` (sem confirmar devolve os pendentes), `PUT …/ativo { ativo }`; retorno público `GET /api/mercadopago/oauth/retorno` (sem a query no log); renovação diária no `server.js`; `/plataforma/alertas` (listar, contagem, resolvido).
- `PATCH /plataforma/lojas/:id` com `modoEntrega` e `freteGratisPiso` (`SUBIR` | `DESLIGAR`; sem escolha = 409 `FRETE_GRATIS_ABAIXO_DO_PISO`).
- Campanha: só sem pedido `FINALIZADO` anterior (telefone ou cliente). PDV: taxa digitada em loja `PLATAFORMA` = 422 `TAXA_MANUAL_PROIBIDA`.
- Telas "Pagamento online" (loja), "Alertas" (plataforma, com contador no menu) e "Entrega" em Lojas, conferidas no Chrome.

**Para as próximas etapas:**
- Etapa 4: ligar `cancelarPendentesDaLoja` (cancelar no Mercado Pago e expirar os pedidos) ao desconectar; exigir `CAMPANHA_TELEFONE_SECRET` para a API subir quando a reserva da campanha for ligada; canal `APP`; política de privacidade com o hash do telefone guardado depois da exclusão da conta e com o Mercado Pago.
- Etapa 5: travar a taxa na tela do PDV em loja `PLATAFORMA` (a API já recusa).
- Melhoria futura: PKCE no OAuth (ligar no aplicativo do Mercado Pago e mandar o `code_verifier`).
- O retorno do OAuth depende de `taakidelivery.com.br` (raiz) apontar para o Railway; quem usa a retaguarda por `api.taakidelivery.com.br/admin` volta para `https://taakidelivery.com.br/parceiro` (lista fechada, Decisão 11).


Objetivo: a loja conecta a própria conta Mercado Pago, o token é renovado sozinho, o ADMIN escolhe o modo de entrega e as pendências pequenas da Etapa 2 são resolvidas. Sem Pix, sem webhook, sem telas do app. Texto revisto em 2026-11-25.

API:
- `api/src/lib/mercadoPago.js`: **único** ponto de saída para a API do Mercado Pago (Decisão da Etapa 3, item 1), com `fetch` injetável e tempo limite, sem logar token nem code. Nesta etapa: `montarUrlAutorizacao`, `trocarCodePorToken`, `renovarToken`. Um teste confere que nenhum outro arquivo de `api/src` fala com `mercadopago.com`.
- State do OAuth: `lojaId`, `usuarioId`, origem da retaguarda e expiração de 10 minutos, assinado por HMAC-SHA256 com um segredo próprio (pergunta 1).
- `GET /retaguarda/pagamento-online` (DONO; ADMIN com `X-Loja`): situação (`NAO_CONECTADA` | `CONECTADA` | `EXPIRADA` | `DESCONECTADA`), id da conta, `conectadaEm`, `expiraEm`, `pagamentoOnlineAtivo`, flag global, pagamentos pendentes.
- `POST /retaguarda/pagamento-online/conectar` → `{ url }` (https://auth.mercadopago.com.br/authorization com `client_id`, `response_type=code`, `platform_id=mp`, `redirect_uri` = `MP_REDIRECT_URI`, `state`).
- `GET /api/mercadopago/oauth/retorno?code&state` (pública): confere o state, troca o code, grava os tokens cifrados, `mpUserId`, `publicKey`, `expiraEm`; mesma conta já conectada a outra loja = recusa; redireciona para `/admin/pagamento-online?mp=conectada|erro&motivo=…` na origem guardada no state.
- `POST /retaguarda/pagamento-online/desconectar` (com `confirmar`; sem ele devolve a contagem dos pendentes para o aviso): apaga os tokens, marca `DESCONECTADA`, desliga `pagamentoOnlineAtivo`; ponto pronto (`cancelarPendentesDaLoja`) para a Etapa 4 cancelar os Pix pendentes e expirar os pedidos.
- `PUT /retaguarda/pagamento-online/ativo { ativo }`: só com a conexão `CONECTADA` e a flag global ligada.
- Rotina diária de renovação (`iniciarRenovacaoDiaria` no `server.js`): vence em menos de 30 dias = renova com `refresh_token` e grava o refresh NOVO; falha = `EXPIRADA`, desliga `pagamentoOnlineAtivo` e grava um alerta para o ADMIN (pergunta 3).
- `PATCH /plataforma/lojas/:id` aceita `modoEntrega` (só ADMIN). Mudar para `PLATAFORMA` com frete grátis ligado abaixo do piso = 409 `FRETE_GRATIS_ABAIXO_DO_PISO` (com o mínimo e o piso), a menos que venha `freteGratisPiso: 'SUBIR' | 'DESLIGAR'`; a loja nunca fica gravada violando o piso.
- Pendências da Etapa 2 resolvidas agora: "primeira compra" olha também os pedidos FINALIZADOS do telefone; o telefone da campanha vira hash (HMAC-SHA256); taxa digitada no PDV recusada em loja `PLATAFORMA`.

Retaguarda:
- Tela nova "Pagamento online" (menu da loja): situação, "Conectar", "Desconectar" (com o aviso dos pendentes) e o interruptor do pagamento online (só habilitado com a conexão ativa e a flag ligada); mensagem de volta do Mercado Pago.
- Lojas (ADMIN): campo "Entrega" (motoboy próprio / entregadores do Taaki) e, ao cair no piso, o diálogo "subir o mínimo para R$ X" ou "desligar o frete grátis"; situação da conexão na lista.

Variáveis (vazias no `.env.example` e no `api/.env.railway`): `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI` e os segredos da pergunta 1.

Testes: módulo único (nenhum outro arquivo chama o Mercado Pago); `modoEntrega` só pelo ADMIN e o piso; state válido, adulterado, expirado e de outra loja; DONO de outra loja barrado; callback com troca mockada; tokens gravados cifrados; mesma conta em duas lojas; desconectar; renovação com sucesso e com falha; primeira compra com pedido anterior; hash do telefone; taxa manual recusada em `PLATAFORMA`.

Commits previstos:
- `feat(api): módulo único do Mercado Pago (OAuth)`
- `feat(api): conectar, desconectar e renovar a conta Mercado Pago da loja`
- `feat(api): modo de entrega da loja pelo ADMIN com o piso do frete grátis`
- `feat(api): campanha só para quem nunca teve pedido finalizado e telefone em hash`
- `feat(api): taxa digitada no PDV recusada em loja com entregador da plataforma`
- `feat(retaguarda): tela "Pagamento online"`
- `feat(retaguarda): modo de entrega na tela Lojas`
- `docs: etapa 3 do pagamento online`

### Etapa 4 — Canal APP, Pix no app, webhook, conciliação e expiração (CONCLUÍDA em 2026-11-25, branch `feat/pagamento-online`, sem commit)

**Feito** (vale isto e as Decisões da Etapa 4 onde o plano abaixo divergir):
- Migrations `20261127120000_pagamento_online_pix_enums` (`CanalPedido.APP`, `StatusPagamento.A_ESTORNAR`, alertas `PAGAMENTO_DIVERGENTE`, `PAGO_APOS_EXPIRAR`, `MP_DESVINCULADA`, `TAXA_ENTREGA_COMPLEMENTO`, `PIX_FALHANDO`, `LOJA_SEM_LOCALIZACAO`) e `20261127120100_pagamento_online_pix` (`Pagamento.consultadoEm`), aplicadas no banco de dev (`migrate diff` sem diferença).
- Corpo do pedido: `origem: 'APP'` (o app manda sempre) e `pagamentoOnline: 'PIX'` (sem `formaPagamento` nem troco). Prévia `POST /cliente/pedidos/previa`.
- `criarPedido` com `calcularSplit` para todos os canais (`calcularCobranca`, também usada pela prévia; `resolverTaxa`: KM só no APP em loja PLATAFORMA com distância). Trava de 50% gera alerta só no pagamento online.
- `api/src/services/pagamento.service.js` (`gerarPix`, `aprovar`, `conciliar`, `expirarPedido`, `situacaoParaCliente`, `rodarRotina`, `cancelarPendentesDaLoja`, `desvincularConta`, `receberWebhook`, `iniciarRotina`); `mercadoPago.js` ganhou `criarPix`, `consultarPagamento`, `cancelarPagamento`, `validarAssinaturaWebhook`, `urlDeNotificacao`.
- PDV 0.3.2: painel com todos os canais menos o salão e os status ocultos; selo "App"/"Site"; alerta sonoro no APP; "Registrado pelo app".
- App (versionCode 5 continua: ainda não foi enviado ao Play): prévia no pagamento, "Pix pelo app (pagar agora)", e-mail pedido uma vez, faixa da campanha com a verificação do telefone, tela `sacola/pix`, `RetomarPix`, `logica/pagamento.js`, `expo-clipboard` ~58.0.4.
- Retaguarda › Lojas: o campo "Entrega" mostra o aviso/erro do pino da loja.
- Rascunho da política e dos termos: `docs/rascunho-privacidade-pagamento.md` (não publicado).

**Ordem do lançamento (Decisão 1 da Etapa 4)**: 1) instalar o **PDV 0.3.2 em todas as lojas**; 2) só depois, o build do app que manda `origem: 'APP'` (o PDV 0.3.1 esconde esses pedidos).

**Pendências**:
- **Bloqueante da campanha**: `PHONE_VERIFIER` vazio em produção (sem SMS real ninguém verifica o telefone; nada de modo teste em produção). Provedor de SMS a escolher (Firebase Phone Auth previsto como outra implementação de `verificadorTelefone`).
- Conferir no teste real com as contas de teste do Mercado Pago: o template do HMAC (`id:…;request-id:…;ts:…;`, `data.id` em minúsculas), como a comissão aparece no `GET /v1/payments/:id` (`fee_details` tipo `application_fee` ou `application_fee`; sem ela a comissão não é conferida), se as notificações `mp-connect` chegam assinadas e o `action` delas (tratamos `…deauthorized…`).
- Etapa 5: estorno do `A_ESTORNAR` (ponto `estornarPagamentoAtrasado` em `criarServicoPagamentos`), selo "Pago online" no PDV, finalizar sem caixa.
- Etapa 6: lançamento `TAXA_ENTREGA_COMPLEMENTO` no livro-razão (hoje só o alerta).
- Revisão jurídica do rascunho e nova `DOCUMENTOS_APP.versao` antes de ligar `PAGAMENTO_ONLINE_ATIVO=sim` em produção.
- Não testado em aparelho (QR, copiar, retomar a tela ao reabrir o app).

Texto revisto em 2026-11-25 ao começar a etapa (vale sobre o rascunho antigo; as Decisões continuam valendo). Objetivo: o app passa a ser um canal próprio, o cliente paga por Pix dentro do app e o pedido só chega ao PDV aprovado. Com `PAGAMENTO_ONLINE_ATIVO` desligado ou a loja sem pagamento online, o pagamento fica como hoje (só o canal `APP` e o split entram para todos).

Banco (migrations só aditivas):
- `CanalPedido` ganha `APP` (migration só do enum). `TipoAlerta` ganha `PAGAMENTO_DIVERGENTE`, `PAGO_APOS_EXPIRAR`, `MP_DESVINCULADA`, `TAXA_ENTREGA_COMPLEMENTO`; `StatusPagamento` ganha o estado "aprovado depois de expirar, a estornar" (pergunta 6 abaixo).

API:
- **Canal APP**: o app manda `origem: 'APP'` no `POST /cliente/pedidos` (sem o campo = `SITE`, como o site e os builds antigos). `APP` segue as regras do `SITE` (loja aberta, `disponivelHoje`, turno, `vendidoNoSite`, `totalEsperadoCentavos`, `CONFIRMADO`, frete grátis da loja) e só ele tem pino obrigatório em loja `PLATAFORMA`, campanha e pagamento online. Site em loja `PLATAFORMA`: entrega com a taxa da área (origem `AREA`), só dinheiro na entrega. Relatório e cupom ganham o canal "App".
- **Split na criação** (todos os canais com entrega): `calcularSplit` decide taxa cobrada, origem do frete grátis, `origemTaxaEntrega`, `valorEntregadorCentavos`/`valorPlataformaEntregaCentavos` e o valor do split, sempre no servidor. `APP` em loja `PLATAFORMA` = `taxaPorKm(distância)` (origem `KM`); site e PDV em `PLATAFORMA` = área (`AREA`). Trava de 50% estourada = alerta `TAXA_ENTREGA_COMPLEMENTO` (o lançamento no livro-razão é da Etapa 6).
- **Prévia** `POST /cliente/pedidos/previa { lojaSlug, enderecoId, itens }` → subtotal, taxa (km ou área), frete grátis (`LOJA`/`CAMPANHA`), total e formas; o app mostra a taxa por km e a campanha antes de enviar (o `totalEsperadoCentavos` vem dali).
- **Campanha**: reservada na criação (só `APP`, telefone verificado, `calcularSplit` com `consumirCampanha`), usada na aprovação do online ou na finalização, liberada na expiração e no cancelamento.
- **Verificar o telefone da conta logada** (para a campanha): `POST /cliente/telefone/enviar` e `/cliente/telefone/verificar` (mesmo verificador e limites do login por celular; telefone verificado em outra conta = 409).
- **Pix**: `pagamentoOnline: 'PIX'` no corpo, só `APP` e loja apta (senão 409 `PAGAMENTO_ONLINE_INDISPONIVEL`); e-mail obrigatório no cadastro (422 `EMAIL_OBRIGATORIO`; Decisão 13). Pedido `AGUARDANDO_PAGAMENTO`, sem número, sem cupom e sem eventos; estoque baixado (reserva). Depois do commit, `mercadoPago.criarPix` (token da loja, `X-Idempotency-Key` do `Pagamento`, `application_fee` só > 0, `external_reference` = id do pedido, `notification_url`, `date_of_expiration` +30 min, `description` com a loja, `payer.email`); devolve `qrCode`, `qrCodeBase64` e `expiraEm` (+15 min). Falha ao criar = pedido `EXPIRADO` com estoque e campanha devolvidos e 502 `PAGAMENTO_FALHOU`. Reenvio com a mesma chave devolve o mesmo Pix.
- `GET /cliente/pedidos/:id/pagamento` (só o dono do pedido): estado do banco; pendente há mais de 30 s sem consulta = consulta o Mercado Pago (a rotina e o webhook são o caminho principal).
- `POST /mercadopago/webhook` (pública): `x-signature` com `MP_WEBHOOK_SECRET` (manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), inválida = 401; dedupe em `EventoWebhook`; 200 na hora e processa depois. `payment`: loja pelo `user_id` (conexão), `consultarPagamento` com o token dela, confere `external_reference`, valor e `application_fee` (divergência = alerta, não aprova). `mp-connect` desvinculado = conexão `DESCONECTADA`, loja desligada, alerta `MP_DESVINCULADA`.
- **Aprovação** (`aprovarPagamento`, uma só para webhook, consulta e rotina): transição condicionada `AGUARDANDO_PAGAMENTO → CONFIRMADO`, número e dia operacional da aprovação, `formaPagamento = PIX`, campanha usada, cupom PEDIDO; depois do commit `pedido:novo` + `impressao:nova`. Pedido já `EXPIRADO`: não revive, pagamento marcado para estorno, alerta `PAGO_APOS_EXPIRAR` e ponto `estornarPagamentoAtrasado` (vazio até a Etapa 5).
- **Rotina de 1 minuto** (`iniciarRotinaPagamentos` no `server.js`): pendente com mais de 15 min = consulta uma última vez, `cancelarPagamento` no Mercado Pago e pedido `EXPIRADO` (estoque e campanha devolvidos); os outros pendentes são consultados (webhook perdido).
- **Desconectar**: `cancelarPendentesDaLoja` cancela no Mercado Pago (antes de apagar os tokens) e expira os pedidos.
- `mercadoPago.js` ganha `criarPix`, `consultarPagamento`, `cancelarPagamento` e `validarAssinaturaWebhook`.
- Variável nova: `MP_WEBHOOK_SECRET`. `notification_url` = origem do `MP_REDIRECT_URI` + `/api/mercadopago/webhook`. `CAMPANHA_TELEFONE_SECRET` obrigatório para subir com a flag ligada; sem ele, a campanha fica desligada (aviso no log).
- Política: rascunho em `docs/` (Mercado Pago, e-mail do pagador, hash do telefone depois da exclusão), sem publicar nem trocar `DOCUMENTOS_APP.versao`.

PDV (versão nova, obrigatória: o 0.3.1 esconde pedido `APP`): selo "App" ou "Site", alerta sonoro também no `APP`, filtro com `APP`.

App (versionCode 5, que ainda não foi enviado ao Play): `expo-clipboard`; corpo com `origem: 'APP'`; pagamento pela prévia ("Pagar agora com Pix" separado de "Pagar na entrega", formas da loja); faixa "Verifique seu telefone para ganhar frete grátis na primeira compra"; e-mail pedido uma vez antes do Pix; tela `sacola/pix` (QR, copiar, contagem de 15 min, consulta a cada 5 s, aprovado → `enviado`, expirado → aviso e volta à sacola guardada); Pix pendente salvo no aparelho e retomado ao abrir; `logica/pagamento.js` testada.

Testes (Mercado Pago sempre falso): os listados no pedido da etapa (origem APP/SITE, split, taxa por km, campanha, aguardando fora do PDV, idempotência, assinatura, duplicado, divergência, aprovação, expiração, aprovação atrasada, desconectar, mp-connect, módulo único).

Fora: estorno, cartão, livro-razão e fechamento, trava da taxa na tela do PDV (Etapa 5), limpeza do domínio antigo.


### Etapa 5 — Cancelamento, estorno, PDV e relatórios (CONCLUÍDA em 2026-11-26, branch `feat/pagamento-online`, sem merge)

**Feito** (vale isto e as Decisões da Etapa 5 onde o plano abaixo divergir):
- Migrations `20261128120000_pagamento_online_estorno_enums` (`StatusPagamento.CONTESTADO`; alertas `REEMBOLSO_FALHOU`, `CHARGEBACK`, `ESTORNO_EXTERNO`, `PEDIDO_SEM_ACEITE`) e `20261128120100_pagamento_online_estorno` (`Pedido.meioOnline` preenchido nos pedidos já criados, `Pedido.aceitoEm` com CHECK só online, tabela `Estorno`), aplicadas no banco de dev (`migrate diff` sem diferença).
- `mercadoPago.estornar` (total sem `amount`, parcial com `amount`), `valorReembolsadoCentavos` na consulta e `erroNoEmailDoPagador`.
- `pagamento.service`: `cancelarPelaLoja` (recusa antes do aceite; depois = 409 `CANCELAR_COM_TAAKI`), `cancelarPeloCliente` (`POST /cliente/pedidos/:id/cancelar`; depois do aceite = 409 `PEDIDO_JA_ACEITO`), `estornarPeloAdmin` (`POST /plataforma/pedidos/:id/estornar { valorCentavos?, motivo }`: aberto = cancela e estorna; encerrado = só estorna), `estornarPagamentoAtrasado` (A_ESTORNAR, também na rotina), `tentarEstornoDeNovo` (consulta o Mercado Pago antes; chave nova), `resolverEstornoPorFora`, `listarParaAdmin` (`GET /plataforma/pagamentos?acao=sim|nao&pedidoId`), `alertarSemAceite` (rotina, 10 min). O pedido é cancelado e o pagamento vai a `REEMBOLSO_PENDENTE` numa transação; o Mercado Pago é chamado depois do commit.
- Webhook: `refunded`/valor reembolsado conclui o nosso estorno em aberto ou registra o externo (alerta `ESTORNO_EXTERNO` com o pedido aberto); `charged_back`/`in_mediation` = `CONTESTADO` + `CHARGEBACK`. Valor e comissão só são conferidos na aprovação (um estorno parcial pode mudar a comissão).
- Aceite: `PATCH /equipe/pedidos/:id/aceitar` e Em preparo/Saiu para entrega também aceitam. Finalizar pago online sem caixa e sem forma (estornado ou contestado = 409 `PAGAMENTO_ESTORNADO`). Cancelamento comum de pedido pago online = 409 `CANCELAR_COM_ESTORNO` (só pelo serviço de pagamentos).
- `pedidoPublico` ganhou `pagamentoOnline` (`{ meio, situacao, aprovadoEm, valorEstornadoCentavos }`), `aceitoEm`, `podeCancelar`; `pedidoDaEquipe` ganhou `entregaPlataforma`; `/equipe/cardapio` ganhou `modoEntrega`.
- Relatório: `porFormaPagamento` só as pagas na entrega, `pagoOnline` (PIX, CARTAO_ONLINE) e `estornosDeFinalizados` à parte. Cupom: "Pix - PAGO ONLINE" + "NÃO COBRAR NA ENTREGA"; resumo do dia com "Pago na entrega"/"Pago online (fora do caixa)".
- PDV 0.3.3: faixa "PAGO ONLINE (Pix) — não cobrar na entrega", Aceitar / Recusar, "Para cancelar, fale com o Taaki", destaque e toque extra aos 5 min sem aceite, "Recebi o dinheiro", taxa travada em loja `PLATAFORMA`, selos ESTORNADO / ESTORNO PENDENTE / CONTESTADO.
- Retaguarda: tela da plataforma "Pagamentos online" (`TelaPagamentosAdmin.jsx`), alertas de pagamento com o botão para ela, relatório com "Pago online".
- App: e-mail recusado (`EMAIL_RECUSADO_PAGAMENTO`) volta ao campo do e-mail preenchido, com chave nova; aba Pedidos com "Pago. Aguardando a loja aceitar.", "Cancelar pedido" e o aviso do estorno (Pix na conta, cartão na fatura).

**Pendências**:
- Recusa automática do pedido sem aceite (Decisão 7): só o alerta por enquanto.
- Conferir no teste real: resposta do `POST /refunds` (status `approved` direto ou `in_process` no Pix), `transaction_amount_refunded` na consulta e as notificações de estorno e de chargeback (tópico `payment` com `status`; o tópico próprio `chargebacks` não é tratado).
- O alerta `REEMBOLSO_FALHOU` só é marcado como resolvido quando o ADMIN age (tentar de novo/resolvido por fora); concluído pelo webhook, o ADMIN marca à mão.
- Etapa 6: lançamentos no livro-razão do estorno e do "Recebi o dinheiro".
- PDV 0.3.3 precisa ser reinstalado nas lojas (não testado no Electron real nesta etapa); app não testado em aparelho.

Texto do plano (escrito ao começar a etapa):

Texto revisto em 2026-11-26 ao começar a etapa (vale sobre o rascunho antigo; valem as Decisões, em especial a 10: estorno recusado = pedido `CANCELADO` + pagamento `REEMBOLSO_PENDENTE`, sem retentativa; o rascunho antigo dizia 502 com o pedido aberto). Respostas às perguntas desta etapa vão em "Decisões da Etapa 5".

Hoje (gap): o PDV cancela um pedido pago por Pix como se fosse na entrega (estoque e campanha voltam, o dinheiro fica com a loja); o pago online finaliza pedindo caixa e forma e entra no caixa como "Pix"; o relatório não separa online; o `A_ESTORNAR` só gera alerta.

Banco (migrations só aditivas; enum em migration própria):
- `StatusPagamento` + `CONTESTADO` (chargeback/mediação); `TipoAlerta` + `REEMBOLSO_FALHOU`, `CHARGEBACK`, `ESTORNO_EXTERNO`.
- `Pedido.meioOnline` (`PIX` | `CARTAO_ONLINE`, nulo = na entrega), gravado na criação e preenchido nos pedidos já criados a partir do `Pagamento`; `Pedido.aceitoEm` (aceite da loja; pergunta 1).
- `Estorno` (um por tentativa): `pagamentoId`, `valorCentavos`, `motivo`, `origem` (`AUTOMATICO` | `ADMIN` | `MERCADO_PAGO`), `status` (`PROCESSANDO` | `CONCLUIDO` | `FALHOU` | `RESOLVIDO_POR_FORA`), `idempotencyKey` única, `mpRefundId`, `erro` (código + detalhe limpo), `usuarioId`, `observacao`, datas. Guarda o motivo do ADMIN e o histórico das tentativas manuais.

API:
- `mercadoPago.estornar(token, paymentId, { valorCentavos?, idempotencyKey })` → `POST /v1/payments/{id}/refunds` (sem valor = total). `pagamentoNormalizado` ganha `valorReembolsadoCentavos` (`transaction_amount_refunded`).
- `services/estorno.service.js`: numa transação, pedido `CANCELADO` (condicionado), estoque e campanha de volta, cupom de CANCELAMENTO, pagamento `REEMBOLSO_PENDENTE` e `Estorno PROCESSANDO`; depois do commit, `estornar`: deu certo = `REEMBOLSADO` (ou `REEMBOLSO_PARCIAL`) e `Estorno CONCLUIDO`; falhou = continua `REEMBOLSO_PENDENTE`, `Estorno FALHOU` e alerta `REEMBOLSO_FALHOU`. Nenhuma retentativa automática. Se o processo cair no meio, fica `REEMBOLSO_PENDENTE` (visível para o ADMIN).
- **Recusa da loja** = cancelar no PDV um pedido pago online ainda não aceito → estorno total automático.
- **Cancelamento pelo cliente** antes do aceite: `POST /cliente/pedidos/:id/cancelar` (só o dono, só pago online, só sem aceite; depois do aceite = 409 `PEDIDO_JA_ACEITO`) → estorno total automático.
- **Depois do aceite**: o PDV não cancela pedido pago online (409 `CANCELAR_COM_TAAKI`); só o ADMIN: `POST /plataforma/pedidos/:id/cancelar { valorCentavos?, motivo }` (motivo obrigatório; sem valor = total; parcial = `REEMBOLSO_PARCIAL`).
- **`A_ESTORNAR`**: `estornarPagamentoAtrasado` chama o mesmo estorno total (pedido continua `EXPIRADO`).
- **Reembolsos pendentes (ADMIN)**: `GET /plataforma/reembolsos` (pendentes e últimos resolvidos), `POST /plataforma/reembolsos/:pagamentoId/tentar` (consulta o Mercado Pago antes: já reembolsado lá = só marca; senão nova tentativa com chave nova), `POST /plataforma/reembolsos/:pagamentoId/resolvido { observacao }` (resolvido por fora).
- **Webhook**: `refunded` = `REEMBOLSADO`; `approved` com parte reembolsada = `REEMBOLSO_PARCIAL`; `charged_back`/`in_mediation` = `CONTESTADO` + alerta `CHARGEBACK`. Estorno que chega pelo Mercado Pago num pedido ainda aberto (a loja estornou direto lá) = alerta `ESTORNO_EXTERNO` (pergunta 5). Transições só para frente.
- **Finalizar pago online**: sem caixa e sem forma (`caixaId` nulo, forma continua a da compra).
- `pedidoDaEquipe` e a fila de impressão ganham `meioOnline`, `aceitoEm`, `situacaoPagamento` (`ESTORNADO` | `ESTORNO_PENDENTE` | …) e `modoEntrega`; `GET /equipe/loja` ganha `modoEntrega`. `pedidoPublico` ganha `meioOnline`, `situacaoPagamento` e `podeCancelar` (app).
- **Pix recusado pelo e-mail do pagador**: quando o `message`/`cause` da criação aponta o e-mail, 422 `EMAIL_RECUSADO_PAGAMENTO` (pedido `EXPIRADO` como hoje); os outros erros continuam 502 `PAGAMENTO_FALHOU`.
- **Relatório do dia**: "Pago online" (Pix online, Cartão online) separado das formas pagas na entrega; `EXPIRADO` fora dos cancelados. Caixa: pago online nunca entra (sem `caixaId`). Cupom do relatório idem; cupom do pedido "Pix - PAGO ONLINE" sem troco.

PDV (0.3.3, precisa reinstalar):
- Faixa "PAGO ONLINE (Pix) — não cobrar na entrega" na linha e no detalhe; finalizar sem escolher forma e sem caixa.
- Pago online sem aceite: "Aceitar" e "Recusar (estorna o cliente)"; aceito: sem cancelar ("Para cancelar, fale com o Taaki").
- Dinheiro em loja `PLATAFORMA`: o botão "Finalizar" vira "Recebi o dinheiro" (mesma lógica).
- Loja `PLATAFORMA`: taxa de entrega travada no novo pedido.
- Cancelado com estorno: "ESTORNADO" (ou "ESTORNO PENDENTE").

Retaguarda: tela da plataforma "Pagamentos online" (ADMIN): busca do pedido (loja + nº do dia ou id), cancelar com estorno total/parcial e motivo, e a seção "Reembolsos pendentes" com "Tentar de novo" e "Resolvido por fora" (observação). Relatório do dia com o bloco "Pago online".

App: mensagens do pedido recusado/cancelado com estorno ("O valor do Pix volta para a sua conta"; cartão: "volta na fatura do cartão"), botão "Cancelar pedido" enquanto a loja não aceitou (pergunta 6) e o e-mail recusado ("O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo." levando ao campo do e-mail).

Testes (Mercado Pago sempre falso): e-mail recusado × erro genérico; recusa com estorno; cancelamento pelo cliente antes do aceite; bloqueio depois do aceite (cliente e PDV); estorno parcial pelo ADMIN; `A_ESTORNAR` processado; estorno recusado = `REEMBOLSO_PENDENTE` sem retentativa; tentar de novo e resolvido por fora; idempotência (chave por tentativa, cancelar duas vezes); estoque e campanha devolvidos; chargeback com alerta; finalizar pago online sem caixa; "Recebi o dinheiro" só em dinheiro de loja `PLATAFORMA`; taxa travada em `PLATAFORMA`; relatório com online separado e expirado fora dos cancelados; módulo único.

Fora: livro-razão e fechamento (Etapa 6), cartão (Etapa 7), SMS, mapas.

Commits previstos:
- `feat(api): migrations da etapa 5 (estorno, aceite, meio online, contestação)`
- `feat(api): estorno no módulo do Mercado Pago`
- `feat(api): recusa, cancelamento pelo cliente e pelo ADMIN com estorno`
- `feat(api): reembolsos pendentes, A_ESTORNAR e estornos/contestações do webhook`
- `feat(api): finalizar pago online sem caixa e relatório com pago online separado`
- `feat(api): e-mail recusado pelo Mercado Pago com mensagem própria`
- `feat(shared): cupom com pagamento online`
- `feat(pdv): pago online, aceite, recusa, "Recebi o dinheiro" e taxa travada (0.3.3)`
- `feat(retaguarda): pagamentos online e reembolsos pendentes do ADMIN; relatório`
- `feat(app): cancelar antes do aceite, estorno e e-mail recusado`
- `docs: etapa 5 do pagamento online`

### Etapa 6 — Livro-razão da loja e fechamento semanal (CONCLUÍDA em 2026-11-26, branch `feat/pagamento-online`, sem merge)

**Feito** (vale isto e as Decisões da Etapa 6 onde o plano abaixo divergir):
- Migrations `20261129120000_livro_razao_enums` e `20261129120100_livro_razao`, aplicadas no banco de dev (`migrate diff` sem diferença). O CHECK novo exige pedido nos lançamentos automáticos e observação no ajuste manual (o teste da Etapa 2 foi ajustado).
- `api/src/services/livroRazao.service.js` (regras puras, lançamentos, leitura, quitar, ajuste, campanha, rotina de hora em hora com alerta de atraso); ganchos em `equipe.finalizarPedido`, `pagamento.aprovar` e `cancelarNaTransacao`. `controllers/financeiro.controller.js` com as rotas `/retaguarda/fechamento*` e `/plataforma/financeiro*`.
- Retaguarda: "Fechamento" (toda loja) e "Financeiro" (plataforma); lembrete e atalho do ajuste manual em "Pagamentos online"; alertas `FECHAMENTO_ATRASADO`/`TAXA_ENTREGA_COMPLEMENTO` com botão para o Financeiro; tabelas empilhadas no celular. Conferido no Chrome headless (1280 e 390 px) num cenário montado no banco de teste: sem rolagem lateral e sem erro no console.

**Pendências**:
- O atalho "Criar ajuste manual" depois do estorno de pedido finalizado não foi clicado no navegador (o estorno precisa do Mercado Pago; só o lembrete no diálogo foi conferido).
- ~~A semana atual mostrava todo lançamento sem fechamento~~ **Resolvido (2026-11-26)**: a semana atual mostra só os lançamentos cuja data cai nela (dia operacional da loja); os da semana anterior ainda sem fechamento (entre a virada de segunda e a rotina) aparecem à parte como "Semana anterior (fechando)". Se a semana anterior já foi fechada, um atrasado dela fica na atual (é o fechamento desta que vai levá-lo).
- Uma instância só da API (como as outras rotinas); com várias, o índice único do fechamento evita duplicar, mas a rotina roda em todas.

Texto do plano (escrito ao começar a etapa):

Texto revisto em 2026-11-26 ao começar a etapa (vale sobre o rascunho antigo; valem as Decisões 4, 14, 15 e 16 e as das Etapas 2 a 5). Os modelos `LancamentoLoja` e `FechamentoSemanal` já existem desde a Etapa 2 (trigger: lançamento só se insere e só ganha o fechamento). Respostas às perguntas desta etapa vão em "Decisões da Etapa 6".

Hoje (gap): nada grava lançamento (a trava de 50% só gera alerta); o pedido não guarda a taxa cheia quando a loja `PROPRIO` dá frete grátis (o crédito da campanha não tem de onde sair); não há fechamento, tela nem rotina.

Banco (migration só aditiva, enum em migration própria):
- `TipoAlerta` + `FECHAMENTO_ATRASADO`.
- `Pedido.taxaEntregaCheiaCentavos` (Int?, só com entrega): a taxa antes do frete grátis, gravada na criação (preenchida nos pedidos antigos quando dá para saber).
- `LancamentoLoja.estornaId` (lançamento desfeito, único) e índice único parcial `(pedidoId, tipo)` para os tipos automáticos (nunca duplica). Trigger atualizado com o campo novo.
- `AlertaPlataforma.fechamentoId` (um alerta de atraso por fechamento).
- Trigger no `FechamentoSemanal`: depois de fechado, loja, semana e saldo não mudam; status só `AGUARDANDO_PAGAMENTO → QUITADO`.

Lançamentos automáticos (`services/livroRazao.service.js`, dentro da transação de quem chama; o modo da loja é o do pedido na criação: `origemTaxaEntrega` preenchida = entregador da plataforma):
- `TAXA_ENTREGA_DINHEIRO` (+, loja deve): na finalização do pedido pago na entrega de loja `PLATAFORMA` com entrega ("Recebi o dinheiro"; PDV e site inclusive). Valor = taxa cheia; frete grátis da loja = taxa cheia (Decisão 16); campanha = nada.
- `TAXA_ENTREGA_COMPLEMENTO` (+): na aprovação do pagamento online, a parte do devido que não coube no split (trava de 50%).
- `CREDITO_CAMPANHA` (−, Taaki deve): na finalização do pedido de loja `PROPRIO` com frete grátis da campanha, qualquer forma. Valor = `taxaEntregaCheiaCentavos`.
- `ESTORNO`: cancelamento (PDV, cliente, ADMIN, com ou sem estorno do Pix) desfaz cada lançamento automático do pedido, na semana atual.
- Online de loja `PLATAFORMA` (fora o complemento) e loja `PROPRIO` sem campanha: nada.

Fechamento (Decisão 15): semana de segunda a domingo pelo dia operacional da loja (America/Sao_Paulo, `horaViradaDia`); o lançamento é da semana do dia operacional em que foi criado. Rotina de hora em hora (`iniciarFechamentoSemanal` no `server.js`): para cada loja, cada semana já terminada (com 10 min de folga) que tem lançamento sem fechamento vira um `FechamentoSemanal` `AGUARDANDO_PAGAMENTO` com o saldo (positivo = a loja deve; negativo = o Taaki deve) e os lançamentos ligados a ele. Idempotente (único `[lojaId, inicio]`); semana sem lançamento não gera nada. A semana atual é calculada na hora (parcial), nunca gravada.

API:
- Loja (DONO; ADMIN com `X-Loja`): `GET /retaguarda/fechamento` (semana atual parcial + fechamentos) e `GET /retaguarda/fechamento/:id` (lançamentos com o pedido).
- ADMIN: `GET /plataforma/financeiro` (fechamentos por loja/status + semana atual de cada loja), `GET /plataforma/financeiro/fechamentos/:id`, `POST /plataforma/financeiro/fechamentos/:id/quitar { quitadoEm (data), observacao? }`, `POST /plataforma/financeiro/ajustes { lojaId, valorCentavos (com sinal), observacao (obrigatória) }` (`AJUSTE_MANUAL` na semana atual), `GET /plataforma/financeiro/campanha` (usos e custo).
- Alerta `FECHAMENTO_ATRASADO`: fechamento aguardando há mais de `FECHAMENTO_ATRASO_DIAS` (padrão 7) dias; um por fechamento; quitar resolve. Nada é bloqueado.

Retaguarda: "Financeiro" na plataforma (ADMIN: fechamentos, detalhe, quitar, ajuste, resumo da campanha) e "Fechamento" no menu da loja (semana atual e anteriores, "Você deve ao Taaki R$ X" / "O Taaki deve a você R$ X").

Testes: cada tipo (PDV, site, frete grátis da loja, complemento, campanha nos dois modos), online `PLATAFORMA` sem lançamento, sem duplicidade, cancelamento gera inverso, semana pelo dia operacional e fuso (domingo perto da meia-noite e da virada), semana fechada imutável, semana vazia, quitar, ajuste, campanha, atraso.

Fora: mensalidade, saldo diário dos entregadores, cobrança automática/Pix de cobrança, bloqueio automático, cartão.

Commits previstos:
- `feat(api): migrations da etapa 6 (taxa cheia, estorno do lançamento, atraso do fechamento)`
- `feat(api): lançamentos automáticos do livro-razão`
- `feat(api): fechamento semanal, quitação, ajuste e resumo da campanha`
- `feat(retaguarda): Financeiro (ADMIN) e Fechamento (loja)`
- `docs: etapa 6 do pagamento online`

### Etapa 7 — Cartão pelo Checkout Pro (CONCLUÍDA em 2026-11-27, branch `feat/pagamento-online`, sem merge)

**Feito** (vale isto e as Decisões da Etapa 7 onde o rascunho divergir):
- Migration `20261130120000_cartao_online` (só aditiva, aplicada no banco de dev): enum `TipoPagamentoOnline` (`CREDITO`, `DEBITO`, `PRE_PAGO`, `SALDO_MERCADO_PAGO`, `OUTRO`), `Pedido.tipoPagamentoOnline` (CHECK: só no `CARTAO_ONLINE`) e `Pagamento.checkoutUrl` (o `init_point`). `Pagamento.mpPreferenceId` e `CARTAO_ONLINE` já existiam.
- Corpo do pedido `pagamentoOnline: 'CARTAO'` (só `APP`, loja apta, e-mail obrigatório): o mesmo `criarPedido`, `AGUARDANDO_PAGAMENTO`, `Pagamento` de 15 min; forma provisória `CREDITO`. `formasPagamento.online` passou a levar `CARTAO_ONLINE` (prévia e config).
- `mercadoPago.js`: `criarPreferencia` (token DA LOJA, `X-Idempotency-Key`; um item "Pedido na <loja>" com o total; `marketplace_fee` só > 0; `external_reference` = id do pedido; `binary_mode`; `expires` + `expiration_date_to` = +15 min; `installments`/`default_installments` 1; `excluded_payment_types` boleto (`ticket`), lotérica (`atm`) e Pix/transferência (`bank_transfer`); `back_urls` + `auto_return: 'approved'` para `/api/mercadopago/cartao/retorno`; `notification_url`; `payer.email`), `buscarPagamentosDoPedido` (`/v1/payments/search` por `external_reference`) e `expirarPreferencia` (PUT com `expiration_date_to` = agora). O pagamento normalizado ganhou `tipo` (`payment_type_id`) e `metodo`.
- `pagamento.service`: `gerarCartao` (falha = `EXPIRADO` + 502 `PAGAMENTO_FALHOU` / 422 `EMAIL_RECUSADO_PAGAMENTO`, como o Pix) e `gerarPagamento` (Pix ou cartão, chamado pelo controller). Sem id do pagamento (o cliente ainda não pagou), consulta do app, rotina, expiração e desistência acham o pagamento pela busca (`situacaoNoMp`: o aprovado, senão a tentativa mais nova). Consulta do app do cartão no máximo a cada 10 s (Pix: 30 s). `conciliar`: tentativa recusada do cartão com o pedido aguardando só grava `dadosMp.recusada` + `statusDetail` (o pedido NÃO expira); recusada depois da aprovação ou de outra tentativa = `TENTATIVA_ANTIGA` (sem alerta); `collector_id` diferente da conta conectada = divergência. `aprovar` grava a forma e o tipo reais (`lib/cartaoOnline.js`, `tipoDoPagamento`: crédito → `CREDITO`; débito → `DEBITO`; pré-pago → `PRE_PAGO` com forma `DEBITO`; saldo → `SALDO_MERCADO_PAGO` com forma `CREDITO`; outro → `OUTRO`). Desconectar encerra as preferências pendentes.
- `GET /cliente/pedidos/:id/pagamento` devolve também `checkoutUrl` e `recusa: { mensagem }` (o `status_detail` em português, `mensagemDaRecusa`). Nova `POST /cliente/pedidos/:id/desistir-pagamento` (só o dono; aguardando: consulta uma última vez, aprovado vence; senão encerra a preferência e o pedido vira `EXPIRADO`, pagamento `CANCELADO`, estoque e campanha de volta).
- Página `GET /api/mercadopago/cartao/retorno` (sem script, CSP fechada, query fora do log): "Pronto, pode voltar ao app" + `deliveryabatia://cartao-retorno` (meta refresh e link). **Não aprova nada.**
- `pagamentoOnline` do pedido (equipe e cliente) ganhou `tipo`. Shared: `nomeDoPagamentoOnline` e `linhasPorTipo` (`formasPagamento.js`). Cupom "Cartão de débito - PAGO ONLINE" (sem tipo: "Cartão"); resumo do dia com o cartão por tipo quando há mais de um ou não é crédito. Relatório: `pagoOnline[CARTAO_ONLINE].porTipo`; tela da retaguarda com a linha embaixo da barra. PDV 0.3.4: faixa e selo com o tipo ("PAGO ONLINE (Cartão de débito)").
- App: `expo-web-browser` ~58.1.0 (sem plugin: o dele só liga uma opção experimental). Opção "Cartão pelo app (pagar agora)"; botão "Pagar com cartão"; tela `sacola/cartao` (abre o `init_point` com `openAuthSessionAsync`, só link https do Mercado Pago (`checkoutSeguro`); consulta a nossa API a cada 5 s, ao voltar do navegador e ao voltar para o app; recusado: o motivo, "Tentar de novo" e "Escolher outra forma de pagamento" (desiste e volta ao checkout com as formas da loja); expirado/pago tarde: aviso e volta à sacola guardada); cartão pendente em `delivery-abatia:cartao-pendente:v1`, retomado pelo `RetomarPix`; rota `cartao-retorno` que só volta para a tela. Texto do estorno do cartão: "O valor volta pelo Mercado Pago para o cartão ou a conta usada (no crédito, na fatura)."
- Testes (Mercado Pago falso): `test/pagamento-cartao.test.js` (15).

**Pendências**:
- Conferir no teste real: se a Linha de Crédito Mercado Pago aparece no checkout (Decisão 2: não excluída por enquanto; o identificador não está na documentação) e como sai o `payment_type_id` dela; se `marketplace_fee` aparece como `fee_details` `application_fee` nos pagamentos do Checkout Pro (senão a comissão não é conferida); se `X-Idempotency-Key` é aceito em `/checkout/preferences`; se a busca funciona sem `range`/`begin_date` (a referência marca como obrigatórios, o exemplo não usa).
- Segundo pagamento aprovado na mesma preferência (cliente pagou duas vezes): vira alerta `PAGAMENTO_DIVERGENTE`, sem estorno automático (o ADMIN estorna no Mercado Pago).
- Não testado em aparelho: abrir o navegador, a volta pelo link (`deliveryabatia://cartao-retorno` no Expo Go é outro esquema: lá o cliente fecha o navegador à mão), a retomada ao reabrir o app.
- `expo-doctor` acusa versões novas do SDK 58 publicadas depois do último lote (`expo` 58.1.0 e patches); não atualizadas nesta etapa.
- PDV 0.3.4 nas lojas antes de ligar o cartão (o 0.3.3 mostra só "Cartão" e funciona).

Fora: parcelamento, cartão salvo, Checkout Transparente para cartão.

### Etapa 8 — Revisão final (revisão de código FEITA em 2026-11-28, branch `feat/pagamento-online`, sem merge nem push)

**Feito** (um commit por problema, cada um com teste; Mercado Pago sempre falso):
- `380e4a3` "Tentar de novo" nunca pede um segundo estorno: com o `mpRefundId` gravado, consulta esse estorno (`mercadoPago.consultarEstorno`); sem ele, procura na lista de estornos do pagamento (`mercadoPago.listarEstornos`) um do mesmo valor que não seja um dos nossos já concluídos. Só sem nenhum, um estorno novo. Em andamento lá = 409 `ESTORNO_EM_ANDAMENTO`.
- `337e37b` `mp-connect` só desconecta a loja depois de o Mercado Pago confirmar: o token da loja é testado (`mercadoPago.tokenAindaAutorizado`, `GET /users/me`); ainda autorizado = notificação ignorada (`TOKEN_AINDA_AUTORIZADO`, aviso no log). Motivo: a assinatura não cobre o corpo (`user_id`, `action`).
- `30ae867` webhook recusa `ts` a mais de 10 minutos do relógio do servidor (`TOLERANCIA_TS_WEBHOOK_MS`; segundos ou milissegundos, `instanteDoTs`) com 401.
- `13f5592` notificação de pagamento numa conta que já foi de uma loja e está desconectada = alerta `PAGAMENTO_CONTA_DESCONECTADA` (id do pagamento, pedido, um por pagamento). Migration `20261201120000_alerta_conta_desconectada` (só o enum).
- `ad1bec1` Pix cujo cancelamento no Mercado Pago falhou (aos 15 minutos ou na desistência): `Pagamento.cancelarNoMpAte` = fim dos 30 minutos do Pix lá; a rotina de 1 minuto consulta e cancela de novo até essa hora (aprovado no intervalo = estorno automático, o caminho do pago depois de expirar). Migration `20261201120100_pix_cancelar_de_novo` (só aditiva).
- `f52ffc6` interruptor próprio da campanha: **`CAMPANHA_FRETE_GRATIS_ATIVA`** ("sim" liga, vazio por padrão). A campanha só funciona com ela ligada E o `CAMPANHA_TELEFONE_SECRET` válido; ligada sem o segredo = a API não sobe. Independente do `PAGAMENTO_ONLINE_ATIVO` (antes bastava o segredo preenchido).
- `f6f3064` alerta `TAXA_ENTREGA_COMPLEMENTO` na aprovação (junto com o lançamento), não na criação: Pix que expira não gera alerta falso.
- As duas migrations novas foram aplicadas no banco de dev (`migrate diff` sem diferença).

**Risco aceito (decisão do dono, 2026-11-28)**: a "primeira compra" da campanha confere os pedidos `FINALIZADO` pelo telefone em texto do pedido, que a exclusão da conta apaga. Quem comprou **sem** a campanha, excluiu a conta e voltou com o mesmo número ganha o frete grátis uma vez. Não corrigido: corrigir exigiria guardar o hash do telefone de todo cliente que já comprou, mesmo depois da exclusão, sem consentimento claro (LGPD), e o risco é um frete grátis de poucos reais. (Quem já usou a campanha continua barrado: o hash do uso fica.)

**Falta da Etapa 8** (fora do código): teste de ponta a ponta com as contas de teste do Mercado Pago (Pix e cartão, no APK e no PDV real), conferir no painel o dinheiro na conta da loja e a comissão na da plataforma, `app/PUBLICACAO.md` com o pagamento (Segurança dos dados, compras no app) e o README. A lista completa está em "Pendências para o lançamento" abaixo.

Texto do plano (escrito antes):

- Revisão de segurança (`/security-review`) e de código na branch inteira.
- Teste de ponta a ponta com as contas de teste do Mercado Pago (vendedor e comprador de teste), Pix e cartão, no Expo Go/APK e no PDV real.
- Conferir no painel do Mercado Pago o dinheiro na conta da loja e a comissão na conta da plataforma.
- Atualizar CLAUDE.md, README (variáveis, passo a passo), `app/PUBLICACAO.md` (Segurança dos dados com o pagamento) e este plano com o que mudou.
- Lista do que fica para depois.

Commits previstos: `docs: pagamento online` e as correções que a revisão pedir, cada uma no seu commit.

## 5. Riscos e cuidados

- Conferir na documentação atual do Mercado Pago, na etapa em que for usado: o prazo mínimo de `date_of_expiration` do Pix (ver pergunta 5), o que acontece com o `application_fee` num estorno, e o formato da assinatura `x-signature`.
- Contestação de cartão (chargeback) recai sobre a conta da loja; a plataforma pode perder a comissão. Só registrar, sem automação.
- Uma instância da API só (como hoje): as rotinas de expiração e renovação não estão preparadas para várias instâncias (as transições condicionadas evitam dano, mas haveria chamadas repetidas ao Mercado Pago).
- O site da Cabana usa o mesmo canal `SITE`: o pagamento online fica só no app enquanto não houver decisão em contrário (pergunta 3).

## 6. Perguntas em aberto

As 22 perguntas foram enviadas ao dono em 2026-11-25 e respondidas no mesmo dia. As respostas estão na seção "Decisões", com o mesmo número da pergunta; as referências "pergunta N" nas etapas apontam para elas.

## 7. Decisões

Respostas do dono (2026-11-25). **Onde divergirem do texto das etapas acima, valem estas decisões**: cada etapa ajusta o plano dela ao começar.

1. **Taxa por km**: loja com entregador da plataforma passa a cobrar R$ 1,00 + R$ 0,90/km (`shared/src/taxaKm.js`) **neste lote**, no lugar da taxa da área. Loja com motoboy próprio continua com a taxa da área, que é dela.
2. **Modo de entrega**: só o ADMIN define, em Lojas. Toda loja começa como motoboy próprio (`modoEntrega = LOJA`), a Cabana inclusive.
3. **Site da Cabana**: pagamento online só no app. O site continua só na entrega.
4. **Desconto da plataforma**: neste lote só entra o **frete grátis na primeira compra** (campanha: um por telefone, bancado pelo dono da plataforma), que vale **nos dois tipos de loja** (corrigido em 2026-11-25; antes limitava ao entregador da plataforma). Regras de custo na decisão 16. Não criar cupom nem desconto em produto. O tipo "crédito da loja" do livro-razão passa a ser usado pela campanha em loja com motoboy próprio (decisão 16).
5. **Expiração do Pix**: mandar ao Mercado Pago o mínimo permitido (30 minutos) e cancelar nós mesmos o pagamento no Mercado Pago aos 15 minutos.
6. **Número do dia**: só na aprovação. O número pode ficar opcional no banco (nulo enquanto aguarda pagamento).
7. **Pix expirado**: status novo `EXPIRADO`, fora do relatório de cancelados.
8. **Aprovação atrasada** (pago depois de expirado): estornar sozinho e avisar o ADMIN.
9. **Finalizar pago online**: finaliza sem caixa aberto e sem escolher forma.
10. **Estorno recusado**: o pedido fica `CANCELADO` e o pagamento fica "reembolso pendente", com alerta para o ADMIN e **sem retentativa automática**. Estorno parcial só pelo ADMIN, por valor (com motivo), não por item.
11. **Formas por tipo de loja**:
    - Entregador da plataforma: Pix online, crédito online e dinheiro. Sem Pix na entrega e sem maquininha.
    - Motoboy próprio: as formas de hoje (Pix na entrega, dinheiro, débito e crédito na maquininha) mais Pix online e crédito online, se a loja estiver conectada.
12. **Arredondamento**: o entregador fica com 95% da taxa arredondado meio para cima; a plataforma com o resto.
13. **E-mail do pagador**: se o cliente não tiver e-mail, pedir uma vez no checkout do Pix/cartão e salvar no cadastro. Não inventar e-mail.
14. **Pedidos do PDV**: delivery lançado pelo PDV em loja com entregador da plataforma usa o entregador, e a loja deve a taxa no fechamento.
15. **Fechamento**: semana de segunda a domingo pelo dia operacional, fechada automaticamente. O ADMIN marca "quitado", com data e observação.
16. **Frete grátis (regra final, confirmada em 2026-11-25)**. Refina a regra fixa da seção 2 ("frete grátis = comissão zero"), que passa a valer só para a campanha.
    - **Frete grátis que a loja configura** (`Loja.freteGratis*`): custo da loja; o cliente não paga a taxa.
      - Loja com entregador da plataforma: a comissão enviada ao Mercado Pago é a **taxa cheia** (sai da parte da loja). Em dinheiro, a loja deve a taxa cheia no fechamento.
      - Loja com motoboy próprio: nada muda (a taxa já é da loja).
    - **Frete grátis da campanha** (primeira compra, um por telefone): custo da plataforma; vale nos dois tipos de loja.
      - Loja com entregador da plataforma: comissão **zero** (o campo é omitido). A plataforma paga o entregador normalmente (os 95% continuam gravados no pedido).
      - Loja com motoboy próprio: o cliente não paga a taxa, e a taxa da área que a loja cobraria vira **crédito da loja** no fechamento semanal. Vale para qualquer forma de pagamento.
    - **Os dois no mesmo pedido**: vale o da loja (custo da loja) e a campanha **não é consumida**; o cliente continua com a primeira compra grátis para o próximo pedido.
17. **Desconectar com Pix pendente**: cancelar os Pix pendentes no Mercado Pago e os pedidos aguardando pagamento, e avisar antes de confirmar a desconexão.
18. **Retaguarda**: tela nova "Pagamento online".
19. **Relatório e caixa**: separar "pago online" das formas pagas na entrega.
20. **Política de privacidade**: rascunho na etapa 4, marcado como pendente de revisão jurídica.
21. **Pix expirado no app**: o cliente refaz o pedido, com a sacola guardada.
22. **"Recebi o dinheiro"**: é o próprio "Finalizar" do PDV com outro nome nos pedidos em dinheiro com entregador da plataforma.

Outros: o `app/assets/brand/logo.jpg` fora do git fica como está.

### Decisões da Etapa 2 (2026-11-25)

Respostas do dono às perguntas da Etapa 2. Valem sobre o texto da Etapa 2 onde divergirem.

1. **Campanha (reserva e uso)**: reservar na criação do pedido; contar como usada na aprovação do pagamento online ou na finalização do pedido pago na entrega; liberar se o pedido expirar ou for cancelado (inclusive cancelamento pelo ADMIN depois do aceite).
2. **Telefone da campanha**: só vale o telefone verificado por código. Sem telefone verificado, não ganha a campanha nesta etapa.
   - **Pendência da Etapa 4**: o app deve oferecer "verifique seu telefone para ganhar frete grátis na primeira compra" no checkout.
3. **Canal da campanha**: só no app. Não vale em pedido do PDV nem do site.
4. **Sem pino em loja com entregador da plataforma**:
   - App: exigir o pino no mapa para entregar em loja `PLATAFORMA`; sem pino, o checkout pede para marcar o endereço no mapa (validação no app: Etapa 4). Nesta etapa, o `criarPedido` recusa pedido do cliente sem pino em loja `PLATAFORMA`.
   - PDV: usa a taxa da área da loja como reserva. A taxa continua sendo da plataforma (95/5 igual) e o pedido grava de onde veio a taxa (`KM` ou `AREA`) para auditoria.
   - O `split.js` recebe a taxa já resolvida e a origem dela; ele não decide entre km e área.
5. **Comissão maior que o total**, as duas proteções:
   - Retaguarda: em loja `PLATAFORMA`, o pedido mínimo do frete grátis da loja não pode ser menor que um valor global configurável (padrão R$ 20,00), com aviso explicando o motivo.
   - Trava no `split.js`: se mesmo assim a taxa passar de 50% do valor cobrado do cliente, o valor no split fica limitado a 50% do valor cobrado e a diferença vira débito da loja no livro-razão (tipo novo `TAXA_ENTREGA_COMPLEMENTO`), com alerta para o ADMIN.
6. **Dia operacional** do pedido pago online: o da aprovação, junto com o número.
7. **Status do pagamento**: acrescentar `CANCELADO` e `REEMBOLSO_PARCIAL`.
8. **Enums** em maiúsculas, no padrão dos atuais.
9. **Formas de pagamento**: função no shared, campo novo `formasPagamento` no `/publico/lojas/:slug/config` (só acrescentado) e o `criarPedido` recusando forma que não vale para o tipo da loja. O app não muda nesta etapa.

### Decisões da Etapa 3 (2026-11-25)

1. **Módulo único do Mercado Pago**: todas as chamadas à API do Mercado Pago (OAuth, pagamentos, preferências, estornos, consultas, cancelamentos) ficam em um só módulo da API (`api/src/lib/mercadoPago.js`), com funções nossas (`montarUrlAutorizacao`, `trocarCodePorToken`, `renovarToken`; depois `criarPix`, `consultarPagamento`, `cancelarPagamento`, `estornar`, `criarPreferencia`). Nenhum outro arquivo chama a API direto. Motivo: a API de Payments (`/v1/payments`) aparece no painel do Mercado Pago como "será descontinuada em breve"; uma migração para a API de Orders deve mexer só nesse módulo.

Respostas às pendências da Etapa 2:
2. **Separar app e site** (Etapa 4): criar a origem/canal `APP`, distinta de `SITE`, no pedido. Também resolve o PDV mostrar "Site" para pedido do app. Pino obrigatório, campanha e pagamento online valem só para `APP`.
3. **PDV em loja `PLATAFORMA`**: só dinheiro na entrega; retirada no balcão e "pago agora" aceitam todas as formas (confirmado).
4. **Taxa zero** não consome a campanha (confirmado).
5. **Trava de 50%** arredondada para baixo (confirmado).
6. **"Primeira compra"**: o telefone só tem direito se nunca usou a campanha **e** não tem nenhum pedido `FINALIZADO` anterior (Etapa 3).
7. **Telefone da campanha em hash**: a tabela da campanha guarda HMAC-SHA256 do telefone (segredo em variável de ambiente), não o telefone em texto; o que estiver em texto é migrado (Etapa 3). **Anotar na política de privacidade da Etapa 4.**
8. **Taxa digitada no PDV em loja `PLATAFORMA`**: não permitida. A taxa é a da área, com origem `AREA`, porque é da plataforma e a loja não pode mudar. Em loja `PROPRIO`, continua como hoje (Etapa 3).
9. **Piso ao mudar para `PLATAFORMA`**: o ADMIN vê o aviso e escolhe subir o mínimo para o piso ou desligar o frete grátis da loja; a loja nunca é salva violando o piso (Etapa 3).

Respostas às perguntas da Etapa 3:
10. **Segredos novos**: `MP_STATE_SECRET` (assina o state do OAuth) e `CAMPANHA_TELEFONE_SECRET` (hash do telefone da campanha), com no mínimo 32 caracteres e diferentes dos segredos JWT. `MP_STATE_SECRET` é exigido para conectar e, com `PAGAMENTO_ONLINE_ATIVO=sim`, para a API subir; `CAMPANHA_TELEFONE_SECRET` passa a ser exigido quando a reserva da campanha for ligada na criação do pedido (Etapa 4).
11. **Retorno do OAuth**: o state guarda o endereço de origem da retaguarda; só vale `https://taakidelivery.com.br` (e `localhost` em desenvolvimento). Fora da lista = `https://taakidelivery.com.br/parceiro`. **`cabana.managerpix.com.br` não é mais usado**: a retaguarda agora é só `taakidelivery.com.br/parceiro`.
12. **Alertas para o ADMIN**: tabela genérica, rota do ADMIN e tela "Alertas" na plataforma já na Etapa 3, com "marcar como resolvido" e contador de alertas abertos no menu. As etapas 4 a 6 só acrescentam tipos.
13. **Conectar com a flag global desligada**: permitido se a chave de cifra (e o segredo do state) estiver configurada; só o interruptor do pagamento online fica travado.
14. **Conta desconectada** pode ser conectada a outra loja; só bloqueia a conta CONECTADA ou EXPIRADA em outra loja.
15. **PKCE**: fica sem por enquanto (só o state assinado). **Melhoria futura**: ligar o PKCE no aplicativo do Mercado Pago e mandar o `code_verifier`.
16. **Trava da taxa na tela do PDV** (loja `PLATAFORMA`): fica para a **Etapa 5**; na Etapa 3 só a API recusa.

### Decisões da Etapa 4 (2026-11-25)

1. **PDV novo obrigatório** (o 0.3.1 esconde pedido `APP`). O filtro do PDV deixa de ser "lista de canais permitidos" e passa a ser "todos os canais, menos os status ocultos (`AGUARDANDO_PAGAMENTO`, `EXPIRADO`)", para um canal novo nunca mais deixar pedido invisível. **Ordem do lançamento: primeiro atualizar o PDV em todas as lojas, depois o build do app que manda `origem: 'APP'`.**
2. **Verificar o telefone da conta logada**: duas rotas autenticadas (enviar e verificar), o mesmo verificador e os mesmos limites do login por celular; telefone verificado em outra conta = 409. **`PHONE_VERIFIER` vazio em produção é pendência bloqueante do lançamento da campanha**; nada de modo teste em produção.
3. **Loja `PLATAFORMA` sem pino da loja**: o ADMIN não consegue mudar a loja para `PLATAFORMA` sem o pino salvo (mensagem clara). Se mesmo assim faltar, o pedido usa a taxa da área (origem `AREA`) e gera alerta para o ADMIN.
4. **Sem `CAMPANHA_TELEFONE_SECRET`**: campanha desligada, com aviso no log.
5. **Falha ao criar o Pix**: pedido `EXPIRADO` (estoque e campanha devolvidos) e 502. O app mostra "Não foi possível gerar o Pix agora. Tente de novo ou escolha outra forma de pagamento." e mantém a sacola. Mais de 3 falhas na mesma loja em 1 hora = alerta para o ADMIN.
6. **Pago depois de expirar**: status de pagamento novo `A_ESTORNAR` (processado na Etapa 5), com alerta para o ADMIN já agora.
7. **Acompanhamento**: aprovado, o app vai para a tela "Pedido nº N recebido".
8. **`notification_url`**: origem do `MP_REDIRECT_URI` + `/api/mercadopago/webhook`.
9. **Estoque e sacola**: estoque baixa na criação do Pix e volta se expirar; a sacola só é limpa na aprovação.
10. **Política**: rascunho em `docs/rascunho-privacidade-pagamento.md`, sem tocar na página nem na versão.

### Decisões da Etapa 5 (2026-11-26)

0. **Teste real da Etapa 4**: foi um sucesso (Pix aprovado na conta de teste, pedido chegou ao PDV). O erro do teste anterior foi o Mercado Pago **recusar o e-mail do pagador** (visto no `message`/`cause` registrado pelo `fix/pix-log-erro-mp`). Por isso, quando a recusa da criação do Pix aponta o e-mail, o app mostra "O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo." e leva o cliente a corrigir o e-mail; os outros erros continuam com a mensagem genérica.
1. **Aceite da loja** (só pedido pago online; o pago na entrega continua como hoje): o pedido chega ao PDV com "Aceitar" e "Recusar (o cliente recebe o valor de volta)". Mudar para Em preparo ou Saiu para entrega também conta como aceite. Depois do aceite o PDV não cancela e mostra "Para cancelar, fale com o Taaki". A impressão e o som continuam na chegada, como hoje.
2. **ADMIN**: pedido aberto (aceito ou não) = cancela com estorno total ou parcial e o estoque volta. Pedido finalizado = estorno total ou parcial **sem cancelar** (continua `FINALIZADO`, o estoque não volta, o relatório mostra o valor estornado à parte). Motivo obrigatório nos dois casos.
3. **Estoque** no cancelamento pelo ADMIN: volta sempre, como no cancelamento de hoje.
4. **Tela própria "Pagamentos online"** na plataforma (ADMIN), com os alertas de pagamento levando até ela (inclusive os reembolsos pendentes).
5. **Estorno feito direto no Mercado Pago** com o pedido aberto: atualiza o pagamento, alerta o ADMIN e o PDV mostra "ESTORNADO"; o pedido não é cancelado sozinho.
6. **App**: "Cancelar pedido" só no pedido pago online ainda não aceito, com "Aguardando a loja aceitar".
7. **Pedido sem aceite**: sem recusa automática nesta etapa (**pendência**: recusa automática). Aos **5 minutos** sem aceite o PDV toca o alerta de novo e destaca o pedido; aos **10 minutos**, alerta `PEDIDO_SEM_ACEITE` para o ADMIN ligar para a loja; o cliente pode cancelar pelo app enquanto não for aceito.

### Decisões da Etapa 6 (2026-11-26)

1. **Débito da taxa** (`TAXA_ENTREGA_DINHEIRO`): todo pedido com entrega pelo Taaki que **não foi pago online** (dinheiro na entrega ou "pago agora" no balcão com Pix ou cartão) gera o débito da taxa para a loja.
2. **Complemento da trava**: lançado na **aprovação do Pix** e desfeito se o pedido for cancelado com estorno.
3. **Estorno total ou parcial de pedido finalizado** (ADMIN): não mexe no livro-razão. O Mercado Pago devolve ao cliente também a parte da plataforma (estorno proporcional), mas o entregador já entregou e recebe os 95%; quem arca depende de quem errou, e o ADMIN decide caso a caso com ajuste manual. Ao estornar um pedido finalizado de loja `PLATAFORMA`, a tela mostra esse aviso e um atalho para o ajuste manual com a loja e o pedido preenchidos.
4. **Semana com saldo zero** (com lançamentos): gera o fechamento já `QUITADO`, com a observação "Saldo zero".
5. **Variáveis**: `FECHAMENTO_ATRASO_DIAS` (padrão 7) e `CAMPANHA_ORCAMENTO_CENTAVOS` (padrão 70000); o resumo da campanha mostra "R$ X de R$ 700,00".
6. **Menu "Fechamento"** para todas as lojas, com "Nenhum valor a acertar com o Taaki" quando não houver nada.

### Decisões da Etapa 7 (2026-11-27)

1. **Item da preferência**: um item só com o total ("Pedido na <loja>").
2. **Formas no Checkout Pro**: saldo Mercado Pago aceito (não pode ser excluído). Excluídos só boleto, lotérica/caixa eletrônico e Pix (o Pix já é oferecido no app). **Débito e pré-pago continuam** (à vista, aprovam na hora, ajudam quem não tem crédito). Linha de Crédito Mercado Pago: não excluída por enquanto; conferir no teste real (pendência). Por isso a opção do app é "Cartão pelo app (pagar agora)" e a forma gravada na aprovação reflete o tipo real (crédito, débito, pré-pago) quando o Mercado Pago informa, para o relatório e o cupom.
3. **Cartão recusado**: a recusa não encerra o pedido, que continua aguardando até os 15 minutos; o app mostra o motivo com "Tentar de novo"; "Escolher outra forma" desiste do pedido (estoque e campanha voltam) e volta ao checkout com as formas da loja.
4. **Prazo**: 15 minutos na preferência; a rotina de 1 minuto expira o pedido; pago depois = estorno automático e alerta (caminho de hoje). Sem tolerância extra.

### Decisões da Etapa 8 (2026-11-28)

1. Corrigir os itens 1 a 7 da revisão, um commit por problema, cada um com teste (ver Etapa 8 › Feito).
2. **Campanha com interruptor próprio** (`CAMPANHA_FRETE_GRATIS_ATIVA`, vazio por padrão), nem presa ao `PAGAMENTO_ONLINE_ATIVO` nem ligada só pelo segredo: o dono liga a campanha só no dia do lançamento.
3. **"Tentar de novo" do estorno**: só cria estorno novo quando não existe nenhum estorno registrado em andamento ou concluído para aquele valor.
4. **Primeira compra depois da exclusão da conta**: risco aceito, não corrigido (LGPD; ver Etapa 8).

## 8. Pendências para o lançamento (2026-11-28)

### Bloqueiam o lançamento

- **Validar o split com dinheiro real numa loja com entregadores do Taaki: a taxa de entrega cai na conta do Taaki.** Um Pix de valor baixo, pago de verdade, numa loja `PLATAFORMA` conectada com uma conta Mercado Pago REAL com chave Pix; conferir no painel que o valor dos produtos menos a tarifa ficou na conta da loja e a comissão (`application_fee`) chegou na conta do Taaki. Depois, estornar esse pedido pelo ADMIN e conferir a devolução das duas partes.
- **Teste de ponta a ponta** pelo roteiro abaixo ("Roteiro de teste antes de ligar em produção"), no APK e no PDV real. **O Pix só pode ser testado com uma conta Mercado Pago REAL com chave Pix**: a conta de vendedor de teste não tem chave Pix e o Mercado Pago recusa gerar o QR (erro 13253, "Collector user without key enabled for QR render"). Os cartões de teste continuam com a conta de vendedor de teste.
- **Painel do Mercado Pago** configurado (aplicação, redirect, webhooks, chave secreta, credenciais de produção) e **variáveis no Railway** (lista no relatório da Etapa 8 e no `api/.env.example`). Fazer o deploy desta branch (duas migrations novas) antes de ligar.
- **Revisão jurídica** da política e dos termos com o pagamento (`docs/rascunho-privacidade-pagamento.md`: hoje fala só do Pix; acrescentar o cartão pelo Checkout Pro, em que o cliente digita o cartão no site do Mercado Pago) e **trocar `DOCUMENTOS_APP.versao`** ao publicar (todos aceitam de novo). Termo com cada loja (uso dos dados, papel no pagamento, Mercado Pago da loja).
- **PDV 0.3.4 instalado em todas as lojas antes do build do app** que manda `origem: 'APP'` (o 0.3.1 esconde os pedidos do app; o 0.3.3 funciona, mas mostra só "Cartão").
- **Build do app** (versionCode 5, EAS) com `GOOGLE_MAPS_ANDROID_KEY`/`GOOGLE_MAPS_IOS_KEY`, testado no aparelho: Pix (QR, copiar, retomar ao reabrir), cartão no navegador e a volta pelo `deliveryabatia://cartao-retorno`, mapa, GPS e permissão.
- **Mapas**: chaves do Google (servidor, web, Android, iOS; `app/CONFIGURACAO_MAPAS.md`). Loja com entregador do Taaki exige o pino e cobra por km. **Apagar `PINO_ENTREGA_OPCIONAL`** do Railway antes da primeira loja real.
- **Modo teste do telefone em produção**: apagar `PHONE_VERIFIER=test`, `PHONE_TEST_EM_PRODUCAO` e `PHONE_TEST_NUMBERS` antes da primeira loja real (o log do deploy não pode trazer "TESTE EM PRODUÇÃO").
- **Play Console**: Segurança dos dados com o pagamento (e-mail e histórico de compras compartilhados com o processador de pagamentos), questionário de conteúdo (hoje diz "sem compras no app, pagamento na entrega"), textos da ficha ("O pagamento é feito na entrega") e link da política e da exclusão de conta no domínio do Taaki (`app/PUBLICACAO.md`). Na App Store, a observação da revisão ("pagamento feito na entrega") também muda.
- **Campanha (só se ela entrar no lançamento)**: SMS real no `PHONE_VERIFIER` (Firebase previsto; sem ele ninguém verifica o telefone e a campanha nunca vale). Ligar `CAMPANHA_FRETE_GRATIS_ATIVA=sim` só no dia, com o `CAMPANHA_TELEFONE_SECRET` definido.

### Roteiro de teste antes de ligar em produção

Contas: **Pix = conta Mercado Pago REAL com chave Pix** (a loja; o pagador paga de verdade, com valores baixos, e o ADMIN estorna depois); **cartão = conta de vendedor de teste** + comprador de teste e os cartões de teste do Mercado Pago. A loja do Pix com entregadores do Taaki serve também para o split.

1. Deploy desta branch (migrations novas aplicadas), variáveis no Railway, painel do Mercado Pago (redirect, webhooks com a chave secreta), PDV 0.3.4 e o APK do versionCode 5.
2. Loja `PLATAFORMA` com pino, conectada à conta REAL com chave Pix; o dono liga o interruptor.
3. **Pix aprovado + split** (o primeiro item bloqueante): prévia com a taxa por km; pagar; o pedido chega ao PDV com "PAGO ONLINE"; aceitar; finalizar sem caixa; no painel, a loja recebe os produtos (menos a tarifa) e o Taaki a taxa de entrega.
4. **Pix sem pagar**: aos 15 min o pedido expira, o estoque volta e o Pix aparece cancelado no Mercado Pago (se o cancelamento falhar, o log mostra e a rotina tenta de novo até os 30 min).
5. **Pix pago depois de expirar**: estorno automático e alerta `PAGO_APOS_EXPIRAR`.
6. **Cartão** (conta de vendedor de teste): aprovado (o tipo real no cupom: crédito, débito); recusado e "Tentar de novo"; "Escolher outra forma".
7. **Cancelamentos e estornos**: recusa da loja antes do aceite (estorno total); cancelamento pelo cliente antes do aceite; estorno parcial e total pelo ADMIN (dois parciais de mesmo valor saem os dois); "Tentar de novo" de um estorno pendente.
8. **Webhook e conexão**: o log não pode trazer "webhook recusado: ts fora da janela" para notificações legítimas (se trouxer, a diferença em segundos aparece ali); desconectar com pedido pago aberto (bloqueado) e com Pix pendente (cancelado); desvincular a aplicação no Mercado Pago (alerta `MP_DESVINCULADA`); notificação de uma conta já desconectada (alerta `PAGAMENTO_CONTA_DESCONECTADA`).
9. **Fechamento**: pedido em dinheiro com os entregadores do Taaki ("Recebi o dinheiro") e o lançamento na semana.
10. **Conferir no teste real**: assinatura do webhook com o `data.id` como chega, `mp-connect` assinado e o `action`, comissão em `fee_details` (Pix e Checkout Pro), `X-Idempotency-Key` em `/checkout/preferences`, busca sem `range`, resposta do `/refunds` (`approved` ou `in_process`), `GET /users/me` com token revogado (401/403), Linha de Crédito no checkout.
11. **Flags desligadas**: com `PAGAMENTO_ONLINE_ATIVO` e `CAMPANHA_FRETE_GRATIS_ATIVA` vazias, o app pede como antes (só na entrega, sem campanha nem a faixa "verifique seu telefone").

### Podem ficar para depois do lançamento

- **Limpeza do domínio antigo** `cabana.managerpix.com.br`: o pagamento não depende dele (o retorno do OAuth volta para `taakidelivery.com.br`). Antes de tirar: versionCode 3 fora de uso, PDVs instalados com o servidor trocado, destino do site da Cabana, Google Branding/origens, `CORS_ORIGINS`. `managerpix.com.br` vence em 11/04/2027.
- Recusa automática do pedido pago sem aceite (hoje só o toque extra aos 5 min e o alerta aos 10).
- PKCE no OAuth (manter desligado no aplicativo do Mercado Pago até lá).
- Segundo pagamento aprovado na mesma preferência do cartão: só alerta (o ADMIN estorna no Mercado Pago).
- Tópico próprio `chargebacks` (hoje o chargeback chega pelo status do tópico `payment`).
- Várias instâncias da API: as rotinas (pagamento, renovação, fechamento) supõem uma só.
- Migração da API de Payments para a de Orders (só `api/src/lib/mercadoPago.js`).
- Saldo diário e pagamento dos entregadores; arredondamento da taxa por km para R$ 0,50 (lote dos entregadores).
- Liberação do `/app` por loja (Android e iOS separados): **vira bloqueante se o lançamento for primeiro no iPhone**.
- Versões novas do SDK 58 apontadas pelo `expo-doctor`; README sem a seção do pagamento online.
- Risco aceito: primeira compra depois da exclusão da conta (Etapa 8).
