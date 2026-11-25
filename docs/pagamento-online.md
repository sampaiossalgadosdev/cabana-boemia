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

### Etapa 2 — Base

Objetivo: banco, regras puras e criptografia, sem nenhuma chamada ao Mercado Pago e sem mudar comportamento visível (tudo nasce desligado).

Modelos e migration (`api/prisma/migrations/<data>_pagamento_online_base`, só aditiva, com os CHECKs no SQL como nas outras):
- `StatusPedido` ganha `AGUARDANDO_PAGAMENTO` (migration própria só com o valor do enum, porque precisa de commit antes do uso, como foi com `ADMIN`) e, conforme a resposta à pergunta 7, `EXPIRADO`.
- Enums novos: `ModoEntrega` (`PLATAFORMA`, `LOJA`), `ModoPagamento` (`NA_ENTREGA`, `ONLINE`), `MeioOnline` (`PIX`, `CARTAO`), `StatusPagamentoOnline` (`PENDENTE`, `APROVADO`, `RECUSADO`, `EXPIRADO`, `CANCELADO`, `ESTORNADO`, `ESTORNO_PARCIAL`, `CONTESTADO`).
- `Loja`: `modoEntrega` (padrão `LOJA`: a Cabana e a loja de teste continuam como hoje), `pagamentoOnlineAtivo` (padrão false).
- `ContaMercadoPago` (uma por loja, `lojaId` único): `mpUserId`, `accessTokenCifrado`, `refreshTokenCifrado`, `publicKey`, `expiraEm`, `escopo`, `conectadaEm`, `conectadaPorId`, `renovadaEm`, `situacao` (`ATIVA`, `RENOVACAO_FALHOU`, `DESCONECTADA`), `ultimoErro`.
- `Pedido`: `modoEntrega`, `modoPagamento`, `meioOnline`, `taxaEntregaCheiaCentavos` (a taxa antes do frete grátis), `freteGratisPlataforma` (Boolean), `repasseEntregadorCentavos` (95%), `partePlataformaCentavos` (5%), `comissaoMarketplaceCentavos` (o que foi enviado ao Mercado Pago; 0 = campo não enviado), `pagoOnlineEm`, `expiraPagamentoEm`. CHECKs: repasse + parte = taxa cheia quando `modoEntrega = PLATAFORMA`, ambos nulos quando `LOJA`; comissão ≤ total; `ONLINE` exige `meioOnline`.
- O CHECK atual `pagoEm exige forma e caixaId` não é tocado: o pagamento online usa `pagoOnlineEm` (sem caixa), para não mexer no "pago agora" do PDV.
- `PagamentoOnline`: `pedidoId`, `lojaId`, `meio`, `mpPagamentoId` (Pix) ou `mpPreferenciaId` (cartão), `chaveIdempotencia` (UUID enviado no `X-Idempotency-Key`), `valorCentavos`, `comissaoCentavos`, `status`, `statusDetalheMp`, `qrCode`/`ticketUrl` (Pix), `initPoint` (cartão), `expiraEm`, `aprovadoEm`, `estornadoCentavos`, `criadoEm`. Índice único em `mpPagamentoId`.
- `EventoWebhookMp` (dedupe e auditoria): `idNotificacao`/`requestId`, `tipo`, `dataId`, `recebidoEm`, `processadoEm`, `resultado`. Sem dados pessoais.

Regras puras e libs:
- `shared/src/split.js` (testado): `dividirTaxaEntrega(taxaCheia)` → `{ entregador, plataforma }` com 95% arredondado ao centavo (regra de arredondamento: pergunta 12) e a plataforma com o resto (a soma bate sempre); `comissaoMarketplace({ modoEntrega, taxaCobrada })` → centavos (0 = não enviar); `centavosParaReais` exato (string com 2 casas, sem ponto flutuante).
- `api/src/lib/cifra.js` (testado): `cifrar`/`decifrar` AES-256-GCM, IV aleatório de 12 bytes, formato `v1:<iv>:<tag>:<dados>` em base64url, chave de 32 bytes de `PAGAMENTO_CHAVE_CRIPTO`; o prefixo de versão permite trocar a chave depois. `server.js` recusa iniciar com `PAGAMENTO_ONLINE` ligado e chave ausente ou inválida (como faz com os segredos JWT).
- `api/src/lib/pagamentoOnline.js`: leitura das variáveis e `pagamentoOnlineDisponivel(loja, conta)`.
- `criarPedido` passa a gravar `modoEntrega`, `taxaEntregaCheiaCentavos` e, para `PLATAFORMA`, repasse e parte. Cálculo da taxa conforme a pergunta 1 (por km ou área).

Variáveis (só os nomes no `.env.example` e no `api/.env.railway`, vazias): `PAGAMENTO_ONLINE`, `PAGAMENTO_CHAVE_CRIPTO`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI`, `MP_WEBHOOK_SECRET`. `test/env-example.test.js` e `test/env-railway.test.js` já acusam variável faltando.

Testes: `shared/test/split.test.js`; `api/test/cifra.test.js` (ida e volta, tag adulterada, chave errada); migration (CHECKs com combinações inválidas, inclusive o caso de NULL que passou no lote do mapa); `criarPedido` grava repasse/parte com e sem frete grátis; tudo igual com as flags desligadas.

Commits previstos:
- `feat(api): status AGUARDANDO_PAGAMENTO no enum do pedido`
- `feat(api): modelos do pagamento online (conta Mercado Pago, pagamento, webhook) e modo de entrega`
- `feat(shared): divisão da taxa de entrega e comissão do marketplace`
- `feat(api): cifra dos tokens da loja (AES-256-GCM)`
- `feat(api): pedido grava modo de entrega, taxa cheia e repasse do entregador`
- `docs: variáveis do pagamento online`

### Etapa 3 — OAuth da loja

Objetivo: o dono conecta, vê o estado e desconecta a conta Mercado Pago; a API renova o token sozinha.

API:
- `api/src/lib/mercadoPago.js`: cliente HTTP com `fetch` injetável (como `lib/mapas.js`), tempo limite, sem log de token. Nesta etapa: `urlDeAutorizacao`, `trocarCodigo`, `renovar`.
- `api/src/services/contaMp.service.js`: conectar, desconectar, renovar, `tokenDaLoja(lojaId)` (decifra na hora, renova se vence em menos de 30 dias).
- `GET /retaguarda/mercadopago` (DONO; ADMIN com `X-Loja`) → `{ conectada, situacao, mpUserId (mascarado), conectadaEm, expiraEm, pagamentoOnlineAtivo }`.
- `POST /retaguarda/mercadopago/conectar` → `{ url }` com `state` aleatório, guardado só como hash, de uso único, válido por 10 min, ligado à loja, ao usuário e à origem de onde veio (só hosts permitidos).
- `GET /mercadopago/oauth/retorno?code&state` (pública, fora do `/retaguarda`, `no-store`): confere o `state`, troca o código, grava cifrado, redireciona para `/admin/` na origem guardada com `?mp=conectada` ou `?mp=erro`.
- `POST /retaguarda/mercadopago/desconectar`: apaga os tokens, `situacao = DESCONECTADA`, desliga `pagamentoOnlineAtivo` (pedidos já aprovados não são afetados; Pix pendente da loja: ver pergunta 17).
- `PUT /retaguarda/mercadopago/ativo { ativo }`: liga/desliga o pagamento online da loja (só com conta ativa).
- Rotina diária de renovação (`iniciarRenovacaoDiaria` no `server.js`, timer `unref`, como as outras): renova o que vence em menos de 30 dias; falha marca `RENOVACAO_FALHOU` e desliga o pagamento online da loja (o app deixa de oferecer).
- Plataforma (ADMIN): `GET /plataforma/lojas` ganha o estado da conexão e o `modoEntrega`; `PATCH /plataforma/lojas/:id` aceita `modoEntrega` (pergunta 2).

Retaguarda:
- `TelaPerfil.jsx` (ou tela nova "Pagamento online", conforme a pergunta 18): cartão com o estado, "Conectar Mercado Pago", "Desconectar" com confirmação e o interruptor "Aceitar pagamento online no app".
- `TelaLojas.jsx` (ADMIN): modo de entrega e estado da conexão.
- `retaguarda/src/lib/mercadoPago.js` (lógica pura da tela, testada).

Testes: `api/test/mercadopago-oauth.test.js` com `fetch` falso (state reutilizado, vencido, de outra loja; código recusado; renovação; falha de renovação desliga; token nunca aparece em resposta nem em log; DONO de outra loja = 403); retaguarda `test/mercadoPago.test.js`.

Commits previstos:
- `feat(api): cliente HTTP do Mercado Pago (OAuth)`
- `feat(api): conectar, desconectar e renovar a conta Mercado Pago da loja`
- `feat(api): modo de entrega e conexão na plataforma`
- `feat(retaguarda): conectar a conta Mercado Pago e ligar o pagamento online`
- `docs: passo a passo do aplicativo no Mercado Pago (app/CONFIGURACAO_PAGAMENTO.md)`

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
4. **Desconto da plataforma**: neste lote só entra o **frete grátis na primeira compra** (um por telefone, só em loja com entregador da plataforma, bancado pelo dono da plataforma). Não criar cupom nem desconto em produto. O livro-razão deixa o tipo "crédito da loja" preparado, sem uso por enquanto.
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
16. **Frete grátis da loja**: quem banca é o dono da plataforma. Em loja com entregador da plataforma, a taxa continua sendo da plataforma: no pagamento online ela sai da parte da loja no split; em dinheiro, a loja deve a taxa no fechamento.
    - **Pendente de confirmação**: "quem banca é a plataforma" e "a taxa sai da parte da loja / a loja deve a taxa" parecem dizer coisas opostas, e a regra fixa da seção 2 diz que, com frete grátis, a comissão enviada é zero. Leitura provável: o frete grátis configurado **pela loja** é custo da loja (comissão = taxa cheia, cliente não paga a taxa); o frete grátis da **campanha** (primeira compra, decisão 4) é custo da plataforma (comissão zero). Confirmar antes da etapa 2.
17. **Desconectar com Pix pendente**: cancelar os Pix pendentes no Mercado Pago e os pedidos aguardando pagamento, e avisar antes de confirmar a desconexão.
18. **Retaguarda**: tela nova "Pagamento online".
19. **Relatório e caixa**: separar "pago online" das formas pagas na entrega.
20. **Política de privacidade**: rascunho na etapa 4, marcado como pendente de revisão jurídica.
21. **Pix expirado no app**: o cliente refaz o pedido, com a sacola guardada.
22. **"Recebi o dinheiro"**: é o próprio "Finalizar" do PDV com outro nome nos pedidos em dinheiro com entregador da plataforma.

Outros: o `app/assets/brand/logo.jpg` fora do git fica como está.
