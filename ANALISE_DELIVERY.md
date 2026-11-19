# Análise do site de pedidos: base para o app "Delivery Abatiá"

Levantamento do que existe hoje (branch `feat/painel-delivery`, 19/11/2026), feito lendo o código. Não propõe implementação: só descreve o que existe e as lacunas para um app multi-loja Android/iOS.

---

## 1. Stack e estrutura

### Stack
- **Gerenciador**: npm com workspaces (`package.json` da raiz, nome `restaurante`). `engines.node = "24.x"`. Um único `package-lock.json`.
- **API** (`api/package.json`): Node 24 (ESM), Express 4.22, Prisma 5.22 + PostgreSQL, zod 4, Socket.IO 4.8.4, jsonwebtoken 9, bcryptjs 3, google-auth-library 11.3.2, helmet 8, cors, morgan, express-rate-limit 8.
- **Site** (`site/package.json`): React 18.3 + Vite 5.4 (`@vitejs/plugin-react`), `@fontsource/dancing-script`. Sem biblioteca de estado, de UI nem de rotas. `pngjs` só para gerar ícones.
- **Shared** (`shared/package.json`): JavaScript puro (ESM), sem dependências. Exporta `./telefone`, `./cupom`, `./itens`, `./frete`, `./horarios`.
- **PDV**: Electron 45 + electron-vite + React 18; impressão com `@point-of-sale/receipt-printer-encoder` + `koffi` (winspool).
- **Retaguarda**: React 18 + Vite 5 (`base: '/admin/'`).
- **Testes**: `node:test` em todas as partes (sem Jest/Vitest).
- Linguagem: **JavaScript** (sem TypeScript; tipos só em comentários JSDoc).

### Como roda em dev
- `npm run dev -w api` → `node --watch --env-file-if-exists=.env src/server.js` (porta 3000).
- `npm run dev -w site` → `predev` gera os ícones (`site/scripts/gerar-icones.mjs`) e sobe o Vite na porta 5173; o proxy repassa `/api` para `http://localhost:3000` (`site/vite.config.js`). `VITE_API_URL` vazio = mesmo domínio (`site/.env.example`).
- Banco local PostgreSQL; `npm run seed -w api` (cardápio de `api/prisma/cardapio-cabana-boemia.json`).

### Deploy (Railway)
- Um serviço Node + um serviço PostgreSQL. Railpack detecta os workspaces; Root Directory vazio.
- `npm run build` (raiz): build do site e da retaguarda → `scripts/copiar-builds.mjs` copia para `api/public/` → `prisma generate`.
- `npm start` (raiz) → `prisma migrate deploy && node src/server.js`.
- A API serve tudo no mesmo domínio (`api/src/app.js` + `api/src/lib/estaticos.js`): site em `/`, retaguarda em `/admin`, rotas em `/api`, Socket.IO em `/api/socket.io`. Healthcheck `/api/health`.
- Domínio: `https://cabana.managerpix.com.br` (CNAME) e `https://cabana-boemia-production.up.railway.app`.
- Variáveis: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_CLIENTE_SECRET`, `GOOGLE_CLIENT_ID`, `CORS_ORIGINS`, `NODE_ENV`, `BCRYPT_CUSTO`, `ELECTRON_SKIP_BINARY_DOWNLOAD`. A API recusa iniciar sem segredos válidos (`api/src/lib/tokens.js`).

### Monorepo
| Pasta | Papel |
|---|---|
| `api/` | Express em camadas `routes → controllers → services → repositories`; Prisma (`api/prisma/schema.prisma`, migrations, seed); Socket.IO; serve os builds. |
| `site/` | Site do cliente (cardápio, sacola, checkout, pedidos, perfil), PWA. |
| `pdv/` | App Electron da atendente: painel de delivery, salão/comandas, caixa, agente de impressão térmica. |
| `retaguarda/` | Painel web do dono: cardápio do dia, produtos, categorias, estoque, turnos, bairros, equipe, configurações, relatório. |
| `shared/` | Regras puras usadas por mais de uma parte: telefone, frete grátis, horários, agrupamento de itens, cupom. Também `shared/assets` (logos). |

---

## 2. Fluxo do cliente no site, tela por tela

Entrada: `site/src/main.jsx` → `/privacidade` e `/termos` montam `PaginaLegal`; qualquer outro caminho monta `AvisosProvider > ClienteProvider > CarrinhoProvider > App`. Navegação por abas com `history.pushState` (`site/src/lib/navegacao.js`, `hooks/useNavegacao.js`, `componentes/Navegacao.jsx`): `/` Início, `/pedidos`, `/perfil`.

### 2.1 Abertura (splash)
- `site/index.html` + `site/public/splash/` (script inline liberado por hash na CSP). Mostrado no máximo a cada 3 h (`localStorage` `cbSplash`).

### 2.2 Cardápio (sem login)
- Arquivos: `App.jsx`, `hooks/useCardapio.js`, `componentes/Cabecalho.jsx`, `AbasCategorias.jsx`, `ListaCardapio.jsx`, `ImagemProduto.jsx`, `ModalProduto.jsx`, `Faixas.jsx` (`AvisoFechado`, `FaixaSemConexao`), `hooks/useCategoriaAtiva.js`.
- `GET /api/publico/cardapio` ao abrir, a cada 30 s com a aba visível e ao voltar para a aba. Falha de rede mantém o último cardápio e mostra a faixa "sem conexão".
- **Turnos Almoço/Lanches**: decididos na API (`api/src/services/turno.service.js`, `calcularTurnoAtivo`), horário local America/Sao_Paulo, intervalos `[inicio, fim)` por dia da semana, cruzando a meia-noite quando `fim <= inicio`. O site só mostra o turno ativo.
- **Loja fechada**: `aberto: false` + `proximaAbertura` + prévia do cardápio do próximo turno, sem filtrar `disponivelHoje`/saldo; cards desabilitados ("Fechado agora"). Texto de reabertura em `lib/horario.js` (`quandoAbre`).
- **Indisponíveis por estoque**: com a loja aberta, a API simplesmente **não devolve** produto sem saldo (`temSaldo` em `api/src/services/publico.service.js`: estoque próprio > 0 e todos os insumos com saldo). Cada produto traz `maxSacola` = saldo limitado a 20 (para não revelar estoque).
- Card abre o `ModalProduto` (quantidade 1–20, observação até 140 caracteres).

### 2.3 Sacola (carrinho)
- Arquivos: `carrinho/carrinho.js` (lógica pura), `carrinho/CarrinhoContext.jsx`, `componentes/BarraSacola.jsx` (barra + `LinhaFreteGratis`), `componentes/PainelSacola.jsx` (`<dialog>` tela cheia), `sacola/sacola.js` (limite por linha, sugestões, prévia da taxa).
- Mesmo produto + mesma observação somam na linha; observação diferente = outra linha.
- Persistido em `localStorage` `cabana-boemia:carrinho:v1`; dado corrompido vira sacola vazia.
- **Conciliação** (`conciliar`): a cada cardápio novo remove o que sumiu e atualiza preço, com aviso.
- "Peça também": produtos com `sugerirNaSacola` (ou categoria "Bebidas"), até 10.
- Frete grátis: regra em `shared/src/frete.js` (subtotal ≥ mínimo da `Configuracao`).
- Taxa na prévia: grátis / taxa do bairro do endereço principal (logado) / "Calculada no próximo passo".

### 2.4 Checkout (dentro do painel da sacola)
`componentes/Checkout.jsx` escolhe a etapa por `etapaCheckout` (`cliente/sessao.js`): `carregando → login → telefone → pronto`.
1. **Login com Google**: `componentes/EntrarComGoogle.jsx` + `lib/google.js` (botão oficial do Google Identity Services). Ver seção 4.
2. **Telefone obrigatório** (primeiro login): `PassoTelefone` em `Checkout.jsx` → `PUT /api/cliente/me { nome, telefone }`. Validação/máscara em `shared/src/telefone.js` (celular com DDD válido + 9 dígitos, salvo só com dígitos).
3. **Endereço**: `componentes/Finalizacao.jsx` carrega `GET /cliente/enderecos` + `GET /publico/bairros`; pré-seleciona o principal ativo. Sem endereço → `componentes/FormEndereco.jsx` (rua, número, complemento, referência, bairro em lista). "Trocar" lista os endereços; bairro desativado aparece desabilitado.
4. **Confirmar dados**: um toque ("Confirmar dados"), com "Alterar" telefone e "Não é você? Sair".
5. **Pagamento**: `PIX | DINHEIRO | DEBITO | CREDITO`, texto fixo "Pagamento na entrega". Troco só em dinheiro e maior que o total (`erroDoTroco`, `lerReais` em `pedido/pedido.js`).
   - **Pix**: é só uma forma de pagamento informada; **não há Pix online** (sem QR code, sem gateway, sem confirmação de pagamento).
6. **Resumo**: itens, taxa do bairro ("Grátis" quando 0), total (prévia via `resumoDoPedido`).
7. **Enviar**: `POST /api/cliente/pedidos` com `chaveIdempotencia` (UUID por tentativa, `crypto.randomUUID()`) e `totalEsperadoCentavos`.
   - `409 PRECO_ALTERADO`: aplica os preços/taxa novos, avisa dentro do painel e pede novo toque (mesma chave).
   - `ESTOQUE_INSUFICIENTE`, `PRODUTO_INDISPONIVEL`, `LOJA_FECHADA`: recarrega o cardápio e mostra a mensagem.
   - Erro de rede: mensagem genérica; reenviar com a mesma chave não duplica.

### 2.5 Confirmação
- Animação do dono (`site/public/confirmacao/`, chamada por `lib/confirmacao.js` em `PainelSacola`) só depois do sucesso; a sacola é limpa.
- `componentes/PedidoEnviado.jsx`: "Pedido nº N recebido!", **tempo estimado** (`pedido.tempoEstimadoMin`, gravado na criação; manual do dia ou padrão da `Configuracao`), itens, taxa, total, forma/troco, endereço.
- **Cancelamento via WhatsApp**: link `wa.me/<whatsapp da Configuracao>?text=Olá, gostaria de cancelar o pedido N, em nome de NOME` (`linkCancelamento`). Sem WhatsApp configurado: "fale com o restaurante".

### 2.6 Repetir último pedido
- `hooks/useUltimoPedido.js` → `GET /cliente/pedidos/ultimo`. Botão "Repetir último pedido" no Início (loja aberta). `repetirPedido`/`avisosDaRepeticao` em `pedido/pedido.js`: só entra o que está no cardápio agora, com o preço de agora; o resto vira aviso.

### 2.7 Pedidos (histórico)
- `componentes/TelaPedidos.jsx` → `GET /cliente/pedidos?antesDeId=` (20 por página). Data em Brasília, nº, itens resumidos, total, forma, selo "Cancelado", "Repetir pedido".
- **Não há status em tempo real para o cliente** (fora da v1): a tela mostra o pedido, não acompanha preparo/entrega.

### 2.8 Perfil
- `componentes/TelaPerfil.jsx`: nome, e-mail do Google, telefone (`PassoTelefone`), endereços (editar, principal, remover, novo; `FormEndereco`) e Sair.

### 2.9 Instalação (PWA)
- `componentes/InstalarApp.jsx`, `lib/instalacao.js`, `lib/pwa.js`. Ver seção 5.

---

## 3. Back-end usado pelo site

### 3.1 Endpoints (todos sob `/api`)
Erros sempre no formato `{ erro: { mensagem, codigo, detalhes } }` (`api/src/middlewares/erro.js`, lido por `ErroApi` em `site/src/lib/api.js`).

**Públicos** (`api/src/routes/publico.routes.js`, sem auth, `Cache-Control: public, max-age=15`):
| Método | Rota | Resposta |
|---|---|---|
| GET | `/publico/cardapio` | `{ aberto, turno, proximaAbertura, tempoEstimadoMin, freteGratis, categorias: [{ id, nome, produtos: [{ id, nome, descricao, tipoPreco, precoCentavos, sugerirNaSacola, imagemUrl, maxSacola }] }] }` |
| GET | `/publico/bairros` | `{ bairros: [{ id, nome, taxaCentavos }] }` (só ativos) |
| GET | `/publico/config` | `{ nome, whatsapp, freteGratis, googleClientId }` |

**Cliente** (`api/src/routes/cliente.routes.js`, `Cache-Control: no-store`; tudo menos o login exige `Authorization: Bearer <JWT de cliente>` via `middlewares/autenticarCliente.js`):
| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/cliente/auth/google` | `{ credential }` (ID token do Google) | `{ token, cliente }` |
| GET | `/cliente/me` | – | `{ cliente: { id, nome, email, telefone, precisaTelefone } }` |
| PUT | `/cliente/me` | `{ nome, telefone }` | `{ cliente }` |
| GET | `/cliente/enderecos` | – | `{ enderecos }` (com `bairro { id, nome, taxaCentavos, ativo }`) |
| POST | `/cliente/enderecos` | `{ rua, numero, complemento?, referencia?, bairroId, principal? }` | 201 `{ endereco }` |
| PUT | `/cliente/enderecos/:id` | idem | `{ endereco }` |
| DELETE | `/cliente/enderecos/:id` | – | 204 |
| POST | `/cliente/pedidos` | `{ itens: [{ produtoId, quantidade, observacao? }], enderecoId, formaPagamento, totalEsperadoCentavos, trocoParaCentavos?, chaveIdempotencia? }` | 201 (novo) / 200 (mesma chave) `{ pedido }` |
| GET | `/cliente/pedidos?antesDeId=` | – | `{ pedidos, proximo }` |
| GET | `/cliente/pedidos/ultimo` | – | `{ pedido \| null }` |

- Schemas zod em `api/src/controllers/cliente.controller.js` e `api/src/controllers/esquemas.js`. Campos extras (ex.: preço) são descartados; preço e taxa saem sempre do banco.
- `pedidoPublico` (`api/src/services/pedido.service.js`) é o formato devolvido ao site (sem nome da atendente).

### 3.2 Criação do pedido (`criarPedido`, `api/src/services/pedido.service.js`)
Uma transação: turno ativo (só SITE, `409 LOJA_FECHADA`) → revalida produtos (`409 PRODUTO_INDISPONIVEL`) → bairro ativo → preços do banco + frete grátis + conferência de `totalEsperadoCentavos` (`409 PRECO_ALTERADO`) → baixa atômica de estoque em ordem de id (`409 ESTOQUE_INSUFICIENTE`) → `numeroDia` por `ContadorPedido` (dia operacional, virada às 04:00) → grava pedido, itens (snapshots), `MovimentacaoEstoque` VENDA e `TrabalhoImpressao` PEDIDO/PENDENTE. Status inicial do SITE: `CONFIRMADO`.

### 3.3 Como chega ao PDV e à impressão
- Depois do commit, `emitirParaEquipe('pedido:novo', ...)` e `emitirParaEquipe('impressao:nova', ...)` (`api/src/lib/eventos.js`, um `EventEmitter` em memória).
- `api/src/lib/tempoReal.js` repassa para a sala `equipe` do Socket.IO (`/api/socket.io`). Só entra quem manda o access token **da equipe**; o cliente do site **não** recebe nada por socket.
- PDV (`pdv/src/main/tempoReal.js`) recebe `pedido:novo`, toca o alerta (só canal SITE) e atualiza o painel.
- Impressão: o agente do PDV (`pdv/src/main/agente-impressao/`) busca `GET /equipe/impressoes/pendentes`, imprime ESC/POS via spooler do Windows e confirma em `POST /equipe/impressoes/:id/confirmar`. Cupom montado por `shared/src/cupom.js`.

### 3.4 Tabelas envolvidas (`api/prisma/schema.prisma`)
- `Cliente` (googleId, nome, nomeBusca, email, telefone, observacao), `Endereco` (rua, número, complemento, referência, bairroId, cep/cidade/estado só do PDV, principal), `Bairro` (nome único, taxaCentavos, ativo).
- `Categoria`, `Produto` (preço, ativo, disponivelHoje, vendidoNoSite, sugerirNaSacola, imagemUrl, controlaEstoque, estoque), `Turno`, `HorarioTurno`, `ProdutoTurno`.
- `Insumo`, `ProdutoInsumo`, `MovimentacaoEstoque` (só histórico).
- `Pedido` (numeroDia, dataRef, canal, status, snapshots de cliente/endereço/bairro, valores, forma, troco, tempoEstimadoMin, chaveIdempotencia), `ItemPedido`, `ContadorPedido`.
- `TrabalhoImpressao`, `Configuracao` (linha única `id = 1`: nome, WhatsApp, tempo estimado, virada do dia, frete grátis).

---

## 4. Autenticação

### Como funciona hoje
- **Biblioteca no site**: Google Identity Services carregado sob demanda (`https://accounts.google.com/gsi/client`, `site/src/lib/google.js`), botão oficial com `ux_mode: 'popup'` e `use_fedcm_for_button: true`. O `client_id` vem de `GET /publico/config`.
- **Fluxo**: o GIS entrega um **ID token** (`credential`) → `POST /cliente/auth/google` → a API valida com `google-auth-library` (`api/src/lib/google.js`: assinatura, emissor, validade, `aud === GOOGLE_CLIENT_ID`) → upsert do `Cliente` por `googleId` (`api/src/services/cliente.service.js`; nome do Google só na criação; e-mail só se `email_verified`) → devolve um **JWT próprio de cliente**.
- **Token**: HS256, segredo `JWT_CLIENTE_SECRET`, `aud: "cliente"`, `sub` = id do cliente, **7 dias, sem refresh** (`api/src/lib/tokens.js`). `autenticarCliente` relê o cliente no banco a cada requisição.
- **Onde fica**: `localStorage` `cabana-boemia:cliente:v1` (`site/src/cliente/sessao.js`), enviado em `Authorization: Bearer`. **Sem cookies.** 401 apaga o token (`ClienteContext.jsx`).
- Só um cliente OAuth "Aplicativo da Web" no Google Cloud (sem client secret, sem redirect URIs).
- Helmet com `crossOriginOpenerPolicy: same-origin-allow-popups` para o popup funcionar (`api/src/app.js`).
- Equipe (PDV/retaguarda) usa outro esquema: e-mail + senha, access 15 min + refresh rotativo (não afeta o app do cliente).

### O que precisaria mudar para um app nativo
- O GIS (botão web, popup, FedCM) **não funciona em React Native**. Seria preciso login nativo (Google Sign-In do Android/iOS ou fluxo OAuth com navegador do sistema) e criar **novos clientes OAuth** no Google Cloud (Android com SHA-1 do certificado de assinatura, iOS com bundle id).
- A API hoje aceita **um único** `GOOGLE_CLIENT_ID` como audience (`criarVerificadorGoogle`). ID tokens emitidos para os clientes Android/iOS terão outro `aud` e seriam recusados (401 `TOKEN_GOOGLE_INVALIDO`): a verificação teria que aceitar uma lista de audiences.
- **Login com Apple**: a App Store exige "Sign in with Apple" quando o app oferece login social de terceiros (como o Google) como única opção. Não existe nada disso hoje (nem campo `appleId` em `Cliente`).
- Token em `localStorage` → no app teria que ir para armazenamento seguro (Keychain/Keystore).
- Sessão de 7 dias sem refresh: no web o re-login é um toque; no app isso seria uma interrupção perceptível.
- `CORS_ORIGINS` não afeta app nativo (requisição sem `Origin` já passa), mas a CSP/COOP só valem para o site.

---

## 5. Estado atual do PWA

- **Manifest**: `site/public/manifest.webmanifest` (name "Cabana Boemia", short_name "Cabana", `start_url`/`scope` `/`, `display: standalone`, `theme_color #9E0B22`, `background_color #FBF3E8`, ícones 192, 512 e maskable 512). Servido como `application/manifest+json`, `no-cache` (`api/src/lib/estaticos.js`).
- **Ícones**: gerados no `predev`/`prebuild` por `site/scripts/gerar-icones.mjs` a partir de `shared/assets/logo-cabana-boemia-recorte.png` em fundo creme (`site/public/icones/`, fora do git), incluindo `apple-touch-icon` 180.
- **Service worker**: modelo `site/pwa/sw.js`, gravado em `dist/sw.js` pelo plugin `site/pwa/plugin-sw.js` com versão = hash do build. Registrado só em produção (`site/src/lib/pwa.js`).
  - Cacheia só estáticos (`/assets`, `/icones`, `/splash`, `/confirmacao`, `/offline.html`).
  - Nunca intercepta `/api`, `/admin`, `/socket.io`, não-GET, outros domínios.
  - Navegação sempre da rede; sem rede mostra `site/public/offline.html`.
  - Versão nova: `skipWaiting` + `clients.claim` + apaga caches antigos.
- **Convite para instalar**: botão no cabeçalho quando há `beforeinstallprompt`; cartão com passo a passo por navegador (Android, Safari iOS, Chrome iOS, Samsung, navegador interno do Instagram/Facebook) 10 s depois de entrar, pausa de 7 dias (`componentes/InstalarApp.jsx`, `lib/instalacao.js`).
- **O que funciona instalado**: abre em tela cheia, ícone na tela inicial, carregamento rápido dos estáticos, tela "Sem conexão". **Não há**: notificações push, pedido offline, sincronização em segundo plano.

---

## 6. Multi-loja: onde o código assume um único restaurante

O sistema é **single-tenant de ponta a ponta**. Nenhuma tabela tem `lojaId`.

### Banco (`api/prisma/schema.prisma`)
- `Configuracao` é **linha única** (`id = 1` com `@default(1)`): nome, WhatsApp, tempo estimado, virada do dia, frete grátis.
- Unicidades globais que colidiriam entre lojas: `Produto.nome` (também chave do upsert do seed), `Categoria.nome`, `Bairro.nome`, `Turno.nome`, `Insumo.nome`.
- `Pedido @@unique([dataRef, numeroDia])` e `ContadorPedido` com chave só `dataRef`: **um contador de pedidos por dia para o sistema todo**.
- `Caixa`: índice parcial `Caixa_um_aberto` garante **um caixa aberto no sistema inteiro** (migration `caixa`).
- `Usuario` (DONO/ATENDENTE) sem vínculo com loja; papel `DONO` vê tudo.
- `Cliente` e `Endereco`: o cliente é do sistema (isso poderia continuar global), mas `Bairro`/taxa são de uma loja só.
- `TrabalhoImpressao`: fila única.

### API
- `api/src/services/publico.service.js`: `cardapio()`, `bairros()`, `config()` sem parâmetro de loja; fallback `nomeRestaurante: 'Cabana Boemia'` (também em `configuracao.service.js`, `impressao.service.js`).
- `turno.service.js`: turno ativo calculado sobre todos os turnos; validação de sobreposição entre **todos** os turnos ativos (`HORARIO_SOBREPOSTO` impediria duas lojas com o mesmo horário).
- `pedido.service.js`: `criarPedido` sem loja; frete grátis, tempo estimado e dia operacional vêm da única `Configuracao`.
- `lib/tempoReal.js`: uma sala `equipe` recebe **todos** os pedidos e eventos; `lib/eventos.js` é um barramento em memória do processo.
- `impressao.service.js`: `GET /equipe/impressoes/pendentes` devolve tudo pendente; o próprio projeto já registra que dois PDVs imprimindo duplicariam cupons.
- `relatorio.service.js`, `caixa.service.js`: relatórios e caixas globais.
- `exigirPapel('DONO')`: um dono só.
- Seed: `api/prisma/cardapio-cabana-boemia.json`.

### Site
- Marca fixa no código: `NomeRestaurante.jsx` (logo `shared/assets/logo-cabana-boemia.jpg` via `lib/logo.js`, `alt="Cabana Boemia"`), `site/index.html` (título, metas, splash da Cabana), `manifest.webmanifest`, `PaginaLegal.jsx` (texto cita a Cabana Boemia), `InstalarApp.jsx`/`lib/instalacao.js` ("Instale o app da Cabana"), `PainelSacola.jsx` (padrão "Cabana Boemia"), `estilos/tokens.css` (cores da marca).
- Chaves de `localStorage` com prefixo `cabana-boemia:`.
- Não existe tela de escolha de loja nem conceito de "loja" no estado do site; o carrinho não guarda de qual loja é.

### PDV, impressão, domínio, identidade
- PDV conecta num servidor e recebe tudo da sala `equipe`; config de impressora por computador sem loja.
- `shared/src/cupom.js`: `restaurante = 'Cabana Boemia'` como padrão.
- Domínio único `cabana.managerpix.com.br`; cliente OAuth com nome/origens da Cabana; política de privacidade da Cabana.
- Identidade visual (cores, logo, splash, animação de confirmação) é da Cabana.

### O que seria preciso (descrição das lacunas, não plano)
- Entidade `Loja` e `lojaId` em configuração, categorias, produtos, insumos, turnos/horários, bairros/taxas, pedidos, contador, caixa, impressão, usuários e relatórios; unicidades passando a ser por loja.
- Usuários da equipe vinculados a uma loja (e um papel acima do dono, para quem administra a plataforma).
- Rotas públicas e do cliente recebendo a loja (e uma listagem de lojas); regras de turno/frete/tempo/dia operacional por loja.
- Socket.IO com sala por loja; fila de impressão filtrada por loja (e reserva de trabalho para mais de um agente).
- Identidade visual (nome, logo, cores, WhatsApp) vinda do banco por loja, e não do código.
- Sacola presa a uma loja (pedido de uma loja só) e histórico de pedidos com a loja.

---

## 7. Reaproveitamento para o app

### Dá para reaproveitar direto (JS puro, sem DOM)
- `shared/src/telefone.js` (normalizar, mascarar, formatar, DDDs), `shared/src/frete.js` (frete grátis/progresso), `shared/src/horarios.js`, `shared/src/itens.js`.
- Lógica pura do site, já testada com `node:test`: `site/src/carrinho/carrinho.js` (adicionar/editar/remover, conciliar, mensagens; só a parte de persistência usa `localStorage`), `site/src/sacola/sacola.js`, `site/src/pedido/pedido.js` (resumo, corpo do pedido, troco, repetir, preços novos, link de cancelamento), `site/src/lib/horario.js`, `site/src/lib/dinheiro.js`, `site/src/cliente/sessao.js` (`etapaCheckout`).
- Contrato da API e o cliente HTTP `site/src/lib/api.js` (usa `fetch`, existe no React Native; muda só a base da URL, hoje relativa ao domínio).
- Todas as regras de negócio do servidor (preço do banco, `PRECO_ALTERADO`, estoque atômico, idempotência, turnos, frete): o app consome a mesma API.
- Textos e códigos de erro da API.

### Teria que ser reescrito para React Native/Expo
- **Todos os componentes** (`site/src/componentes/*.jsx`): usam HTML (`<dialog>`, `<form>`, `<fieldset>`, `<a>`), CSS (`site/src/estilos/*.css`, `:has()`, container queries, `env(safe-area-inset-*)`) e eventos do DOM.
- Contextos/hooks que tocam o navegador: `useCardapio` (`document.visibilityState`, `visibilitychange` → `AppState`), `useNavegacao`/`lib/navegacao.js` (`history.pushState` → navegação nativa), `lib/armazenamento.js` (`localStorage` → AsyncStorage/SecureStore).
- Login: `lib/google.js` e `EntrarComGoogle.jsx` (GIS web) → SDK nativo (ver seção 4).
- PWA inteiro (`lib/pwa.js`, `lib/instalacao.js`, `InstalarApp.jsx`, `site/pwa/`, manifest, ícones) não se aplica.
- Splash e animação de confirmação (`site/public/splash/`, `site/public/confirmacao/`) são HTML/CSS/JS do dono: precisariam ser refeitos (o dono pediu para não mudar duração/cores/textos sem perguntar).
- `crypto.randomUUID()` (`novaChavePedido`) não existe por padrão no React Native: precisa de polyfill/biblioteca.
- `Intl.DateTimeFormat` com `timeZone` (`dataDoPedido`): funciona no Hermes recente, mas convém conferir.
- Imports de `shared` usam subpaths do `exports` (`@restaurante/shared/frete`) e um import relativo de imagem fora do pacote (`site/src/lib/logo.js` → `../../../shared/assets/...`); o Metro precisa de configuração para monorepo.

---

## 8. Lacunas para as lojas de apps

| Item | Existe hoje? | Onde / observação |
|---|---|---|
| **Exclusão de conta pelo usuário** | **Não** | Não há rota nem botão. A política diz para pedir "falando com o restaurante" (`PaginaLegal.jsx`). Google Play e App Store exigem exclusão dentro do app (e a Play exige também um link web). No banco, `Pedido.clienteId` é `ON DELETE SET NULL` e `Endereco` é `CASCADE`, mas os pedidos guardam snapshots de nome, telefone e endereço (`nomeCliente`, `telefone`, `enderecoTexto`). |
| **Política de privacidade / termos** | Sim, só para a Cabana | `/privacidade` e `/termos` (`site/src/componentes/PaginaLegal.jsx`), texto em nome do restaurante. Para uma plataforma multi-loja, o controlador dos dados e o texto mudam. Não há aceite registrado (nem data/versão aceita). |
| **Consentimento de marketing** | Não | Nenhum campo, tela ou opt-in. A política diz "não usamos seus dados para propaganda". |
| **Log de acessos** | Parcial | Só o `morgan` (`combined` em produção) escrevendo no stdout do Railway (`api/src/app.js`), sujeito à retenção do Railway. Não há tabela de logins/acessos do cliente (o Marco Civil pede guarda de registros de acesso a aplicações por 6 meses para provedores com fins econômicos). |
| **Falta de internet** | Parcial | Cardápio: mantém o último e mostra faixa (`useCardapio`, `Faixas.jsx`). Envio: mensagem genérica com idempotência. Navegação sem rede: `offline.html` pelo SW. Sessão: sem rede mantém o token. Não há fila de pedido offline nem cache do cardápio entre aberturas (o cardápio não fica salvo). |
| Notificações (status do pedido) | Não | Fora da v1. Nenhum token de push no banco. |
| Rate limit no login do cliente | Não | Só `/auth` (equipe) tem `limitarLogin`; `/cliente/auth/google` e as rotas do cliente não têm limite. |

---

## 9. Riscos e dúvidas

- **Single-tenant estrutural**: unicidades globais (`Produto.nome`, `Categoria.nome`, `Bairro.nome`, `Turno.nome`), `Configuracao` com `id = 1`, contador de pedido e caixa únicos. Migrar a Cabana para um modelo com lojas mexe em praticamente todas as tabelas e no seed (upsert por nome).
- **Tempo real em memória**: `lib/eventos.js` é um `EventEmitter` do processo. Com mais de uma instância da API (escala para várias lojas), eventos de uma instância não chegam aos PDVs conectados na outra.
- **Impressão com um agente só**: sem reserva de trabalho no servidor; dois PDVs imprimindo duplicam cupons (já registrado no CLAUDE.md). Multi-loja multiplica esse cenário.
- **Validação de turnos entre turnos** (`HORARIO_SOBREPOSTO` contra outros turnos ativos): faz sentido para uma loja, impediria lojas diferentes no mesmo horário se nada mudar.
- **Dia operacional e virada** por `Configuracao.horaViradaDia`: uma regra por sistema.
- **Pix** é só rótulo; um app "estilo iFood" normalmente implica pagamento online, que não existe (nem webhook, nem conciliação).
- **Sem status para o cliente** e sem push: o cliente não sabe que o pedido saiu; cancelamento só por WhatsApp de um número único da `Configuracao`.
- **Audience única do Google** e falta de **Sign in with Apple** (seção 4).
- **JWT de cliente de 7 dias sem revogação**: não há lista de tokens; um token vazado vale até expirar (só para de valer se o cliente for apagado).
- **Sem exclusão de conta** e pedidos com dados pessoais em snapshot (seção 8).
- **Sem TypeScript**: o contrato da API só existe em comentários JSDoc e nos schemas zod do servidor; um app novo não tem tipos para importar.
- **Cache HTTP de 15 s** nas rotas públicas: o site já precisa de `cache: 'no-cache'` em recargas forçadas; o cliente HTTP do app terá o mesmo cuidado.
- **`repetirPedido`** usa `adicionar` limitado a 20 por linha, sem olhar `maxSacola`; um pedido repetido pode passar do saldo e só ser recusado no envio (`ESTOQUE_INSUFICIENTE`). Não é bug grave, só comportamento a saber.
- **Observação do pedido inteiro** (`Pedido.observacao`) existe no banco e no PDV, mas o site não envia (o schema do site não aceita).
- **Cliente compartilhado entre canais**: o PDV cria clientes sem `googleId` pelo telefone; um cliente do site com o mesmo telefone tem outro cadastro (`CLIENTE_JA_EXISTE` só na equipe). Num app multi-loja, a identidade do cliente entre lojas precisa ser decidida.
- **Domínio `managerpix.com.br` vence em 11/04/2027** e é o domínio verificado no Google; também precisa existir para o link web de exclusão de conta e para a política de privacidade das lojas.
- **Logo**: ainda JPEG provisório (PNG/quadrada pendente) — afeta ícone do app e telas de loja.
- **Dúvidas para decidir**:
  - O app será um cliente da mesma API/banco (a Cabana vira a loja 1) ou um sistema novo? O PDV/retaguarda atuais seguem servindo as outras lojas?
  - Quem é o controlador dos dados (a plataforma "Delivery Abatiá" ou cada loja)? Isso muda a política, os termos e a exclusão de conta.
  - Um cliente pode ter sacolas de lojas diferentes ao mesmo tempo?
  - Bairros e taxas: por loja (cada uma entrega onde quer) ou da cidade com taxa por loja?
  - Pagamento online e comissão (modelo iFood) entram no escopo?
