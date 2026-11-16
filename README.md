# Cabana Boemia — Sistema de pedidos

Monorepo npm workspaces: `api` (Express + Prisma + Socket.IO), `site` (cliente), `retaguarda` (dono), `pdv` (Electron, balcão) e `shared`.

Em produção é **um serviço só** no Railway (mais o PostgreSQL). A API serve tudo:

| Caminho | O quê |
|---|---|
| `/` | site do cliente (SPA) |
| `/admin` | retaguarda do dono (SPA) |
| `/api/...` | rotas da API (ex.: `/api/health`, `/api/publico/cardapio`) |
| `/api/socket.io` | tempo real da equipe (PDV) |

O PDV fala com o mesmo domínio: na primeira tela do app instalado, digite só `https://<seu-app>.up.railway.app` (o PDV acrescenta o `/api`).

## Desenvolvimento

```bash
npm install
npm run dev:api          # API em http://localhost:3000 (lê api/.env)
npm run dev:site         # http://localhost:5173 (repassa /api para a 3000)
npm run dev:retaguarda   # http://localhost:5174/admin/
npm run dev:pdv
npm test                 # todos os workspaces
npm run seed:demo        # dados de demonstração do dia (roteiro em DEMO.md)
npm run dist -w pdv      # instalador do PDV → pdv/dist/Cabana Boemia PDV Setup <versão>.exe
```

### PDV (balcão)

O instalador (`npm run dist -w pdv`, no Windows) instala só para o usuário, sem pedir administrador, cria atalho na área de trabalho e abre o PDV ao terminar; a partir daí ele abre sozinho com o Windows. Na primeira abertura pede o servidor (`https://<domínio>`, sem `/api`) e a impressora térmica (lista do Windows e largura do papel 80/58 mm). O log da impressão fica em `%APPDATA%\Cabana Boemia PDV\logs\impressao.log`. O instalador não é assinado: na primeira vez o Windows SmartScreen avisa "editor desconhecido" (Mais informações › Executar assim mesmo).

Build de produção local (o mesmo que o Railway roda):

```bash
npm run build            # site + retaguarda → api/public/{site,admin} + prisma generate
NODE_ENV=production npm start   # prisma migrate deploy && node src/server.js
```

## Deploy no Railway

### Como o Railway monta o serviço

O Railway usa o **Railpack**, que reconhece os workspaces pelo `package.json` da raiz. Não há configuração extra:

- **Node:** `engines.node = "24.x"`.
- **Build:** `npm run build` (raiz).
- **Start:** `npm start` (raiz) → `prisma migrate deploy && node src/server.js` no workspace `api`. As migrations rodam a cada deploy; o **seed não roda sozinho**.
- **Root Directory do serviço: vazio** (raiz do repositório). Apontar para `api/` quebra os workspaces.

### Variáveis de ambiente do serviço `api`

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao serviço do banco; o nome antes do ponto é o nome do serviço) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_CLIENTE_SECRET` | 48 bytes aleatórios cada, **diferentes entre si** e dos de dev. Gerar: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Sem eles (ou com menos de 32 caracteres) a API não inicia. |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth (`...apps.googleusercontent.com`). Vazio = login do site responde 503. |
| `CORS_ORIGINS` | `https://<seu-app>.up.railway.app` (com `https://`, sem barra no fim; vários separados por vírgula) |
| `NODE_ENV` | `production` |
| `BCRYPT_CUSTO` | `12` |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` (a instalação inclui o workspace do PDV; não baixa o Electron no servidor) |

`PORT` **não** é definida: o Railway injeta. `VITE_API_URL` também não: o site e a retaguarda chamam `/api` no mesmo domínio. O dono tem todas prontas em `api/.env.railway` (não versionado) para colar no Raw Editor.

O CORS só importa para o navegador (site e retaguarda, no próprio domínio). O PDV chama a API pelo processo principal do Electron, sem `Origin`, e passa sempre.

### Criar o banco

1. No projeto do Railway: **+ New → Database → PostgreSQL**. Deixe o nome do serviço `Postgres` (é o nome usado em `${{Postgres.DATABASE_URL}}`).
2. As tabelas são criadas no primeiro deploy da `api` (`prisma migrate deploy` no start).

### Seed do cardápio e primeiro dono (uma vez, à mão)

Com a [Railway CLI](https://docs.railway.com/guides/cli) instalada e logada:

```bash
railway link          # escolha o projeto e o serviço api
railway ssh           # abre um shell dentro do container da api
npm run seed -w api
npm run criar-dono -w api -- --nome "Nome do Dono" --email dono@exemplo.com --senha "senha-forte"
exit
```

O seed é idempotente (só cria o que falta e nunca sobrescreve o que o dono editou). Pode rodar de novo depois de mudar `api/prisma/cardapio-cabana-boemia.json`.

Alternativa sem `ssh`: rodar do seu computador contra o banco do Railway usando a URL **pública** do Postgres (aba *Variables* do serviço Postgres → `DATABASE_PUBLIC_URL`):

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" node api/prisma/seed.js
```

### Google (login do cliente no site)

No [Google Cloud Console](https://console.cloud.google.com/):

1. **APIs e serviços → Tela de permissão OAuth**: tipo *Externo*, nome "Cabana Boemia", e-mail de suporte; escopos padrão (`openid`, `email`, `profile`). Publique o app (sai de "Teste") para qualquer conta Google conseguir entrar.
2. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
3. **Origens JavaScript autorizadas**:
   - `https://<seu-app>.up.railway.app`
   - para desenvolvimento: `http://localhost` e `http://localhost:5173`
4. **URIs de redirecionamento**: nenhum (o site usa o Google Identity Services com popup e ID token).
5. Copie o ID do cliente para `GOOGLE_CLIENT_ID` no Railway (e no `api/.env` para dev).

A mudança de origem no Google pode levar alguns minutos para valer.

### Segurança das páginas (CSP)

A API manda uma Content-Security-Policy própria para o site e para a retaguarda (`api/src/lib/estaticos.js`). O site libera só o Google Identity Services (`accounts.google.com/gsi/client` para script, `/gsi/` para iframe e conexões, `/gsi/style` e estilos inline, que o botão do Google usa); a retaguarda não carrega nada de fora. Quem adicionar um recurso externo (fonte, imagem, analytics) precisa acrescentá-lo ali.
