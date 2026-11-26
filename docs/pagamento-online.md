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

### Etapa 4 — Pix no app, webhook, conciliação e expiração

Objetivo: o cliente paga por Pix dentro do app e o pedido só chega ao PDV aprovado.

API:
- `criarPedido` aceita `pagamento: { modo: 'ONLINE', meio: 'PIX' }` só no canal do cliente e só com a loja apta (senão 409 `PAGAMENTO_ONLINE_INDISPONIVEL`). Nesse caso: status `AGUARDANDO_PAGAMENTO`, **sem** cupom e **sem** `pedido:novo`; estoque baixado na criação (reserva de 15 min); número do dia conforme a pergunta 6.
- Depois do commit, `pagamento.service.criarPix(pedido)`: `POST /v1/payments` com o token da loja, `X-Idempotency-Key`, `transaction_amount` (total do servidor), `payment_method_id: "pix"`, `payer.email` (pergunta 13), `description`, `external_reference` (id do pedido), `notification_url`, `date_of_expiration` e `application_fee` só quando > 0. Falha ao criar o Pix = pedido cancelado na hora (estoque devolvido) e 502 `PAGAMENTO_FALHOU` para o app.
- `POST /cliente/pedidos` devolve o pedido + `pagamento: { qrCode, qrCodeBase64, expiraEm }`. `GET /cliente/pedidos/:id/pagamento` (só o dono do pedido) consulta o Mercado Pago se ainda pendente e devolve o estado (o app chama a cada poucos segundos na tela do Pix).
- `POST /mercadopago/webhook` (pública): confere a assinatura `x-signature` com `MP_WEBHOOK_SECRET`, grava o evento (dedupe), responde 200 rápido e processa: busca o pagamento pelo `data.id` no banco (desconhecido = ignora), consulta `GET /v1/payments/:id` com o token da loja e concilia.
- Conciliação (`conciliar(pagamento, respostaMp)`), uma função só para webhook, consulta do app e rotina: `approved` com valor igual ao total → numa transação, `AGUARDANDO_PAGAMENTO → CONFIRMADO` condicionado, `pagoOnlineEm`, forma `PIX`, cupom PEDIDO, e depois do commit `pedido:novo` + `impressao:nova`; `rejected`/`cancelled`/vencido → encerra e devolve o estoque; valor diferente → não aprova e registra alerta.
- Expiração: rotina a cada minuto procura pendentes com `expiraPagamentoEm` passado, consulta o Mercado Pago uma última vez (aprovado no último segundo vence), cancela o pagamento lá (`PUT /v1/payments/:id { status: "cancelled" }`) e encerra o pedido com o estoque devolvido. Aprovação que chega depois de encerrado: pergunta 8.
- `pedidoPublico` ganha `modoPagamento`, `meioOnline`, `pagoOnline`; o histórico do cliente mostra "Aguardando pagamento", "Pagamento expirado".
- Política de privacidade do app: o Mercado Pago passa a receber dados do pagador. Texto novo e `DOCUMENTOS_APP.versao` nova (todos aceitam de novo), com revisão jurídica (pergunta 20).

App (versionCode novo):
- `expo-clipboard` (versão do `bundledNativeModules.json`).
- `logica/pedido.js`: formas conforme a loja (`modoEntrega`, pagamento online disponível) vindas do `/publico/lojas/:slug/config` (campo novo, aditivo).
- `componentes/Finalizacao.js`: seção "Pagar agora" (Pix) separada de "Pagar na entrega".
- Tela nova `app/sacola/pix.js`: QR code, "Copiar código Pix", contagem regressiva de 15 min, consulta periódica, aprovado → `enviado`; expirado → aviso e volta à sacola (itens mantidos).
- `logica/pagamento.js` (pura, testada): estado da tela, tempo restante, interpretação de erros.

Testes: `api/test/pagamento-pix.test.js` com Mercado Pago falso (criação com e sem comissão, comissão nunca vinda do cliente, webhook com assinatura inválida, duplicado, fora de ordem, aprovação concorrente com expiração, valor divergente, pedido não aparece no `GET /equipe/pedidos` nem imprime antes da aprovação, estoque devolvido na expiração, idempotência do `POST /cliente/pedidos`); app `test/pagamento.test.js`.

Commits previstos:
- `feat(api): criar o Pix do pedido no Mercado Pago com a comissão do marketplace`
- `feat(api): webhook do Mercado Pago com assinatura e conciliação do pagamento`
- `feat(api): expiração do Pix em 15 minutos com devolução do estoque`
- `feat(api): pedido aguardando pagamento fora do PDV até a aprovação`
- `feat(api): política do app com o Mercado Pago (versão nova)`
- `feat(app): pagar com Pix no app (QR, copia e cola, expiração)`
- `chore(app): versionCode N`

### Etapa 5 — Cancelamento, estorno e exibição no PDV

API:
- `cancelarPedido` em pedido pago online: estorno total no Mercado Pago (`POST /v1/payments/:id/refunds`, token da loja, `X-Idempotency-Key`) **antes** de cancelar; estorno recusado = 502 `ESTORNO_FALHOU` e o pedido continua aberto (pergunta 10). O que acontece com a comissão no estorno fica registrado conforme o retorno do Mercado Pago.
- Webhook trata `refunded`, `charged_back` e `in_mediation` (registra e avisa a equipe; sem automação além disso).
- Finalizar pedido pago online: não pede forma nem caixa (pergunta 9); `caixaId` fica nulo e o caixa do balcão não muda.
- Dinheiro na entrega com entregador da plataforma: o "Finalizar" do PDV vira "Recebi o dinheiro" e gera o débito da taxa no livro-razão (etapa 6; aqui só o registro no pedido).
- `pedidoDaEquipe` e a fila de impressão ganham `modoEntrega`, `pagoOnline`, `meioOnline`.
- Relatório do dia e caixa: pagamento online separado de "Pix/crédito na entrega" (pergunta 19).
- `shared/src/cupom.js`: "Pix - PAGO ONLINE" / "Crédito - PAGO ONLINE", sem troco; "Entrega: Taaki" quando for da plataforma.

PDV:
- `lib/painel.js` e `LinhaPedido.jsx`: selo "Pago online · Pix"; filtro não muda (aguardando pagamento nunca chega).
- `DetalhePedido.jsx`: finalizar sem escolher forma; cancelar com o aviso "o valor será devolvido ao cliente pelo Mercado Pago"; erro de estorno mostra a mensagem.
- Snapshot de cupom novo em `shared/test`.

Testes: estorno total, estorno falhou (pedido continua), cancelamento concorrente com finalizar, finalizar sem caixa, cupom, relatório; PDV `test/painel.test.js`.

Commits previstos:
- `feat(api): cancelar pedido pago online com estorno no Mercado Pago`
- `feat(api): finalizar pedido pago online sem caixa e sem trocar a forma`
- `feat(shared): cupom com pagamento online e entrega da plataforma`
- `feat(pdv): selo de pago online e cancelamento com estorno`
- `feat(api): relatório do dia com pagamento online separado`

### Etapa 6 — Livro-razão da loja e fechamento semanal

Modelos:
- `LancamentoLoja`: `lojaId`, `pedidoId?`, `tipo` (`TAXA_ENTREGA_EM_DINHEIRO` = loja deve à plataforma; `CREDITO_DESCONTO_PLATAFORMA` = plataforma deve à loja; `AJUSTE` manual do ADMIN com motivo; `ESTORNO_DE_LANCAMENTO`), `valorCentavos` com sinal (positivo = loja deve), `criadoEm`, `criadoPorId`, `fechamentoId?`. Só inserção: correção é outro lançamento (nunca update/delete; trigger como o dos anúncios).
- `FechamentoSemanal`: `lojaId`, `inicio`, `fim` (semana conforme a pergunta 15), `saldoCentavos`, `situacao` (`ABERTO`, `FECHADO`, `QUITADO`), `fechadoEm`, `quitadoEm`, `quitadoPorId`, `observacao`. Único por `[lojaId, inicio]`.
- Lançamentos nascem na finalização (dinheiro com entregador da plataforma) e na criação do pedido com desconto da plataforma (se existir: pergunta 4); cancelamento depois de lançado gera o lançamento oposto.

API e telas:
- `GET /retaguarda/financeiro?semana=` (DONO): lançamentos e saldo da semana.
- `GET /plataforma/financeiro` (ADMIN): saldo por loja; `POST /plataforma/financeiro/fechar { semana }`, `POST /plataforma/financeiro/:id/quitado`, `POST /plataforma/financeiro/ajuste`.
- Rotina semanal que fecha a semana anterior (ou só manual: pergunta 15).
- Retaguarda: tela "Financeiro" (DONO) e "Financeiro das lojas" (ADMIN), no estilo atual.

Testes: saldo bate com a soma; lançamento imutável; cancelamento estorna; semana pelo fuso de Brasília e pelo dia operacional; fechar duas vezes = 409.

Commits previstos:
- `feat(api): livro-razão da loja (lançamentos imutáveis)`
- `feat(api): fechamento semanal e quitação`
- `feat(retaguarda): financeiro da loja e das lojas`

### Etapa 7 — Cartão de crédito via Checkout Pro

API:
- `pagamento.service.criarPreferencia(pedido)`: `POST /checkout/preferences` com o token da loja, itens (ou um item com o total), `marketplace_fee` só quando > 0, `external_reference`, `notification_url`, `back_urls` para uma página da própria API que fecha o navegador, `payment_methods` só com cartão de crédito (exclui Pix, boleto, débito, saldo) e `installments: 1`, `expires` com a mesma janela do pedido.
- O webhook passa a receber os pagamentos criados pela preferência: o pagamento é ligado ao pedido pelo `external_reference` e conferido (valor, loja, `collector_id` = conta da loja).
- Mesma conciliação, expiração e estorno das etapas 4 e 5.

App:
- `expo-web-browser`; `Finalizacao.js` com "Cartão de crédito (pagar agora)"; ao voltar do navegador, consulta o pedido (o retorno do navegador nunca aprova nada sozinho).

Testes: preferência sem parcelamento e só crédito; `marketplace_fee` ausente quando zero; pagamento de outra conta ou valor divergente recusado; voltar sem pagar mantém aguardando até expirar.

Commits previstos:
- `feat(api): pagamento com cartão pelo Checkout Pro`
- `feat(app): pagar com cartão de crédito no navegador do app`

### Etapa 8 — Revisão final

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
