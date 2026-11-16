# Cabana Boemia — Sistema de pedidos

Restaurante Cabana Boemia (Abatiá-PR). Monorepo npm workspaces `restaurante`: `api`, `pdv`, `retaguarda`, `site`, `shared`. Single-tenant. Nada deve ser copiado de outros projetos.

## Stack
- Node 24, Express 4, PostgreSQL + Prisma 5, Socket.IO, React + Vite, Electron, node:test.
- Camadas da API: routes → controllers → services → repositories.

## Convenções
- Dinheiro sempre em centavos (Int). Peso em gramas (Int).
- Datas em UTC no banco, exibidas em America/Sao_Paulo.

## Partes
- **SITE**: o cliente faz o pedido.
- **PDV (Electron)**: atendente; salão e delivery do WhatsApp.
- **RETAGUARDA (web)**: dono.
- **API**: hospedada no Railway.

## Turnos
- "Almoço": marmitas P/M/G, prato por kg no salão, bebidas.
- "Lanches": lanches, pizzas, porções, bebidas.
- Cada turno tem horários por dia da semana. O site só aceita pedidos do turno ativo.
- Com a loja fechada, `GET /publico/cardapio` devolve `aberto: false` e uma **prévia** do cardápio do turno da próxima abertura: produtos ativos, `vendidoNoSite` e de categoria ativa, **sem** filtrar `disponivelHoje` nem saldo (valem só para o dia corrente). O site mostra a prévia com os botões desabilitados. Sem próxima abertura (nenhum horário cadastrado), `categorias: []`.
- Turno ativo (`services/turno.service.js`): calculado no horário local America/Sao_Paulo; cada horário é `[inicio, fim)`; `fim <= inicio` cruza a meia-noite (`"00:00"` = fim do dia, então domingo 00:00 vindo de sábado 19:00–00:00 está fechado).

## Cardápio do dia
- O dono escolhe quais produtos estão disponíveis hoje e edita a descrição da marmita.
- `disponivelHoje` **não reseta sozinho** (nada o desliga na virada do dia): o dono desliga o que acabou e liga de volta quando quiser. Produtos nascem com `disponivelHoje = true` no seed.

## Estoque
- Bebidas têm estoque próprio; lanches consomem insumos (pão de lanche, pão de cachorro-quente) via `ProdutoInsumo`.
- A baixa acontece no LANÇAMENTO do item (comanda, delivery ou confirmação do site), nunca na finalização.
- Cancelar item ou pedido devolve o estoque.
- A baixa é atômica (decremento condicionado a saldo suficiente).
- Produto sem saldo some do site automaticamente.
- **Saldo oficial = campo `estoque`** de `Produto` e `Insumo`, alterado só por decremento/incremento atômico (`updateMany` com `estoque >= qtd` no `where` para baixa).
- `MovimentacaoEstoque` é só histórico/auditoria (quantidade = delta com sinal). **Nunca** usar para calcular saldo.

## Banco (decisões do schema)
- IDs `Int` autoincrement.
- `Pedido.dataRef` (`@db.Date`) é o dia local em America/Sao_Paulo, não o dia UTC; `@@unique([dataRef, numeroDia])`.
- `Pedido.tempoEstimadoMin` grava o tempo mostrado ao cliente na criação do pedido.
- `Produto.nome` é único (chave do upsert do seed).
- `Produto.precoCentavos` é obrigatório; em `POR_KG` é o preço do quilo. Marmitas entram no seed com preço 0 e `ativo = false`.
- `Produto.vendidoNoSite` (default `true`): rotas públicas do site (ex.: `GET /publico/cardapio`) **filtram `vendidoNoSite = true`**; o PDV mostra todos. "Prato por kg" (categoria "Pratos", `POR_KG`, turno Almoço) é `vendidoNoSite = false`.

## Seed (`npm run seed -w api` / `prisma db seed`)
- Fonte: `api/prisma/cardapio-cabana-boemia.json` + "Prato por kg". Idempotente, upsert por nome.
- Só cria o que falta. Em registro existente atualiza apenas a estrutura (categoria/ordem) e acrescenta vínculos `ProdutoTurno`/`ProdutoInsumo` ausentes.
- **Nunca sobrescreve** o que o dono edita: preço, `ativo`, `disponivelHoje`, descrição, estoque, horários de turno, `Configuracao`.
- Produto novo é criado com `disponivelHoje = true`. Em produto existente o valor nunca é tocado (se o dono desligou, continua desligado).
- Teste do seed usa banco próprio (`DATABASE_URL_TEST`, nome com "test"), que é resetado a cada execução.
- `HorarioTurno.fim = "00:00"` significa meia-noite (fim do dia).
- `Configuracao` tem linha única (`id = 1`).
- `Cliente.nomeBusca` (obrigatório, **sem default** no banco): nome sem acento, minúsculo e com espaços simples (`paraBusca` em `src/lib/texto.js`: NFD + remove marcas). **Sem extensão do banco** (nada de `unaccent`, decisão do dono). Calculado por uma extensão do client Prisma em `src/lib/prisma.js` sempre que `nome` é gravado (`create`, `update`, `updateMany`, `upsert`, `createMany`, também em `$transaction`): site, PDV, scripts e testes ficam cobertos sem lembrar do campo. Quem usar outro `PrismaClient` (ex.: `prisma/seed.js`) não tem a extensão e não pode gravar `Cliente`. A migration `cliente_nome_busca` preencheu os existentes com a mesma regra em SQL puro (`translate` + `lower` + espaços); um teste roda esse UPDATE e compara com `paraBusca`.
- Regras sem suporte no schema Prisma, garantidas no service: um só `Endereco.principal` por cliente; `diaSemana` entre 0 e 6.

## Pedido
- Canal: `SITE` | `WHATSAPP` | `SALAO`.
- Observação por item.
- Forma de pagamento: `PIX` | `DINHEIRO` | `DEBITO` | `CREDITO`; troco para quanto.
- Taxa de entrega por bairro.
- Número do pedido reinicia por dia.

## Site
- Cardápio visível sem login; login com Google na finalização.
- No primeiro login, telefone obrigatório num passo dentro do checkout.
- Endereço e telefone pré-preenchidos depois, sempre confirmados.
- Botão "repetir último pedido".
- Tempo estimado de entrega exibido.
- Cancelamento só pelo WhatsApp (link wa.me com mensagem pronta contendo número do pedido e nome).
- Código (`site/`): React 18 + Vite 5, mobile first, sem biblioteca de estado/UI. `npm run dev -w site` (porta 5173; o Vite repassa `/publico` para `http://localhost:3000`). Em produção, `VITE_API_URL` aponta para a API.
- Cores do CLAUDE.md em `src/estilos/tokens.css` (`--cor-*`). `NomeRestaurante` mostra a logo (`alt="Cabana Boemia"`, até 72 px de altura no celular, 96 px a partir de 700 px); se a imagem falhar, cai no nome em Dancing Script (`@fontsource`), único uso de fonte cursiva. A logo também é o favicon (`src/lib/logo.js`, importada de `shared/assets` para o Vite servir no dev e empacotar com hash no build).
- Carrinho (`src/carrinho/carrinho.js`, lógica pura testada com `node:test`): mesmo produto + mesma observação soma na mesma linha; observação diferente vira outra linha. Salvo em `localStorage` (`cabana-boemia:carrinho:v1`) com try/catch; dado corrompido vira carrinho vazio.
- Cardápio atualiza a cada 30 s (com a aba visível) e ao voltar para a aba. Só respostas bem-sucedidas conciliam o carrinho: remove o que sumiu, atualiza preço e avisa o cliente. Falha de rede mantém o último cardápio.

## Criação de pedido (`services/pedido.service.js`)
- `criarPedido({ canal, itens, cliente, endereco, pagamento, usuarioId, mesaRotulo, chaveIdempotencia, agora })` serve SITE, WHATSAPP e SALAO. Uma `prisma.$transaction` (READ COMMITTED, `maxWait` 10 s, `timeout` 15 s) faz, nesta ordem:
  1. turno ativo (409 `LOJA_FECHADA`) — **só no SITE**. WHATSAPP e SALAO não são bloqueados por horário nem por turno (a equipe lança fora do horário, ex.: cliente do salão que continua comendo depois do fim do turno);
  2. produtos revalidados (409 `PRODUTO_INDISPONIVEL`): todos os canais exigem produto e categoria ativos; só o SITE exige também `disponivelHoje`, produto do turno ativo e `vendidoNoSite`. Saldo vale para todos (passo 5);
  3. bairro ativo (taxa do banco);
  4. preços/totais **só do banco** (UNIDADE = preço × qtd; POR_KG = round(preço × g / 1000)). No SITE, o corpo traz `totalEsperadoCentavos` (o total que o cliente viu); se o recalculado for diferente → 409 `PRECO_ALTERADO` com `detalhes { subtotalCentavos, taxaEntregaCentavos, totalCentavos, itens: [{ produtoId, nome, precoUnitarioCentavos }] }`, **antes de baixar estoque**. Depois, pagamento conferido contra o total do servidor;
  5. baixa atômica (`updateMany` com `estoque >= qtd`), quantidades somadas por produto/insumo e **travadas em ordem de id** (produtos, depois insumos) para não haver deadlock; `count = 0` → 409 `ESTOQUE_INSUFICIENTE` com o nome do produto (e do insumo);
  6. `numeroDia` por `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` em `ContadorPedido` (dia local; volta junto no rollback, sem buraco);
  7. pedido com snapshots (nome, preço, endereço, bairro, `tempoEstimadoMin`), itens, `MovimentacaoEstoque` VENDA por item (delta negativo) e `TrabalhoImpressao` PEDIDO/PENDENTE.
- Status inicial: SITE e WHATSAPP `CONFIRMADO`, SALAO `ABERTO`. Forma de pagamento obrigatória fora do SALAO. Troco só em DINHEIRO e **maior** que o total (senão 400 `TROCO_INVALIDO`).
- `chaveIdempotencia` (UUID, única em `Pedido`): reenvio devolve o mesmo pedido (200) sem baixar de novo; chave de outro cliente = 409 `CHAVE_EM_USO`.
- Banco: `CHECK (estoque >= 0)` em `Produto` e `Insumo` (migration `pedidos`) como defesa extra.
- Eventos `pedido:novo` e `impressao:nova` só **depois do commit**, via `lib/eventos.js` → Socket.IO (`lib/tempoReal.js`) na sala `equipe`. Socket exige access token da equipe em `auth.token` (token de cliente é recusado). Cada socket também entra na sala `usuario:<id>`: desativar o usuário emite o evento interno `usuario:desativado` (depois do commit) e derruba na hora todos os sockets dele; a reconexão é recusada porque o middleware lê o usuário do banco.
- Site: `POST /cliente/pedidos` (exige telefone; corpo só `{ itens: [{ produtoId, quantidade, observacao }], enderecoId, formaPagamento, totalEsperadoCentavos, trocoParaCentavos?, chaveIdempotencia? }`; nome/telefone vêm do cadastro, endereço precisa ser do cliente, 422 `ENDERECO_INVALIDO`). `GET /cliente/pedidos/ultimo` → `{ pedido | null }`.
- Checkout do site: confirmar dados (um toque) → pagamento/troco/resumo com taxa → enviar → tela de sucesso (nº, previsão, link wa.me de cancelamento). Em 409 `PRECO_ALTERADO` o site aplica os preços novos ao carrinho (e a taxa, se mudou), mostra o que mudou **dentro da gaveta** (avisos flutuantes ficam atrás do `<dialog>`) e pede para tocar em "Enviar pedido" de novo; a mesma chave de idempotência é reaproveitada (nada foi criado).
- Recarga forçada do cardápio (após erro de cardápio/preço, ou "Tentar de novo") usa `fetch(..., { cache: 'no-cache' })`: com o `max-age=15` da API, o cache do navegador devolveria o preço antigo e a conciliação desfaria o preço novo. "Repetir último pedido" só põe no carrinho o que está no cardápio agora, com o preço de agora.

## Tempo estimado
- Só manual. A atendente digita no PDV; se não digitar, vale o padrão configurado na retaguarda.
- `tempoEstimadoManualMin` só vale no dia local em que foi definido (`tempoManualDefinidoEm`); nos outros dias vale `tempoEstimadoPadraoMin`.

## PDV
- Executável Electron que abre com o Windows; botão de login.
- Tela com Salão e Delivery (ícone de bicicleta).
- Pedidos do site e do delivery caem na mesma fila em tempo real.
- Código (`pdv/`): electron-vite 4 (Vite 5) + electron-builder (NSIS), Electron 45, React 18 sem biblioteca de estado/UI. `npm run dev -w pdv` (renderer com HMR; API padrão `http://localhost:3000`), `npm run build -w pdv` (→ `out/`), `npm run dist -w pdv` (instalador em `pdv/dist`).
- **Rede e tokens só no main** (`src/main/`): `clienteApi.js` (HTTP), `tempoReal.js` (socket.io-client), `armazemRefresh.js`, `config.js`, `ipc.js`. O renderer não tem Node nem token e não fala com a API; usa só `window.pdv` (preload com `contextBridge`). Janela com `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP `'self'`, navegação e popups bloqueados, IPC só aceito da própria janela. Preload sai em `.cjs` (sandbox exige CommonJS; o pacote é `"type": "module"`).
- IPC devolve `{ ok, dados } | { ok: false, erro: { mensagem, codigo, status } }`; o main valida argumentos e só chama rotas fixas. Eventos main → renderer (lista branca no preload): `pedido:novo`, `pedido:atualizado`, `socket:status` (`conectado` | `reconectando` | `desligado`), `sessao:expirou`.
- Sessão: access token só na memória do main; refresh cifrado com `safeStorage` assíncrono (DPAPI) em `userData/sessao.bin`; sem cifragem disponível fica só na memória (nunca texto puro). Renovação **single-flight** (a API trata reuso de refresh como roubo), 60 s antes de vencer; 401 numa requisição renova e repete uma vez; refresh recusado apaga a sessão e manda `sessao:expirou`. Sem rede mantém o refresh.
- Socket: `auth` é função (pega access válido a cada tentativa). Recusa do middleware ou `io server disconnect` não reconectam sozinhas: o main renova a sessão e reconecta; se a renovação der 401, cai no login. A fila recarrega a cada (re)conexão e a cada 5 min (eventos perdidos, virada do dia).
- `userData/config.json` guarda `apiUrl`. Padrão: `http://localhost:3000` em dev; no app instalado não há padrão e a primeira tela pede a URL (domínio do Railway ainda não existe). Trocar de servidor só deslogado.
- Abrir com o Windows: `setLoginItemSettings({ openAtLogin: true })` só no app instalado (em dev registraria o `electron.exe`). Instância única.
- Alerta sonoro (Web Audio, sem arquivo) só para `pedido:novo` do **SITE**; `autoplayPolicy: 'no-user-gesture-required'` faz tocar sem clique. A fila continua montada (e tocando) na aba Salão.
- Campo "Tempo estimado (min)": mostra o manual de hoje (placeholder = padrão), grava no blur/Enter, Esc desfaz, vazio volta ao padrão, inteiros 1–240.
- Finalizar abre a escolha da forma (pré-selecionada com a do pedido); a escolhida sobrescreve. 409 `PEDIDO_ENCERRADO` (outra atendente finalizou) tira o pedido da fila.
- Cancelar (cartão da fila, com confirmação) vale para site e WhatsApp abertos.
- **Novo delivery do WhatsApp** (`componentes/delivery/`, F2 de qualquer lugar da tela principal; Esc volta um passo, e no passo 1 fecha cadastro/endereço e depois volta à fila; o Esc do campo de tempo não conta). A fila continua montada (e tocando) durante o lançamento.
  1. Cliente: busca com autocomplete (↑ ↓ Enter, 250 ms de espera, resposta atrasada descartada) ou cadastro rápido (pré-preenche telefone se a busca for só dígitos/formatação, senão o nome); 409 `CLIENTE_JA_EXISTE` oferece "Usar <nome>". Escolhido o cliente, telefone e endereços aparecem para confirmar (bairro inativo desabilitado; "+ Outro endereço").
  2. Itens: abas de turno (padrão: ativo; fechado: próxima abertura) e de categoria; botões grandes; **esgotado desabilitado**; saldo todo no carrinho também desabilita; "restam N" até 5; "fora de hoje" só avisa. Toque soma na linha sem observação; observação por linha, e linhas iguais se juntam ao sair do campo. Cardápio recarregado ao entrar no passo (troca de turno não tira itens do carrinho: produto que saiu é recusado pela API com o nome).
  3. Pagamento: resumo, taxa do bairro, total, 4 formas, troco opcional só em dinheiro (> total, mostra quanto levar). Confirmar manda `chaveIdempotencia` (UUID fixo do lançamento; duplo clique ou reenvio não duplica). Erro de estoque/produto recarrega a grade. Sucesso volta à fila com "Pedido #N lançado".
  - Lógica pura em `renderer/src/lib/lancamento.js` (testada). Totais no PDV são só para mostrar; o oficial é o da API.
- IPC repassa `detalhes` do erro da API. `pedidos:criar`, `clientes:criar` e `clientes:adicionarEndereco` montam o corpo só com os campos aceitos (o renderer não injeta preço nem outros campos).
- Rodando a partir do Claude Code no VS Code, o ambiente traz `ELECTRON_RUN_AS_NODE=1` (o Electron sobe como Node e quebra): usar `env -u ELECTRON_RUN_AS_NODE`.
- Ícone do instalador: pendente a versão quadrada da logo; até lá, ícone padrão do Electron.

## Rotas da equipe (`/equipe`, DONO e ATENDENTE, `Cache-Control: no-store`)
- `GET /equipe/pedidos?dataRef=hoje|AAAA-MM-DD&canal=SITE,WHATSAPP&status=abertos|todos`: pedidos do dia local, ordenados por `numeroDia`. Padrão: hoje, todos os canais, só abertos (`ABERTO`/`CONFIRMADO`).
- `PATCH /equipe/pedidos/:id/finalizar { formaPagamento }`: obrigatória (400 `VALIDACAO`); exige caixa aberto (409 `CAIXA_FECHADO`) e grava `caixaId` (ver "Caixa"). Update condicionado ao status aberto (duas atendentes ao mesmo tempo: uma vence, a outra leva 409 `PEDIDO_ENCERRADO`); 404 se não existe. A forma **sobrescreve** a do cliente; troco só fica em `DINHEIRO`. Grava `finalizadoEm` e emite `pedido:atualizado` para a sala `equipe`.
- `GET/PUT /equipe/config/tempo-estimado { minutos }`: inteiro 1–240 grava `tempoEstimadoManualMin` + `tempoManualDefinidoEm`; `null`/`""`/ausente limpa os dois (volta ao padrão). Resposta `{ padraoMin, manualMin (só se definido hoje), vigenteMin }`.
- `GET /equipe/clientes?busca=` (2–60 caracteres): nome contém, **sem acento e sem diferenciar maiúsculas** ("joao" acha "João"; compara `paraBusca(busca)` com `Cliente.nomeBusca`), ou trecho do telefone (≥ 3 dígitos). Até 10, com endereços (principal primeiro) e bairro com taxa/ativo. Inclui clientes do site.
- `POST /equipe/clientes { nome, telefone, endereco }`: cliente sem `googleId` + endereço principal numa transação. Telefone normalizado (mesmo schema do site). Telefone já cadastrado = 409 `CLIENTE_JA_EXISTE` com `detalhes.cliente`; bairro inativo = 422 `BAIRRO_INVALIDO`.
- `POST /equipe/clientes/:id/enderecos`: endereço novo vira o principal (reusa `endereco.service.criar`: limite de 10, bairro ativo).
- `GET /equipe/cardapio?turnoId=`: grade do PDV. Turno: o pedido, senão o ativo, senão o da próxima abertura, senão o primeiro. Produtos ativos, de categoria ativa, **só `UNIDADE`** (por kg é do salão), sem filtrar `vendidoNoSite`. Cada um com `esgotado` (mesma regra `temSaldo` do site), `saldo` (unidades possíveis pelo estoque próprio e pelos insumos; `null` = sem controle) e `disponivelHoje` (só aviso).
- `POST /equipe/pedidos { clienteId, enderecoId, itens, formaPagamento, trocoParaCentavos?, chaveIdempotencia? }`: canal WHATSAPP via `pedidoService.criarPedidoDoWhatsapp` → **o mesmo `criarPedido`** (sem duplicar regra de estoque/preço). Endereço precisa ser do cliente (422 `ENDERECO_INVALIDO`); cliente inexistente = 422 `CLIENTE_INVALIDO`; `criadoPorId` = usuário logado. 201 criado, 200 reenvio da mesma chave.
- `PATCH /equipe/pedidos/:id/cancelar` (`pedidoService.cancelarPedido`): uma transação faz UPDATE condicionado ao status aberto (já cancelado/finalizado = 409 `PEDIDO_ENCERRADO`; concorrentes: só um vence), devolve **exatamente as movimentações VENDA** dos itens não cancelados do pedido (não a receita atual, que pode ter mudado), somadas e em ordem de id (produtos, depois insumos, como a baixa), grava uma `MovimentacaoEstoque` ESTORNO por VENDA (delta oposto, `usuarioId` de quem cancelou), marca `canceladoEm` e cria `TrabalhoImpressao` CANCELAMENTO/PENDENTE. Itens continuam no pedido (para o cupom). Depois do commit: `pedido:atualizado` e `impressao:nova`. Futuro cancelamento de item deve marcar `ItemPedido.canceladoEm` e estornar o item (o cancelamento do pedido já ignora itens cancelados).
- `STATUS_ABERTOS` (`ABERTO`, `CONFIRMADO`) mora em `pedido.service`. Schemas zod compartilhados site/equipe em `controllers/esquemas.js`.

## Salão (comandas)
- Comanda = `Pedido` canal `SALAO`, status `ABERTO` enquanto o cliente come, com o **nome do cliente** (`nomeCliente`) e mesa opcional. Recebe itens aos poucos; cada item **baixa o estoque no lançamento** (mesma regra atômica), remover devolve, fechar não mexe no estoque.
- API (`services/comanda.service.js`, rotas em `/equipe`):
  - `GET /comandas`: todas as abertas do salão, **de qualquer dia** (cliente que fica depois da meia-noite continua na grade), da mais antiga para a mais nova. `GET /comandas/:id` (pedido que não é do salão = 404).
  - `POST /comandas { nomeCliente (1–60), mesaRotulo? (até 10) }`: 201, sem itens, total 0, com `numeroDia` (mesmo contador do delivery). **Não imprime.** Emite `pedido:novo`.
  - `POST /comandas/:id/itens { produtoId, quantidade? (1–20, padrão 1), pesoGramas? (1–5000), observacao? }`: 201 com a comanda inteira. Revalida produto (ativo/categoria ativa, como os canais da equipe), preço só do banco (`POR_KG` = round(preço do quilo × g / 1000); sem peso = 400 `PESO_OBRIGATORIO`; peso em produto por unidade = 400), baixa com `baixarEstoque`, grava com `gravarItens` (VENDA por item) e recalcula subtotal/total (soma dos itens não cancelados).
  - `DELETE /comandas/:id/itens/:itemId`: marca `ItemPedido.canceladoEm` e devolve **exatamente as VENDA daquele item** (`estornarVendas`, ESTORNO por VENDA); já removido = 409 `ITEM_JA_REMOVIDO`; item de outra comanda = 404.
  - `POST /comandas/:id/fechar { formaPagamento, imprimirConta? }`: forma obrigatória (400 `VALIDACAO`); exige caixa aberto (409 `CAIXA_FECHADO`); → `FINALIZADO` + `finalizadoEm` + `caixaId`; `TrabalhoImpressao` `CONTA` **só com `imprimirConta: true`**. Sem itens = 409 `COMANDA_VAZIA`.
  - Comanda fechada/cancelada: lançar, remover e fechar = 409 `PEDIDO_ENCERRADO`.
  - Concorrência: toda alteração começa com `SELECT ... FOR UPDATE` na linha do pedido (ordem pedido → produtos → insumos, a mesma do cancelamento): fechar espera um lançamento em andamento e vice-versa; nunca entra item em comanda fechada.
  - Eventos depois do commit: `pedido:atualizado` a cada mudança, `impressao:nova` na CONTA.
- Excluir comanda vazia (engano) usa `PATCH /equipe/pedidos/:id/cancelar`; **cancelamento de pedido do salão não cria cupom** de cancelamento (nada dele foi impresso).
- `GET /equipe/cardapio` devolve também `porKg: [{ id, nome, precoCentavos }]` (produtos `POR_KG` ativos do turno) para o botão "Prato por kg". O "Prato por kg" nasce no seed com preço 0 e inativo: **some do PDV até o dono definir o preço do quilo** (o PDV avisa no turno Almoço).
- Cupom `CONTA`: nome da comanda (`Cliente:`), mesa, itens (peso + preço/kg), total e forma de pagamento.
- **Um `ItemPedido` por toque no banco** (remover/estornar item a item); a **exibição agrupa** (tela da comanda e cupom `CONTA`): mesmo produto, mesmo preço, sem observação e sem peso viram uma linha ("4x Refrigerante Lata"), na ordem do primeiro lançamento. Função pura `agruparItens` em `shared/src/itens.js` (`@restaurante/shared/itens`, testada). Na tela, o × da linha agrupada remove **uma unidade por vez** (o item mais recente da linha, `idParaRemover`), com confirmação.
- PDV (`componentes/salao/`, lógica pura em `renderer/src/lib/salao.js`, testada): aba Salão = grade de cartões (nome, mesa, total parcial, nº de itens, tempo aberta, atualiza a cada 30 s), busca pelo nome ou mesa **sem acento** (filtro local; Enter com um resultado abre; abrir limpa a busca), "+ Nova comanda" (pré-preenche com a busca). Dentro da comanda: botão grande "Prato por kg" → teclado numérico de gramas (toque ou teclado físico, Enter lança, Esc fecha, prévia do valor), abas de turno/categoria com os produtos (esgotado desabilitado, "restam N"), cada toque lança 1 na hora (lançamentos **em fila, um por vez**, para a tela mostrar sempre o estado mais novo), lista de itens com remover (confirmação), "Fechar conta" (forma + "Imprimir conta" desmarcado por padrão) ou "Excluir comanda vazia". Esc volta para a grade. Segue `pedido:novo`/`pedido:atualizado` e recarrega ao (re)conectar e a cada 5 min.
- IPC: `comandas:listar|obter|abrir|lancarItem|removerItem|fechar`, corpo montado só com os campos aceitos (`comandaParaApi`, `itemComandaParaApi`, `fechamentoParaApi`).
- Fora do escopo: integração com balança, divisão de conta.

## Caixa
- Um caixa do balcão para todo o dinheiro (salão, delivery, site). `Caixa` (abertura: quem, quando, `valorInicialCentavos`; fechamento: quem, quando, `valorContadoCentavos`, `esperadoCentavos`, `diferencaCentavos`, `observacao`) e `MovimentoCaixa` (`SANGRIA` | `SUPRIMENTO`, valor > 0, motivo, usuário).
- **Só um caixa aberto**: índice único parcial `Caixa_um_aberto` (`WHERE "fechadoEm" IS NULL`), só na migration `caixa` (o Prisma não declara índice parcial). CHECKs: valor inicial/contado ≥ 0, movimento > 0, fechamento tudo-ou-nada (todos os campos de fechamento nulos ou todos preenchidos), `TrabalhoImpressao` com exatamente um dono (`pedidoId` XOR `caixaId`). Relações novas com `onDelete: Restrict`.
- `Pedido.caixaId` é gravado na **finalização** (não na criação): o pedido entra no caixa em que é finalizado, com a forma de pagamento da finalização. Finalizar delivery/site (`PATCH /equipe/pedidos/:id/finalizar`) e fechar comanda exigem caixa aberto: **409 `CAIXA_FECHADO`**. Criar pedido (site, WhatsApp, comanda) e lançar item **não** exigem caixa (decisão do dono: o site aceita pedidos com o caixa fechado).
- **Esperado em dinheiro** = `valorInicial` + Σ `totalCentavos` dos pedidos `FINALIZADO` em `DINHEIRO` com esse `caixaId` + Σ suprimentos − Σ sangrias. Diferença = contado − esperado (negativa = faltou). Usa o total, não o "troco para" (o troco sai da mesma gaveta). Calculados e **gravados no fechamento** (não mudam depois).
- **Fechamento cego**: `/equipe` nunca devolve esperado nem diferença (nem para o DONO, nem no socket, nem no cupom); só `/retaguarda/caixas` (DONO).
- Concorrência (`services/caixa.service.js`): finalizar pedido, fechar comanda e lançar movimento começam com `SELECT … FROM "Caixa" WHERE "fechadoEm" IS NULL FOR SHARE` (ordem de travas: caixa → pedido); fechar o caixa usa `FOR UPDATE` na mesma linha e espera essas transações. Assim nenhuma venda em dinheiro entra depois do cálculo, e nenhuma finalização fica sem caixa (se o fechamento vencer, o `WHERE` é reavaliado e dá `CAIXA_FECHADO`).
- Rotas da equipe: `GET /equipe/caixa/atual` (`{ caixa | null }`), `POST /equipe/caixa/abrir { valorInicialCentavos }` (201; já aberto = 409 `CAIXA_JA_ABERTO`, inclusive na corrida, pelo P2002 do índice), `POST /equipe/caixa/movimentos { tipo, valorCentavos, motivo }` (201; sangria maior que a gaveta é **permitida**, decisão do dono), `POST /equipe/caixa/fechar { valorContadoCentavos, observacao? }`. Valores em centavos inteiros até R$ 100.000,00. Eventos `caixa:atualizado` (`{ caixa | null }`, sem esperado) depois do commit.
- Fechar com pedido aberto de **qualquer dia** (comanda `ABERTO`, delivery/site `ABERTO`/`CONFIRMADO`) = **409 `PEDIDOS_ABERTOS`** com `detalhes.pedidos: [{ id, numeroDia, canal, status, nomeCliente, mesaRotulo, totalCentavos, formaPagamento, quantidadeItens, criadoEm }]`. Fechado: cria `TrabalhoImpressao` `FECHAMENTO` (`caixaId`, sem pedido).
- Retaguarda (`/retaguarda`, só DONO, `no-store`): `GET /retaguarda/caixas?data=hoje|AAAA-MM-DD` → caixas **abertos** naquele dia local, com movimentos, `vendasDinheiroCentavos`, suprimentos, sangrias, esperado (calculado na hora se ainda aberto), contado, diferença e `totaisPorForma: [{ forma, quantidade, totalCentavos }]`.
- Cupom `FECHAMENTO` (`shared/src/cupom.js`): abertura/fechamento (quem, quando), fundo de troco, suprimentos e sangrias (hora + motivo), vendas por forma (Dinheiro primeiro) e total vendido, **dinheiro contado**, observação. **Nunca** esperado nem diferença (sai depois que o contado foi gravado, então os totais por forma não revelam nada a tempo — decisão do dono). A fila de impressão manda `caixa` (resumo) no lugar de `pedido`; o agente nomeia o documento `caixa-<id>_fechamento_trabalho-<id>`.
- PDV (`componentes/caixa/`, lógica pura em `renderer/src/lib/caixa.js`, testada): sem caixa aberto, a tela principal mostra **"Abrir caixa"** (valor inicial) no lugar do conteúdo; a fila continua montada por trás (o alerta do site segue tocando). Botão **Caixa** na barra (verde; laranja piscando "Caixa de outro dia" se esquecido aberto de um dia anterior) abre o painel: Sangria, Suprimento (valor + motivo, lista dos movimentos) e Fechar caixa (só o valor contado + observação). No 409 `PEDIDOS_ABERTOS` o painel lista cada pedido com **atalhos**: Finalizar (forma pré-selecionada) ou Fechar conta (comanda, sem imprimir conta), e Cancelar/Excluir (comanda vazia só exclui). Resolvidos saem da lista. Fechado: volta para "Abrir caixa" com o aviso "resumo enviado para a impressora". `chamar` dispara `pdv:caixa-fechado` em qualquer 409 `CAIXA_FECHADO` e a tela recarrega o caixa; também recarrega a cada (re)conexão e no evento `caixa:atualizado`.
- IPC: `caixa:atual|abrir|movimento|fechar` (`aberturaCaixaParaApi`, `movimentoCaixaParaApi`, `fechamentoCaixaParaApi`: o renderer nunca manda esperado).
- Fora do escopo: conferência de cartão com a maquininha, vários caixas simultâneos.

## Impressão
- Térmica USB 80mm/58mm no computador do balcão, via agente embutido no Electron.
- Fila de `TrabalhoImpressao` no servidor.
- O agente só marca impresso após a impressora confirmar.
- Heartbeat + reconexão; ao reconectar busca tudo pendente; nunca imprime duas vezes.
- Biblioteca (escolhida pelo dono): `@point-of-sale/receipt-printer-encoder` (MIT) só monta os bytes ESC/POS; o envio é RAW pelo spooler do Windows (`winspool.drv` via `koffi` 3, MIT, binário pré-compilado, roda no Electron sem rebuild). Nada de libusb/Zadig: a impressora continua instalada com o driver.
- API (`/equipe`, `services/impressao.service.js`): `GET /impressoes/pendentes` → `{ restaurante: { nome }, limite: 50, trabalhos }` (só `PENDENTE`, ordem de id, com o pedido público; janela = início do dia local ou 2 h atrás, o que vier antes, para não despejar cupons antigos). `POST /impressoes/:id/confirmar` é idempotente (UPDATE condicionado; repetir devolve `jaConfirmado: true` sem mudar `impressoEm`). `POST /impressoes/:id/falha { erro? }` incrementa `tentativas` e grava `ultimoErro`, continua `PENDENTE` (já impresso = 409 `TRABALHO_IMPRESSO`). `POST /pedidos/:id/reimprimir` cria um trabalho NOVO (cancelado → `CANCELAMENTO`) e emite `impressao:nova`. `FALHOU` do enum não é usado.
- Agente (`pdv/src/main/agente-impressao/`): `fila.js` (fila local por id + `impressos` da sessão = segunda trava), `conexao.js` (ping `GET /health` a cada 5 s; sem resposta, offline e backoff 2, 4, 8… até 60 s; ao voltar sincroniza), `formatacao.js` (linhas → ESC/POS), `impressoras.js` (Windows e `.txt`), `winspool.js` (koffi), `agente.js` (orquestra), `configuracao.js`. Sincroniza em `impressao:nova`, reconexão do socket, volta do heartbeat e varredura de 30 s. Um ciclo por vez, em ordem; só confirma depois que a impressora aceitou; em erro chama `/falha`, para (mantém a ordem) e tenta de novo (5 s… 60 s). Sem rede depois de imprimir, guarda para confirmar depois e não reimprime.
- "Impressora aceitou" = o trabalho saiu da fila do Windows sem erro (ou `PRINTED`/`COMPLETE`). Erro, sem papel ou 30 s parado: o agente **apaga o job do spooler** (senão sairia sozinho depois e duplicaria). "Sem papel" só se o driver informar (`PAPER_OUT`); senão vira "erro" (decisão do dono).
- Config por computador no `config.json` (tela "Impressora", clique no indicador da barra): `modo` (`desligado` padrão | `impressora` | `arquivo` = modo teste `.txt` em `userData/impressoes-teste`), `impressora` (nome no Windows, lista de `getPrintersAsync`), `largura` 48/32 (padrão 48), `tabela` cp860/cp850 (padrão cp860, mapeamento Epson), `guilhotina` (padrão ligada). Só um PDV pode imprimir: dois com impressora configurada imprimiriam cada cupom duas vezes.
- Indicador na barra: OK / sem papel / erro / offline (API ou impressora) / desligada, com "N na fila". Cartão da fila tem "Reimprimir". Botões "Imprimir teste" (cupom com acentos, não passa pela API) e "Tentar agora" no painel.
- `shared/src/cupom.js` (puro, testado com snapshot de texto): `montarCupom(trabalho, { colunas, restaurante })` → linhas `{ texto, negrito?, grande? }` com largura exata (grande = metade das colunas); `cupomParaTexto`. Tipos `PEDIDO`, `CANCELAMENTO` ("PEDIDO CANCELADO" grande, sem pagamento) , `CONTA` (salão, peso, "Não é documento fiscal") e `FECHAMENTO` (resumo do caixa; ver "Caixa"). Observação em negrito em linha própria; texto limpo para Latin-1 (emoji/aspas curvas).
- Instalador (fora do escopo até aqui): o koffi 3 traz o binário em `@koromix/koffi-win32-x64`; o electron-builder precisará incluí-lo (fora do asar).

## Cupom
- Nome do restaurante; número e origem do pedido.
- Cliente (nome, telefone, endereço).
- Itens com observação em destaque.
- Taxa de entrega e total; pagamento e troco; data e hora.

## Acessos
- Papel `DONO` (retaguarda + PDV) e `ATENDENTE` (só PDV).
- O primeiro dono é criado por script; o dono cria os atendentes.

## Autenticação (dono e atendentes)
- Login por email + senha (`bcryptjs`, custo 12). Email sempre normalizado (trim + minúsculo).
- Access token: JWT HS256 (`JWT_SECRET`), 15 min, `{ sub, papel }`, enviado em `Authorization: Bearer`.
- Refresh token: opaco (32 bytes), 30 dias, **rotacionado a cada uso**; no banco só `HMAC-SHA256(token, JWT_REFRESH_SECRET)`. Reuso de refresh já revogado revoga todas as sessões do usuário.
- `autenticar` busca o usuário no banco a cada requisição (papel vem do banco; desativado perde acesso na hora). `exigirPapel('DONO')` para rotas do dono.
- Desativar atendente e trocar senha revogam todos os refresh tokens dele. Desativar também derruba na hora os sockets dele. Rotas `/usuarios` só alteram ATENDENTE.
- `/usuarios` não tem excluir (pedidos ficam vinculados ao usuário; usa-se desativar/reativar) nem editar nome/email por enquanto. Decisão do dono, não é lacuna.
- Access token da equipe leva `aud: "equipe"` (verificado).
- A API **recusa iniciar** (`server.js`, código 1) se `JWT_SECRET`/`JWT_REFRESH_SECRET`/`JWT_CLIENTE_SECRET` estiverem ausentes, com menos de 32 caracteres ou iguais entre si (`problemasNosSegredos` em `lib/tokens.js`).
- Rate limit no login por IP+email, só tentativas com falha contam. `trust proxy = 1` (Railway).
- Refresh trafega no corpo JSON. A retaguarda será servida no mesmo domínio da API (`/admin`), então **cookie httpOnly para o refresh é melhoria futura** (sem CORS/SameSite=None).
- Primeiro dono: `npm run criar-dono -w api -- --nome "..." --email ... --senha ...`.

## Autenticação do cliente (site)
- Google Identity Services no site → ID token → `POST /cliente/auth/google { credential }`. A API valida com `google-auth-library` (assinatura com as chaves do Google, emissor, validade, `aud = GOOGLE_CLIENT_ID`; `lib/google.js`). Sem `GOOGLE_CLIENT_ID` responde 503 (nunca verifica sem audience); token inválido = 401 `TOKEN_GOOGLE_INVALIDO`.
- Upsert do `Cliente` por `googleId` (= `sub`). Novo nasce com nome/email do Google; existente só tem o email atualizado (nome editado pelo cliente não é sobrescrito). Email só é gravado se `email_verified`.
- JWT de cliente: HS256, segredo próprio `JWT_CLIENTE_SECRET`, `aud: "cliente"`, 7 dias, **sem refresh** (re-login é um toque no Google). Token da equipe não vale no cliente e vice-versa (segredo e audience diferentes). `autenticarCliente` busca o cliente no banco a cada requisição.
- Rotas (`Cache-Control: no-store`): `GET/PUT /cliente/me` (nome + telefone, ambos obrigatórios no PUT), `GET/POST /cliente/enderecos`, `PUT/DELETE /cliente/enderecos/:id`. Endereço de outro cliente = 404. Bairro inexistente/inativo = 422 `BAIRRO_INVALIDO`. Primeiro endereço vira principal; apagar o principal promove o mais recente. Máx. 10 endereços.
- Telefone (`shared/src/telefone.js`, usado por API e site): celular com DDD válido + 9 dígitos, aceita formatação/`+55`/`0`, salvo só com números (`43999990000`).
- Pedido do site exige telefone: `exigirTelefoneCliente` (422 `TELEFONE_OBRIGATORIO`) vai na rota de criação de pedido.
- `GET /publico/config` devolve `googleClientId` (público); o site lê dali, sem variável própria.
- Helmet com `crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }` (`app.js`): a API vai servir o site no deploy e o padrão `same-origin` quebra o popup do login Google. Testado em `test/health.test.js`. Quem servir o site (API ou outro host) não pode mandar `same-origin`.
- Site: token em `localStorage` (`cabana-boemia:cliente:v1`); 401 apaga. Checkout dentro da gaveta do carrinho: login → telefone obrigatório → resumo. "Continuar" desabilitado com a loja fechada.

## Variáveis de produção (Railway)
- `api/.env.railway`: todas as variáveis da API em produção, no formato do Raw Editor do Railway. **Não versionado** (`.gitignore` ignora `.env.*`, exceto `.env.example`; conferido com `git check-ignore`). Existe só na máquina do dono.
- Segredos JWT de produção gerados à parte (48 bytes, `base64url`), diferentes dos de dev. `DATABASE_URL="${{Postgres.DATABASE_URL}}"` (referência ao serviço Postgres do Railway), `NODE_ENV="production"`, `BCRYPT_CUSTO="12"`. **Sem `PORT`**: o Railway injeta a porta (o teste trata `PORT` como opcional em produção).
- Preencher antes do deploy: `GOOGLE_CLIENT_ID` e `CORS_ORIGINS` (domínio do Railway com `https://`, sem barra no fim).
- `test/env-railway.test.js` falha se alguma variável lida pelo código (`process.env.X`, `segredo('X')`, `env("X")` do `schema.prisma`) faltar no arquivo, se os segredos forem inválidos ou repetirem os de dev, ou se aparecer `DATABASE_URL_TEST`. Sem o arquivo (clone novo/CI), é pulado. A varredura fica em `test/helpers/variaveis.js`, compartilhada com o teste do `.env.example`.

## Testes
- `npm test` (raiz) roda os arquivos em série (`--test-concurrency=1`), com `test/setup.js` pré-carregado.
- Testes de banco usam `DATABASE_URL_TEST` (nome com "test"), resetado por `prisma migrate reset` a cada arquivo; sem a variável, são pulados.

## Relatório do dia
- Total vendido, por forma de pagamento, por canal, produtos mais vendidos.

## Identidade visual
| Cor | Hex |
|---|---|
| Vermelho | `#C8102E` |
| Vermelho escuro | `#9E0B22` |
| Dourado | `#C9A646` |
| Preto | `#111111` |
| Creme | `#FBF3E8` |
| Laranja | `#D9541E` |

- Logo: `shared/assets/logo-cabana-boemia.jpg` (JPEG 811×344, fundo claro, sem transparência). Fonte única usada pelo **site** (cabeçalho e favicon), pelo **PDV** e pelo **ícone do instalador** do PDV. Não copiar o arquivo para dentro de cada parte: importar de `shared/assets`.

## Status (2026-11-15)
- Feito na API: schema + migration `init`, seed do cardápio, autenticação (dono/atendentes, `/auth`, `/usuarios`), turno ativo, rotas públicas do site (`GET /publico/cardapio`, `/publico/bairros`, `/publico/config`, sem login, `Cache-Control: public, max-age=15`) cliente do site (`/cliente/auth/google`, `/cliente/me`, `/cliente/enderecos`) e pedidos (`POST /cliente/pedidos`, `GET /cliente/pedidos/ultimo`, `criarPedido` para os três canais, Socket.IO da equipe).
- Banco local: PostgreSQL 18, usuário `postgres`. `api/.env` tem `DATABASE_URL` (`restaurante`, migration aplicada e seed rodado), `DATABASE_URL_TEST` (`restaurante_test`) e `JWT_SECRET`/`JWT_REFRESH_SECRET`/`JWT_CLIENTE_SECRET` gerados (64 caracteres, diferentes). `GOOGLE_CLIENT_ID` ainda vazio (login do cliente responde 503 até configurar).
- Banco de dev tem um DONO de teste (`dono.teste@exemplo.com`, id 1), criado por `npm run criar-dono`; login, `/auth/me` e refresh (com rotação e recusa do refresh antigo) conferidos via curl contra a API rodando.
- Testes: API 197/197, PDV 76/76, site 35/35 e shared 24/24 passando, nenhum pulado (`npm test` na raiz roda todos).
- `.env.example` declara toda variável lida pela API (garantido por `test/env-example.test.js`).
- Site (prompt 5): cardápio com abas, modal do produto (quantidade + observação), carrinho em barra + gaveta, estado fechado com prévia e botões desabilitados, atualização a cada 30 s com aviso de item removido/preço alterado. `vite build` sem erro; telas conferidas num Chrome headless (390×844). Logo no cabeçalho e no favicon, com fallback em Dancing Script conferido bloqueando a imagem.
- Seed cria produtos com `disponivelHoje = true`. No banco de dev (semeado antes dessa regra) os 30 produtos foram ligados com `UPDATE "Produto" SET "disponivelHoje" = true` em 2026-11-15.
- Branches `feat/api-base`, `feat/site-cardapio`, `feat/cliente-auth-google`, `feat/pedidos`, `feat/pdv-fila`, `feat/pdv-delivery`, `feat/impressao` e `feat/salao-comandas` já integrados na `main` e apagados.
- Aprovados pelo dono: sessão do cliente de 7 dias sem refresh, limite de 10 endereços, `chaveIdempotencia`, `ContadorPedido` + `CHECK (estoque >= 0)`, status inicial (SITE/WHATSAPP `CONFIRMADO`, SALAO `ABERTO`).
- Railway: `api/.env.railway` gerado (local, não versionado) com segredos de produção; falta preencher `GOOGLE_CLIENT_ID` e `CORS_ORIGINS` e colar no Raw Editor do serviço da API.
- Pendência: logo em PNG com fundo transparente (e uma versão quadrada para favicon e ícone do instalador), pedida ao dono. Até chegar, segue o JPEG `shared/assets/logo-cabana-boemia.jpg` (fundo claro, sombra escura no canto inferior direito).
- Login Google do cliente (API + passo no checkout do site), perfil/telefone e CRUD de endereços feitos. Telas de login, telefone inválido e resumo conferidas no Chrome headless (390×844). Falta configurar o OAuth Client no Google Cloud Console e pôr `GOOGLE_CLIENT_ID` no `api/.env`.
- Pedidos feitos: criação com baixa atômica, numeração por dia, idempotência, `PRECO_ALTERADO` no site, canais da equipe sem trava de horário, Socket.IO para a equipe (desativado cai na hora), checkout completo do site e repetir último pedido. Fluxos conferidos no Chrome headless (confirmar, troco inválido, sucesso com link wa.me, repetir, preço alterado no meio do checkout); dados temporários apagados do banco de dev. Migration `pedidos` aplicada no banco de dev.
- PDV (branch `feat/pdv-fila`, já integrada na `main` e apagada): login, barra superior (logo, Salão, Delivery, tempo estimado, indicador de conexão, Sair), fila de delivery em tempo real com som, finalizar com forma de pagamento; rotas `/equipe`. Conferido no Electron real via CDP: pedido do site chegou na fila em ~0,2 s com o som tocando sem clique; indicador "Reconectando…" com a API parada; sessão restaurada do `sessao.bin` (cifrado, prefixo `v10`) após reiniciar; Sair apaga o arquivo; tempo 55 refletido no `/publico/cardapio`, vazio volta a 40; finalizar trocou Dinheiro→Pix e apagou o troco. Dados temporários apagados do banco de dev. Não testado ao vivo: queda por desativação (coberta pelos testes da API e do `clienteApi`), instalador (`npm run dist`) e início com o Windows.
- Delivery do WhatsApp no PDV (branch `feat/pdv-delivery`, já integrada na `main` e apagada; decisões aprovadas pelo dono): clientes (busca/cadastro/endereço), grade por turno, lançamento pelo `criarPedido`, cancelamento com estorno exato e impressão CANCELAMENTO, F2/Esc. Conferido no Electron real via CDP com a API de dev: cadastro rápido → confirmar → grade (Cachorro Quente e bebidas sem saldo desabilitados) → 2 X-Bacon "sem cebola" + X-Bacon + X-Burguer + Coca → Dinheiro, troco 70 recusado e 100 aceito ("levar R$ 26,00") → Esc voltou a Itens mantendo o carrinho → Confirmar: "Pedido #1 lançado", na fila; banco com VENDA −4 pão / −1 Coca, PEDIDO PENDENTE, `criadoPorId` da atendente. Cancelar pela fila: estoque voltou (6→10, 4→5), ESTORNO +4/+1, CANCELAMENTO PENDENTE, saiu da fila. Busca "98877" + Enter + Enter levou ao passo 2; Esc, Esc voltou à fila. Dados temporários apagados e estoques de dev devolvidos a 0. Busca sem acento (`nomeBusca`) pedida pelo dono depois da revisão: migration `cliente_nome_busca` aplicada no banco de dev (`migrate diff` sem diferença).
- Impressão (branch `feat/impressao`, já integrada na `main` e apagada): API, agente, cupom e tela feitos. Conferido no Electron real via CDP com a API de dev (modo `.txt`, proxy TCP entre PDV e API): pedido impresso em ~1 s pelo socket; com o PDV sem rede, 3 pedidos ficaram pendentes e o indicador mostrou "Impressora offline"; ao voltar, os 3 saíram uma vez cada, em ordem, em ~2 s; reabrir o app imprimiu o pendente; "Reimprimir" e cancelamento geraram trabalhos novos. Spooler real: status lido no Electron 45 e job RAW enviado para a impressora "OneNote (Desktop)" (porta `nul:`), resolvido quando saiu da fila. Dados temporários apagados.
- Pendências da impressão:
  - Testar na térmica física **antes da demo**: impressão real (acentos na tabela escolhida, negrito, fonte grande, corte) e o aviso de "sem papel" (depende do driver informar; senão aparece "erro").
  - Instalador (Prompt 15): incluir o binário do koffi (`@koromix/koffi-win32-x64`, fora do asar) no pacote do electron-builder.
  - Só um PDV pode ter a impressão ligada (dois imprimiriam cada cupom duas vezes). Se houver um segundo computador no futuro, implementar reserva do trabalho no servidor (o agente reserva o id antes de imprimir) antes de ligar a impressão nele.
- Salão (branch `feat/salao-comandas`, já integrada na `main` e apagada): comandas na API e no PDV; exibição agrupada ("4x Refrigerante Lata") na tela e no cupom CONTA, com um `ItemPedido` por toque no banco (agrupamento coberto por testes; não reconferido no Electron depois do ajuste). Conferido no Electron real via CDP com a API de dev (almoço com 3 clientes: prato 487 g = R$ 29,17, bebidas e X-Bacon baixando estoque na hora, remover devolvendo, busca "joao"/"mar", fechar com/sem conta, 409 em comanda fechada). Dados temporários apagados (banco de dev voltou a estoques 0 e "Prato por kg" com preço 0/inativo).
- Caixa (branch `feat/caixa`, ainda não integrada; decisões aprovadas pelo dono): migration `caixa` aplicada no banco de dev (`migrate diff` sem diferença). Conferido no Electron real via CDP com a API de dev: login sem caixa → "Abrir caixa" (fila montada por trás); "abc" recusado; abertura R$ 150,00; comanda do João (487 g) fechada em dinheiro; site "Pix" finalizado em dinheiro; suprimento R$ 20 e sangria R$ 100; fechar com a comanda da Maria e um WhatsApp abertos → lista com atalhos, resolvidos ali (Finalizar com Dinheiro pré-selecionado; Fechar conta em Pix); fechar com R$ 176,00 → volta a "Abrir caixa". Retaguarda: esperado 17.667, contado 17.600, diferença −67, Dinheiro 3/10.667, Pix 1/900; atendente na retaguarda = 403; cupom FECHAMENTO sem esperado/diferença. Dados temporários apagados.
- Falta: telas da retaguarda (web), relatório do dia.

## FORA DA V1
- Status do pedido para o cliente.
- Cálculo automático de tempo.
- Fiado.
- Pix com API.
- Estoque completo por insumo de todos os ingredientes.
- Aviso "saiu para entrega".
