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
- Cada turno tem horários por dia da semana. O site só mostra e só aceita pedidos do turno ativo.
- Turno ativo (`services/turno.service.js`): calculado no horário local America/Sao_Paulo; cada horário é `[inicio, fim)`; `fim <= inicio` cruza a meia-noite (`"00:00"` = fim do dia, então domingo 00:00 vindo de sábado 19:00–00:00 está fechado).

## Cardápio do dia
- O dono escolhe quais produtos estão disponíveis hoje e edita a descrição da marmita.

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
- Rate limit no login por IP+email, só tentativas com falha contam. `trust proxy = 1` (Railway).
- Refresh trafega no corpo JSON. A retaguarda será servida no mesmo domínio da API (`/admin`), então **cookie httpOnly para o refresh é melhoria futura** (sem CORS/SameSite=None).
- Primeiro dono: `npm run criar-dono -w api -- --nome "..." --email ... --senha ...`.

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

## Status (2026-11-15)
- Feito na API: schema + migration `init`, seed do cardápio, autenticação (dono/atendentes, `/auth`, `/usuarios`), turno ativo e rotas públicas do site (`GET /publico/cardapio`, `/publico/bairros`, `/publico/config`, sem login, `Cache-Control: public, max-age=15`).
- Banco local: PostgreSQL 18, usuário `postgres`. `api/.env` tem `DATABASE_URL` (`restaurante`, migration aplicada e seed rodado) e `DATABASE_URL_TEST` (`restaurante_test`).
- Testes: 54/54 passando, nenhum pulado (health, prisma, seed, auth, turno, publico).
- Falta: pedidos (criação com baixa de estoque, numeração por dia), PDV, retaguarda, front do site, impressão, relatório do dia.

## FORA DA V1
- Status do pedido para o cliente.
- Cálculo automático de tempo.
- Fiado.
- Pix com API.
- Estoque completo por insumo de todos os ingredientes.
- Aviso "saiu para entrega".
