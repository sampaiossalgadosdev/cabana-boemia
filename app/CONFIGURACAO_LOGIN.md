# Login no app Taaki Delivery: Google, Apple e lojas

Passo a passo do que configurar **fora do código** para o login funcionar no Android e no iOS, e para publicar nas lojas. O código já está pronto; sem estes passos o botão "Continuar com Google" mostra "Login com Google ainda não configurado para esta versão do app".

Dados fixos do app:

| Item | Valor |
|---|---|
| Nome | Taaki Delivery |
| Pacote Android / Bundle ID iOS | `br.com.deliveryabatia.app` |
| Projeto EAS | `@sampaio040826/delivery-abatia` (ID `77cc3648-5ee3-4448-a147-6c213d3a69ea`) |
| API | `https://cabana.managerpix.com.br` |
| Exclusão de conta (web) | `https://cabana.managerpix.com.br/excluir-conta` |
| Política de privacidade (app) | `https://cabana.managerpix.com.br/privacidade-app` |
| Termos de uso (app) | `https://cabana.managerpix.com.br/termos-app` |

## Como o login do Google funciona no app

1. O app chama o Google Sign-In nativo com o `webClientId` = o **cliente "Aplicativo da Web" que o site já usa** ("Site Cabana Boemia"). O app lê esse ID de `GET /api/publico/config` (`googleClientId`), sem nada fixo no código.
2. O Google devolve um **ID token com `aud` = esse cliente web**, que a API já aceita (`GOOGLE_CLIENT_ID`).
3. O app manda o token para `POST /api/cliente/auth/google` (o mesmo endpoint do site) com `refresh: true` e recebe token + refresh.

O cliente OAuth **Android** não aparece no código. Ele existe para o Google autorizar o app pelo par **pacote + SHA-1 do certificado** que assinou o APK/AAB. Sem um cliente Android com o SHA-1 certo, o Google responde `DEVELOPER_ERROR`.

Use o **mesmo projeto do Google Cloud** do site ("Cabana Boemia"): o cliente Android precisa estar no mesmo projeto do cliente web. Na tela de consentimento aparece o nome do Branding ("Cabana Boemia"). Quando o app virar multi-loja, vale criar um projeto "Taaki Delivery" e migrar os clientes.

## 1. Google Cloud: cliente OAuth Android (build do EAS)

1. Pegue o **SHA-1 do keystore do EAS**. O keystore foi criado pelo EAS no primeiro build e fica guardado na Expo:
   - pelo site: expo.dev › projeto `delivery-abatia` › **Credentials** › Android › `br.com.deliveryabatia.app` › Keystore › **SHA-1 Fingerprint**; ou
   - pelo terminal, na pasta `app/`: `npx eas-cli@latest credentials -p android` › perfil `preview` (ou `production`) › mostra o SHA-1.
   Os perfis development, preview e production usam o mesmo keystore, então um SHA-1 cobre todos os builds do EAS.
2. [Google Cloud Console](https://console.cloud.google.com/) › projeto **Cabana Boemia** › **Google Auth Platform** › **Clientes** › **Criar cliente**:
   - Tipo: **Android**
   - Nome: `App Taaki Delivery (Android, EAS)`
   - Nome do pacote: `br.com.deliveryabatia.app`
   - Impressão digital SHA-1: a do passo 1
3. Salve. Não há segredo nem nada para copiar para o app. Opcional: acrescente o ID desse cliente em `GOOGLE_CLIENT_IDS` no Railway (não atrapalha e cobre o caso de o token vir com esse `aud`).
4. A mudança leva alguns minutos para valer. Teste no APK de preview: "Continuar com Google" › escolher a conta › volta logado.

## 2. Google Cloud: cliente Android do Play App Signing (depois do primeiro envio ao Play)

Quem instala pela Play Store recebe o app **reassinado pelo Google** com outra chave. É preciso um segundo cliente Android:

1. Play Console › app **Taaki Delivery** › **Testar e lançar** › **Configuração** › **Integridade do app** › **Assinatura do app**.
2. Copie o SHA-1 de **"Certificado da chave de assinatura do app"**. O da "chave de upload" é o do EAS, já cadastrado no passo 1.
3. Google Cloud › Clientes › Criar cliente › Android: nome `App Taaki Delivery (Android, Play)`, mesmo pacote, esse SHA-1.

Sem isso o login funciona no APK de preview e **falha só na versão baixada da Play Store**.

## 3. Google Cloud: cliente OAuth iOS

1. Google Cloud › Clientes › Criar cliente › **iOS**: nome `App Taaki Delivery (iOS)`, ID do pacote `br.com.deliveryabatia.app` (o Team ID e o App Store ID são opcionais).
2. Anote o **ID do cliente** e o **Esquema de URL do iOS** (`com.googleusercontent.apps.<...>`).
3. No EAS, crie as variáveis dos builds iOS (expo.dev › projeto › **Environment variables**, ambientes preview e production; ou `npx eas-cli@latest env:create`):
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` = o ID do cliente iOS
   - `GOOGLE_IOS_URL_SCHEME` = o esquema de URL (sem ele o plugin do Google Sign-In fica de fora e o login com Google no iOS não abre)
4. Railway: acrescente o ID do cliente iOS em `GOOGLE_CLIENT_IDS`.

## 4. Apple: Entrar com Apple

A App Store exige "Entrar com Apple" quando o app oferece login com Google. O botão só aparece no iOS.

1. Conta no **Apple Developer Program** (pago, anual), no nome de quem vai publicar.
2. developer.apple.com › Certificates, Identifiers & Profiles › **Identifiers** › App ID `br.com.deliveryabatia.app` com a capability **Sign In with Apple** marcada. No primeiro `eas build -p ios`, o EAS cria o App ID e liga a capability sozinho, porque o `app.config.js` tem `usesAppleSignIn: true`. Confira depois.
3. A API confere o identity token com as chaves públicas da Apple e aceita `aud` = `br.com.deliveryabatia.app` (padrão; `APPLE_BUNDLE_IDS` muda isso). **Nada mais é preciso para o login funcionar.**
4. **Para revogar o login na Apple ao excluir a conta** (exigência da App Store), crie uma chave:
   - **Keys** › "+" › nome `Taqui Delivery SIWA` › marque **Sign in with Apple** › Configure › App ID primário `br.com.deliveryabatia.app` › Register.
   - Baixe o `.p8`. **Ele só pode ser baixado uma vez**: guarde fora do repositório.
   - Anote o **Key ID**. O **Team ID** fica em Membership details.
   - Railway: `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (o conteúdo do `.p8` numa linha só, trocando cada quebra de linha por `\n`).
   - Sem essas três, o login com Apple funciona e a conta é excluída normalmente, só a Apple não é avisada (a API registra um aviso no log ao iniciar).

## 5. Variáveis no Railway (serviço da API)

| Variável | Valor | Obrigatória? |
|---|---|---|
| `GOOGLE_CLIENT_IDS` | IDs dos clientes Android e iOS, separados por vírgula, sem espaço | Não (o token do app sai com o `aud` do cliente web, já aceito); recomendado |
| `APPLE_BUNDLE_IDS` | vazio (= `br.com.deliveryabatia.app`) | Não |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | ver passo 4 | Só para revogar na Apple ao excluir a conta |

`GOOGLE_CLIENT_ID` continua igual (cliente web). As mesmas chaves já estão no `api/.env.railway` local, vazias: preencha lá também, porque o teste `env-railway.test.js` confere que o arquivo e o código batem.

## 6. Play Console: teste fechado

1. Crie o app: nome "Taaki Delivery", idioma padrão Português (Brasil), App, Gratuito.
2. **Política do app** (Painel › Configurar o app):
   - Política de privacidade: `https://cabana.managerpix.com.br/privacidade-app` (em nome da plataforma). **Rascunho: precisa de revisão jurídica antes da produção** (ver CLAUDE.md).
   - **Exclusão de conta**: marque que o app permite criar conta e informe o link `https://cabana.managerpix.com.br/excluir-conta`. Dentro do app: Perfil › Excluir minha conta.
   - **Segurança dos dados**: coletados nome, e-mail, telefone, endereço (informações pessoais) e histórico de pedidos (compras no app), para funcionalidade do app e gerenciamento da conta; nada compartilhado com terceiros nem usado para anúncios; dados criptografados em trânsito (HTTPS); o usuário pode pedir a exclusão.
   - Acesso ao app: o cardápio abre sem login; para finalizar um pedido é preciso entrar com Google (o revisor usa a própria conta).
   - Anúncios: não. Classificação de conteúdo: questionário (app de delivery, sem conteúdo sensível). Público-alvo: 18+.
3. **Testar e lançar** › **Teste fechado** › crie a faixa › suba o `.aab` do build de produção (comando abaixo) › adicione os testadores por e-mail.
   - Conta de desenvolvedor **pessoal** criada depois de 13/11/2023: o Google exige **pelo menos 12 testadores no teste fechado por 14 dias seguidos** antes de liberar a produção.
4. Depois do primeiro envio, faça o passo 2 (SHA-1 do Play App Signing).

Build de produção (AAB), na pasta `app/`:

```bash
npx eas-cli@latest build -p android --profile production
```

`versionCode` é manual (`app.config.js`, `android.versionCode`; `appVersionSource: local`): **aumente a cada envio** ao Play. O Play recusa um número repetido.

## 7. Conferir

- APK de preview: Continuar com Google › volta logado › Perfil mostra nome e e-mail.
- Pedido de teste com a loja aberta › tela "Pedido nº N recebido!".
- Fechar e reabrir o app depois de mais de um dia: continua logado (refresh de 60 dias).
- Perfil › Excluir minha conta › confirmar › volta ao login. Os pedidos ficam como "Cliente excluído" no PDV/retaguarda.
- `https://cabana.managerpix.com.br/excluir-conta` abre a página e o envio aparece em `GET /api/retaguarda/solicitacoes-exclusao` (dono). Ainda não há tela na retaguarda.
