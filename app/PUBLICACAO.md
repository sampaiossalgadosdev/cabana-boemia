# Publicar o app Taaki Delivery (Google Play e App Store)

Passo a passo de build, envio, versão e dos formulários de privacidade das lojas. O login (Google Cloud, Apple, chaves) está em [`CONFIGURACAO_LOGIN.md`](CONFIGURACAO_LOGIN.md); faça aquele antes do primeiro envio.

> As respostas de privacidade abaixo são um **rascunho baseado no que o código coleta hoje** (versão 0.3.0). Se o app passar a coletar outra coisa (localização, notificações, analytics, SDK de anúncio), refaça os dois formulários **e** a política de privacidade (`/privacidade-app`, versão nova em `api/src/lib/controlador.js › DOCUMENTOS_APP`).

## 1. Versão (regra)

`app.config.js`, com `appVersionSource: local` no `eas.json` (o número vem do arquivo, não do EAS):

| Campo | O que é | Quando muda |
|---|---|---|
| `version` (hoje `0.3.0`) | versão que o cliente vê | a cada versão publicada (0.3.1 correção, 0.4.0 novidade) |
| `android.versionCode` (hoje `3`) | número interno do Play | **+1 a cada AAB enviado ao Play**, mesmo que o anterior tenha sido recusado ou só testado. O Play recusa número repetido ou menor. Nunca volta. |
| `ios.buildNumber` (hoje `"3"`) | número interno da App Store | **+1 a cada build enviado à App Store Connect** (mesma regra) |

Mude os três no mesmo commit (`chore(app): versão X (versionCode N, buildNumber N)`), junto com `"version"` do `app/package.json`.

Histórico: 1 = primeiro teste, 2 = multi-loja (0.2.0), 3 = anúncios, aceite e Sobre (0.3.0).

## 2. Build

Na pasta `app/`, logado no EAS (`npx eas-cli@latest whoami` → `sampaio040826`):

```bash
# Android
npx eas-cli@latest build -p android --profile production   # AAB para o Play
npx eas-cli@latest build -p android --profile preview      # APK para instalar direto no celular (teste)

# iOS (precisa da conta Apple Developer paga e do cliente OAuth iOS)
GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.XXXX npx eas-cli@latest build -p ios --profile production
```

- O build roda na nuvem do EAS; o link do arquivo aparece no fim (e em expo.dev › Builds).
- O perfil `production` já leva `EXPO_PUBLIC_API_URL=https://cabana.managerpix.com.br`.
- A chave de assinatura Android (keystore) está guardada no EAS desde o primeiro build. **Não apague** em expo.dev › Credentials: sem ela, não dá para atualizar o app no Play (a não ser pelo Play App Signing, ver abaixo).
- No iOS, a variável `GOOGLE_IOS_URL_SCHEME` liga o plugin do Google Sign-In; pode ficar em expo.dev › Project › Environment variables (ambiente production) para não digitar.

## 3. Envio

### Google Play

1. **O primeiro AAB vai à mão** (o Google exige): Play Console › Taaki Delivery › Testes › Teste interno (ou fechado) › Criar versão › enviar o `.aab` baixado do EAS. Aceite o **Play App Signing** (o Google guarda a chave final; a do EAS vira chave de upload).
2. Depois do primeiro, pelo EAS:
   ```bash
   npx eas-cli@latest submit -p android --latest
   ```
   Precisa de uma **conta de serviço** do Google Cloud com acesso ao Play Console (Play Console › Usuários e permissões › convidar o e-mail da conta de serviço com "Lançar apps em faixas de teste"). Guarde a chave JSON no EAS (`npx eas-cli@latest credentials -p android` › Google Service Account) — **nunca** no git. O `eas.json` manda para a faixa **interna, como rascunho**: a promoção para fechado/produção é feita no Play Console.
3. Depois do primeiro envio, cadastre o SHA-1 do **Play App Signing** no Google Cloud (passo 2 do `CONFIGURACAO_LOGIN.md`), senão o login com Google falha no app baixado do Play.

### App Store

```bash
npx eas-cli@latest submit -p ios --latest
```

O EAS pede o login da Apple (ou uma chave da App Store Connect API) e cria o app na App Store Connect se ainda não existir (`br.com.taaki.app`). O build cai no TestFlight; a revisão é pedida na App Store Connect.

## 4. Google Play › Segurança dos dados (rascunho)

**Visão geral**

| Pergunta | Resposta |
|---|---|
| O app coleta ou compartilha dados do usuário? | Sim |
| Todos os dados são criptografados em trânsito? | Sim (só HTTPS) |
| Oferece um jeito de pedir a exclusão dos dados? | Sim: no app (Perfil › Excluir minha conta) e em `https://cabana.managerpix.com.br/excluir-conta` |
| O app contém anúncios? (pergunta separada, em "Anúncios") | **Sim**: carrossel "Patrocinado" no Início. Sem SDK de anúncio, sem ID de publicidade, igual para todos |

**Tipos de dados**

| Tipo (categoria do Play) | Coletado | Compartilhado | Obrigatório? | Finalidades |
|---|---|---|---|---|
| Informações pessoais › Nome | Sim | Sim (a loja do pedido) | Obrigatório | Funcionalidade do app; Gerenciamento da conta; Publicidade ou marketing* |
| Informações pessoais › Endereço de e-mail | Sim | Não | Obrigatório | Gerenciamento da conta; Publicidade ou marketing* |
| Informações pessoais › IDs do usuário | Sim (id da conta, id do Google/Apple) | Não | Obrigatório | Gerenciamento da conta; Prevenção de fraude e segurança |
| Informações pessoais › Endereço | Sim | Sim (a loja do pedido) | Obrigatório | Funcionalidade do app |
| Informações pessoais › Número de telefone | Sim | Sim (a loja do pedido) | Obrigatório | Funcionalidade do app; Publicidade ou marketing* |
| Informações financeiras › Histórico de compras | Sim (pedidos: itens, valores, forma de pagamento) | Sim (a loja do pedido) | Obrigatório | Funcionalidade do app |
| Mensagens/Conteúdo › Outro conteúdo gerado pelo usuário | Sim (observações do item e do pedido) | Sim (a loja do pedido) | Opcional | Funcionalidade do app |

\* Só para quem ligou **Perfil › Comunicações** (opcional, desligado por padrão). Hoje o app não envia mensagens de marketing; deixe marcado para não precisar refazer o formulário quando enviar.

Observações para decidir com calma:

- **"Compartilhado" com a loja**: o Play não conta como compartilhamento o que vai a um terceiro por ação do usuário quando ele espera isso (fazer o pedido numa loja). Mesmo assim, o rascunho marca "compartilhado" para nome, telefone, endereço, compras e observações: é a opção conservadora (declarar a mais não gera problema; declarar a menos, sim).
- **Endereço IP e data/hora** (registros de acesso do Marco Civil, guardados 6 meses): o Play não tem um tipo "endereço IP". Como o app **não** deduz localização pelo IP, não marque "Localização aproximada". Se o Google questionar, a finalidade é "Prevenção de fraude, segurança e conformidade".
- **Não coletados**: localização, contatos, fotos, arquivos, áudio, saúde, dados de cartão, identificadores do aparelho/ID de publicidade, histórico de navegação, diagnósticos/falhas (não há Crashlytics nem analytics), atividade no app (nenhum toque em anúncio ou tela é registrado).
- **Login com Google/Apple**: os provedores recebem só o pedido de login; não é compartilhamento pelo app.

**Outros formulários do Play Console**

- **Público-alvo**: 18 anos ou mais (a política diz que o app é para maiores de 18). Não marque faixas infantis: o app não é para crianças e os anúncios não podem ser dirigidos a elas (declaração obrigatória no cadastro do anúncio).
- **Anúncios**: "Sim, meu app contém anúncios".
- **Classificação de conteúdo** (questionário IARC): categoria "Todos os outros tipos de app"; sem violência, sexo, linguagem, drogas; **sem** compras no app (o pagamento é na entrega); usuários **não** interagem entre si; compartilha dados com terceiros (a loja) = sim; anúncios = sim.
- **Acesso ao app**: as telas de pedido exigem login. Crie uma conta Google de teste para o revisor, ou explique: "O cardápio de todas as lojas abre sem login. Para pedir, toque em Continuar com Google".
- **Política de privacidade**: `https://cabana.managerpix.com.br/privacidade-app`.
- **App de serviços financeiros / saúde / governo / notícias**: não.

## 5. App Store › Privacidade do app (rótulos)

App Store Connect › App › Privacidade do app:

- **Rastreamento**: **Não** (sem IDFA, sem SDK de terceiros, sem cruzar dados com outras empresas). Não precisa do pedido de permissão do App Tracking Transparency.
- **Dados vinculados a você** (todos ligados à conta):

| Categoria Apple | Dado | Finalidades |
|---|---|---|
| Informações de contato | Nome | Funcionalidade do app; Publicidade ou marketing do desenvolvedor* |
| Informações de contato | E-mail | Funcionalidade do app; Publicidade ou marketing do desenvolvedor* |
| Informações de contato | Número de telefone | Funcionalidade do app; Publicidade ou marketing do desenvolvedor* |
| Informações de contato | Endereço físico | Funcionalidade do app |
| Identificadores | ID do usuário | Funcionalidade do app |
| Compras | Histórico de compras | Funcionalidade do app |
| Conteúdo do usuário | Outro conteúdo do usuário (observações) | Funcionalidade do app |
| Outros dados | Outros tipos de dados (IP e data/hora de login, renovação, pedido e exclusão: registro exigido pelo Marco Civil) | Funcionalidade do app (segurança e obrigação legal) |

\* Só com o consentimento de Perfil › Comunicações.

- **Dados não vinculados a você**: nenhum.
- Os anúncios do carrossel são próprios da plataforma e **não usam** dados do usuário: nada a declarar em "Publicidade de terceiros".
- **URL da política de privacidade**: `https://cabana.managerpix.com.br/privacidade-app`.
- **Exclusão de conta**: dentro do app (exigência 5.1.1(v)), já feito; com conta Apple, o app revoga o "Entrar com Apple" se as variáveis `APPLE_*` estiverem no Railway.
- **Classificação etária**: no questionário, conteúdo todo "nenhum", "Conteúdo gerado pelo usuário" = não (observações só vão à loja), "Anúncios" = sim. Como a política e os termos dizem que o app é para maiores de 18, escolha a faixa **18+** na sobreposição de idade mínima (a Apple passou a ter 13+, 16+ e 18+), para ficar coerente com o texto.
- **Revisão**: em "Informações para a revisão", conta de teste (Apple ID de teste ou explicação de que o cardápio abre sem login) e a observação: "Pagamento feito na entrega, direto ao estabelecimento; o app não vende bens digitais" (evita a pergunta sobre compra dentro do app, diretriz 3.1.3(e)).

## 6. Textos da ficha

### Google Play

**Nome do app** (até 30): `Taaki Delivery`

Embaixo do ícone do celular aparece só **"Taaki"** (`name` do `app.config.js`).

**Descrição curta** (até 80):

> Comida, bebida e outros comércios de Abatiá e região. Pague na entrega.

**Descrição completa** (até 4000):

> O Taaki Delivery reúne os comércios de Abatiá e das cidades vizinhas num app só: restaurantes, lanchonetes, pizzarias, bebidas e outras lojas da região. Veja o cardápio de cada loja, monte sua sacola e receba em casa. O pagamento é feito na entrega, direto com a loja.
>
> COMO FUNCIONA
> • Escolha a loja: o início mostra quem está aberto agora e quando cada uma abre.
> • Monte a sacola, com observação em cada item ("sem cebola", "bem gelada").
> • Entre com sua conta Google (ou Apple, no iPhone) e informe seu celular.
> • Escolha o endereço: o app mostra a taxa de entrega de cada loja para o seu bairro.
> • Envie e acompanhe o número do pedido e a previsão de entrega.
>
> PRÁTICO
> • Repita o último pedido com um toque.
> • Seus endereços ficam salvos para os próximos pedidos.
> • Frete grátis quando a loja oferece, com o quanto falta aparecendo na sacola.
> • Sem internet, o app mostra o último cardápio visto.
>
> PAGAMENTO NA ENTREGA
> O app não pede dados de pagamento. Você paga a loja quando o pedido chega, numa das formas que ela aceita. Para cancelar, fale com a loja pelo WhatsApp: o link aparece na tela do pedido.
>
> SEUS DADOS
> A loja recebe só o necessário para preparar e entregar o seu pedido (nome, telefone, endereço e itens). Receber ofertas é opcional e pode ser desligado no Perfil. Você pode excluir sua conta pelo próprio app.
>
> Tem um comércio em Abatiá ou na região e quer entrar no app? Fale com a gente pelo contato da tela Sobre.

**Imagens**: ícone 512×512 = `app/assets/loja/icone-play-512.png`; destaque 1024×500 = `app/assets/loja/destaque-play-1024x500.png` (os dois **provisórios**, gerados por `scripts/gerar-imagens.ps1`; com a arte final em `app/assets/marca/`, rode o script de novo). Capturas de tela do celular: pelo menos 2 (vitrine com o carrossel, cardápio de uma loja, sacola, pedido enviado), 1080×1920 ou parecido, tiradas num celular real ou no emulador.

**Categoria**: Comidas e bebidas. **E-mail de contato**: o mesmo do `CONTATO_TITULAR_EMAIL`.

### App Store

- **Nome** (30): `Taaki Delivery`
- **Subtítulo** (30): `Abatiá e região na sua casa`
- **Palavras-chave** (100): `delivery,abatiá,região,lanche,pizza,marmita,bebida,restaurante,lanchonete,pedido,entrega,comida`
- **Texto promocional** (170): `Peça comida, bebida e mais dos comércios de Abatiá e região e pague na entrega, direto com a loja.`
- **Descrição**: a mesma do Google Play.
- **URL de suporte**: `https://cabana.managerpix.com.br/termos-app` (ou uma página de contato, quando houver).
- **Categoria**: Comida e bebida.
- Capturas: 6,9" (1320×2868) e 6,5" (1284×2778) no mínimo.
