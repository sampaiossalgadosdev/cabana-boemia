# Cabana Boemia — Sistema de pedidos

Monorepo npm workspaces: `api` (Express + Prisma + Socket.IO), `site` (cliente), `retaguarda` (dono), `pdv` (Electron, balcão), `app` (Delivery do Batiá, Expo, Android/iOS; em desenvolvimento) e `shared`.

Em produção é **um serviço só** no Railway (mais o PostgreSQL), em **https://cabana.managerpix.com.br** (CNAME no Registro.br apontando para o Railway; o domínio do Railway, https://cabana-boemia-production.up.railway.app, continua ativo e serve o mesmo sistema). A API serve tudo:

| Caminho | O quê |
|---|---|
| `/` | site do cliente (SPA) |
| `/admin` | retaguarda do dono (SPA) |
| `/api/...` | rotas da API (ex.: `/api/health`, `/api/publico/cardapio`) |
| `/api/socket.io` | tempo real da equipe (PDV) |

O PDV fala com o mesmo domínio: na primeira tela do app instalado, digite só `https://cabana.managerpix.com.br` (o PDV acrescenta o `/api`).

## Desenvolvimento

```bash
npm install
npm run dev:api          # API em http://localhost:3000 (lê api/.env)
npm run dev:site         # http://localhost:5173 (repassa /api para a 3000)
npm run dev:retaguarda   # http://localhost:5174/admin/
npm run dev:pdv
npm run dev:app          # app Delivery do Batiá (Expo; abrir no Expo Go pelo QR)
npm test                 # todos os workspaces
npm run seed:demo        # dados de demonstração do dia (roteiro em DEMO.md)
npm run dist -w pdv      # instalador do PDV → pdv/dist/PDV-do-Batia-Setup-<versão>.exe
```

App Delivery do Batiá: login (Google Cloud, Apple) em `app/CONFIGURACAO_LOGIN.md`; build, envio às lojas, regra do `versionCode` e formulários de privacidade em `app/PUBLICACAO.md`.

### PDV do Batiá (balcão)

Um PDV só para **todas as lojas**: o programa se chama **PDV do Batiá** (antes, "Cabana Boemia PDV"). A loja vem do login: dono e atendente entram na loja deles; o administrador da plataforma escolhe a loja ("Em qual loja?") e o computador lembra a escolha.

O instalador (`npm run dist -w pdv`, no Windows → `pdv/dist/PDV-do-Batia-Setup-<versão>.exe`) instala só para o usuário do Windows, sem pedir administrador, cria atalho "PDV do Batiá" na área de trabalho e no menu Iniciar e abre o PDV ao terminar; a partir daí ele abre sozinho com o Windows. O instalador não é assinado: na primeira vez o Windows SmartScreen avisa "editor desconhecido" (Mais informações › Executar assim mesmo). O log da impressão fica em `%APPDATA%\PDV do Abatiá\logs\impressao.log` (a pasta de dados mantém o nome de antes da troca para "PDV do Batiá", de propósito: ver `CLAUDE.md` › PDV › Nome).

Atualizar um PDV que já se chama "PDV do Abatiá" para o "PDV do Batiá": é o mesmo programa para o Windows (mesmo `appId`), então o instalador novo atualiza por cima. Servidor, login, impressora e fila de impressão continuam, porque a pasta de dados não muda. Depois de instalar, confira se ficou um atalho só ("PDV do Batiá") na área de trabalho e apague um "PDV do Abatiá" que tenha sobrado (a atualização por cima com nome novo ainda não foi testada numa instalação real).

#### Instalar numa loja nova

1. Antes, na retaguarda (`/admin`), o administrador cria a loja em **Lojas** e o **dono** dela ("Criar dono"). O dono cadastra os produtos, os turnos e horários e a área de entrega, e cria os atendentes em **Equipe**.
2. No computador do balcão da loja: copie `PDV-do-Batia-Setup-<versão>.exe` (pen drive ou link) e execute.
3. Primeira abertura: o servidor já vem preenchido com `https://cabana.managerpix.com.br` (confira e salve); depois a impressora térmica (lista do Windows, largura 80/58 mm, "Imprimir teste") ou "Configurar depois".
4. Entre com o e-mail e a senha do dono ou de um atendente **daquela loja**: a barra mostra a logo e o nome dela, e só os pedidos, o caixa e os cupons dela aparecem.
5. Confira: um pedido de teste (Delivery › Novo pedido) cai no painel e o cupom sai com o nome da loja.
6. Mais de um computador na mesma loja pode ficar com a impressora ligada: a API reserva cada cupom para um computador, sem imprimir duas vezes.

#### Migrar o computador da Cabana (do "Cabana Boemia PDV")

A API multi-loja **não atende mais o programa antigo** (ele para de receber pedidos na hora e de imprimir). Por isso a troca é **junto com o deploy**, de preferência com a loja fechada:

1. **Backup do banco** de produção (ver `api/prisma/REVERTER_MULTI_LOJA.md`).
2. Merge da branch `feat/multi-loja` na `main` e push: o Railway faz o deploy e roda as migrations.
3. No Railway (`railway ssh`): `npm run seed -w api` (a Cabana ganha a logo e a cor padrão; nada do que o dono editou muda).
4. No computador da Cabana: **feche o PDV antigo** (Sair e fechar a janela; se precisar, feche pelo Gerenciador de Tarefas) e execute `PDV-do-Batia-Setup-<versão>.exe`.
   - É outro programa (instala ao lado do antigo). Na **primeira abertura** ele importa do antigo, sozinho: o **endereço do servidor**, a **impressora** (modo, largura, tabela, guilhotina), o **login salvo** (abre já logado, no mesmo usuário do Windows) e o identificador do computador para a fila de impressão. O antigo **deixa de abrir com o Windows** (o instalador e o PDV novo apagam a entrada dele) e o novo passa a abrir.
   - Se o login não vier (ex.: o antigo já tinha saído da conta), é só entrar com o usuário da Cabana.
5. Confira no PDV novo: a barra mostra a logo e o nome "Cabana Boemia"; um pedido de teste chega no painel; o cupom sai na impressora; o "Caixa" abre normal; em Impressora, a térmica certa está escolhida.
6. **Desinstale o programa antigo**: Configurações do Windows › Aplicativos › Aplicativos instalados › **Cabana Boemia PDV** › Desinstalar (ou Painel de Controle › Programas). Não abra o antigo antes de desinstalar: ele usaria o mesmo login já girado pelo novo, e a API, por segurança, encerraria as sessões desse usuário (aí é só entrar de novo no PDV novo).
7. A pasta de dados antiga (`%APPDATA%\Cabana Boemia PDV`) fica no computador; pode ser apagada depois que o PDV novo estiver funcionando.

Build de produção local (o mesmo que o Railway roda):

```bash
npm run build            # site + retaguarda → api/public/{site,admin} + prisma generate
NODE_ENV=production npm start   # prisma migrate deploy && node src/server.js
```

## Deploy no Railway

### Como o Railway monta o serviço

O Railway usa o **Railpack**, que reconhece os workspaces pelo `package.json` da raiz:

- **Node:** `engines.node = "24.x"`.
- **Instalação:** só `api`, `site`, `retaguarda` e `shared`, pela variável `RAILPACK_NODE_NPM_INSTALL` (tabela abaixo). Sem ela o Railpack roda `npm install` na raiz e instala também o `app` (Expo/React Native) e o `pdv` (Electron), que o servidor não usa. No seu computador nada muda: `npm install` continua instalando todos.
- **Build:** `npm run build` (raiz).
- **Start:** `npm start` (raiz) → `prisma migrate deploy && node src/server.js` no workspace `api`. As migrations rodam a cada deploy; o **seed não roda sozinho**.
- **Root Directory do serviço: vazio** (raiz do repositório). Apontar para `api/` quebra os workspaces.

### Variáveis de ambiente do serviço `api`

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao serviço do banco; o nome antes do ponto é o nome do serviço) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_CLIENTE_SECRET` | 48 bytes aleatórios cada, **diferentes entre si** e dos de dev. Gerar: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Sem eles (ou com menos de 32 caracteres) a API não inicia. |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth "Site Cabana Boemia" (`456901563669-…apps.googleusercontent.com`, valor público). Vazio = login do site responde 503. |
| `CORS_ORIGINS` | `https://cabana.managerpix.com.br,https://cabana-boemia-production.up.railway.app` (com `https://`, sem barra no fim, separados por vírgula sem espaço) |
| `NODE_ENV` | `production` |
| `BCRYPT_CUSTO` | `12` |
| `RAILPACK_NODE_NPM_INSTALL` | `npm ci --workspace=api --workspace=site --workspace=retaguarda --workspace=shared` (variável de build do Railpack: troca só o comando de instalação; direto, não via `npm run`) |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` (segurança, caso a instalação volte a incluir o PDV: não baixa o Electron no servidor) |

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

### Domínio

- `cabana.managerpix.com.br`: registro **CNAME** no Registro.br (zona de `managerpix.com.br`) apontando para o alvo que o Railway mostrou em *Settings → Networking → Custom Domain*. O Railway emite o certificado `https` sozinho.
- O domínio do Railway (`cabana-boemia-production.up.railway.app`) continua ativo; os dois estão no `CORS_ORIGINS` e nas origens do cliente OAuth.
- `managerpix.com.br` **vence em 11/04/2027**: se não for renovado, site, retaguarda, PDV e login param.
- Trocar de domínio (ex.: `cabanaboemia.com.br`): Custom Domain no Railway + DNS, verificar o domínio novo no Search Console e pôr no Branding do Google, acrescentar a origem no cliente OAuth e no `CORS_ORIGINS`, e trocar o servidor no PDV (deslogado). Nenhuma mudança de código: o sistema não guarda o domínio.

### Google (login do cliente no site)

Configurado no [Google Cloud Console](https://console.cloud.google.com/), projeto **Cabana Boemia**, em **Google Auth Platform**:

- **Branding:** app "Cabana Boemia", página inicial `https://cabana.managerpix.com.br`, política `https://cabana.managerpix.com.br/privacidade`, termos `https://cabana.managerpix.com.br/termos`, domínio autorizado `managerpix.com.br` (verificado no [Google Search Console](https://search.google.com/search-console) por registro TXT). **Sem logo:** logo exige verificação de marca pelo Google (dias); só colocar se for pedir essa verificação.
- **Público-alvo:** Externo, **Em produção** (qualquer conta Google entra). Escopos só básicos (`openid`, `email`, `profile`): não precisa de verificação de escopos.
- **Cliente "Site Cabana Boemia"** (Aplicativo da Web):
  - Origens JavaScript autorizadas: `https://cabana.managerpix.com.br`, `https://cabana-boemia-production.up.railway.app`, `http://localhost`, `http://localhost:5173`.
  - URIs de redirecionamento: **nenhuma** (o site usa o Google Identity Services com popup e ID token).
  - **Client secret não é usado** e foi excluído do console. Só o ID do cliente (público) vai para `GOOGLE_CLIENT_ID` no Railway (e no `api/.env` para testar o login em dev).

As páginas `/privacidade` e `/termos` são do próprio site (`site/src/componentes/PaginaLegal.jsx`); se mudar o que o site coleta, atualize o texto. Mudanças de origem no Google podem levar alguns minutos para valer.

### Segurança das páginas (CSP)

A API manda uma Content-Security-Policy própria para o site e para a retaguarda (`api/src/lib/estaticos.js`). O site libera só o Google Identity Services (`accounts.google.com/gsi/client` para script, `/gsi/` para iframe e conexões, `/gsi/style` e estilos inline, que o botão do Google usa); a retaguarda não carrega nada de fora. Quem adicionar um recurso externo (fonte, imagem, analytics) precisa acrescentá-lo ali.
