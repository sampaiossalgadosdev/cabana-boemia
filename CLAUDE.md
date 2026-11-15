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

## Tempo estimado
- Só manual. A atendente digita no PDV; se não digitar, vale o padrão configurado na retaguarda.
- `tempoEstimadoManualMin` só vale no dia local em que foi definido (`tempoManualDefinidoEm`); nos outros dias vale `tempoEstimadoPadraoMin`.

## PDV
- Executável Electron que abre com o Windows; botão de login.
- Tela com Salão e Delivery (ícone de bicicleta).
- Pedidos do site e do delivery caem na mesma fila em tempo real.

## Impressão
- Térmica USB 80mm/58mm no computador do balcão, via agente embutido no Electron.
- Fila de `TrabalhoImpressao` no servidor.
- O agente só marca impresso após a impressora confirmar.
- Heartbeat + reconexão; ao reconectar busca tudo pendente; nunca imprime duas vezes.

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
- Desativar atendente e trocar senha revogam todos os refresh tokens dele. Rotas `/usuarios` só alteram ATENDENTE.
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
- Feito na API: schema + migration `init`, seed do cardápio, autenticação (dono/atendentes, `/auth`, `/usuarios`), turno ativo, rotas públicas do site (`GET /publico/cardapio`, `/publico/bairros`, `/publico/config`, sem login, `Cache-Control: public, max-age=15`) e cliente do site (`/cliente/auth/google`, `/cliente/me`, `/cliente/enderecos`).
- Banco local: PostgreSQL 18, usuário `postgres`. `api/.env` tem `DATABASE_URL` (`restaurante`, migration aplicada e seed rodado), `DATABASE_URL_TEST` (`restaurante_test`) e `JWT_SECRET`/`JWT_REFRESH_SECRET`/`JWT_CLIENTE_SECRET` gerados (64 caracteres, diferentes). `GOOGLE_CLIENT_ID` ainda vazio (login do cliente responde 503 até configurar).
- Banco de dev tem um DONO de teste (`dono.teste@exemplo.com`, id 1), criado por `npm run criar-dono`; login, `/auth/me` e refresh (com rotação e recusa do refresh antigo) conferidos via curl contra a API rodando.
- Testes: API 94/94, site 25/25 e shared 4/4 passando, nenhum pulado (`npm test` na raiz roda todos).
- `.env.example` declara toda variável lida pela API (garantido por `test/env-example.test.js`).
- Site (prompt 5): cardápio com abas, modal do produto (quantidade + observação), carrinho em barra + gaveta, estado fechado com prévia e botões desabilitados, atualização a cada 30 s com aviso de item removido/preço alterado. `vite build` sem erro; telas conferidas num Chrome headless (390×844). Logo no cabeçalho e no favicon, com fallback em Dancing Script conferido bloqueando a imagem.
- Seed cria produtos com `disponivelHoje = true`. No banco de dev (semeado antes dessa regra) os 30 produtos foram ligados com `UPDATE "Produto" SET "disponivelHoje" = true` em 2026-11-15.
- Branches `feat/api-base`, `feat/site-cardapio` e `feat/cliente-auth-google` já integrados na `main` e apagados.
- Sessão do cliente de 7 dias sem refresh e limite de 10 endereços: aprovados pelo dono.
- Railway: criar `JWT_CLIENTE_SECRET` (a API não sobe sem ele) e `GOOGLE_CLIENT_ID` antes do próximo deploy.
- Pendência: logo em PNG com fundo transparente (e uma versão quadrada para favicon e ícone do instalador), pedida ao dono. Até chegar, segue o JPEG `shared/assets/logo-cabana-boemia.jpg` (fundo claro, sombra escura no canto inferior direito).
- Login Google do cliente (API + passo no checkout do site), perfil/telefone e CRUD de endereços feitos. Telas de login, telefone inválido e resumo conferidas no Chrome headless (390×844). Falta configurar o OAuth Client no Google Cloud Console e pôr `GOOGLE_CLIENT_ID` no `api/.env`.
- Falta: endereço/pagamento no checkout do site, pedidos (criação com baixa de estoque, numeração por dia), PDV, retaguarda, impressão, relatório do dia.

## FORA DA V1
- Status do pedido para o cliente.
- Cálculo automático de tempo.
- Fiado.
- Pix com API.
- Estoque completo por insumo de todos os ingredientes.
- Aviso "saiu para entrega".
