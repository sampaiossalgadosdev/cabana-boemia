# Mapas no Taaki Delivery: Google Cloud, Railway e EAS

Passo a passo para ligar o pino do endereço no mapa (app), o pino da loja (retaguarda) e a distância pelas ruas (pedido no PDV). **Nenhuma chave vai para o código, o git ou este documento**: cada uma fica só no Google Cloud e no lugar indicado abaixo.

Sem nenhuma chave, tudo continua funcionando: o app mostra o endereço sem mapa, a retaguarda pede a latitude e a longitude da loja digitadas e a distância dos pedidos fica estimada (linha reta × 1,3).

## Como funciona (para saber o que cada chave faz)

- **App (Android e iPhone)**: só **mostra o mapa** (Maps SDK). A busca do endereço digitado e a distância **não** são feitas pelo app: ele pede à API.
- **API (Railway)**: faz o **Geocoding** (texto → pino) e o **Routes** (distância de carro, da loja até o pino do cliente), com limite por dia, cache de 30 dias e, se falhar, a linha reta × 1,3 marcada como "estimada".
- **Retaguarda (/admin)**: mostra o mapa do pino da loja (Maps JavaScript). A busca também vai pela API.

Por isso são **quatro chaves** separadas, cada uma presa a um uso:

- **Servidor**: Geocoding API + Routes API. Fica só no Railway.
- **App Android**: Maps SDK for Android, presa ao pacote `br.com.taaki.app` e aos SHA-1 de assinatura. Vai no build pelo EAS.
- **App iOS** (quando houver build de iPhone): Maps SDK for iOS, presa ao bundle `br.com.taaki.app`. Vai no build pelo EAS.
- **Retaguarda (web)**: Maps JavaScript API, presa aos endereços de `/admin`. Fica no Railway (a API entrega à retaguarda, como faz com o ID do login do Google).

As chaves do app e da web ficam visíveis para quem inspecionar o app ou a página (é assim que o Google funciona); o que as protege são as **restrições** do passo 3. A do servidor nunca sai do Railway.

## 1. Google Cloud: projeto e faturamento

1. Use o **mesmo projeto do Google Cloud** do login (o do cliente web do site). Não é obrigatório, mas deixa tudo num lugar só.
2. Google Maps Platform exige **conta de faturamento** ligada ao projeto (Faturamento › Vincular uma conta). Há uma faixa gratuita por mês em cada serviço; confira os valores atuais em `https://mapsplatform.google.com/pricing/` (os preços mudam). Os mapas no celular (Maps SDK) não são cobrados por exibição.

## 2. Google Cloud: ativar as APIs

APIs e serviços › Biblioteca, ative:

- **Geocoding API**
- **Routes API** (não é a "Directions API" antiga)
- **Maps SDK for Android**
- **Maps SDK for iOS** (pode deixar para quando houver build de iPhone)
- **Maps JavaScript API**

## 3. Google Cloud: criar as chaves (APIs e serviços › Credenciais › Criar credenciais › Chave de API)

Crie uma chave por vez, dê um nome claro e já aplique as restrições antes de usar.

**Taaki Mapas (servidor)**

- Restrições de API: só **Geocoding API** e **Routes API**.
- Restrições de aplicativo: **Nenhuma**. O Railway não tem IP fixo, então a restrição por IP não funciona; a proteção é a chave nunca sair do servidor e o limite diário (passo 5).

**Taaki Mapas (Android)**

- Restrições de aplicativo: **Apps Android**. Adicione o pacote `br.com.taaki.app` com **cada SHA-1** que pode assinar o app instalado: os da página "Assinatura de apps" da Play Console (hoje três: chave clássica atual, chave anterior e chave pós-quântica) e o da **chave de upload do EAS**. São os mesmos SHA-1 dos clientes OAuth Android do login; veja onde pegar cada um em [`CONFIGURACAO_LOGIN.md`](CONFIGURACAO_LOGIN.md) (seções 1 e 2).
- Restrições de API: só **Maps SDK for Android**.
- Faltando um SHA-1, o mapa aparece **cinza** nos aparelhos com o app assinado por aquela chave (o resto do app funciona).

**Taaki Mapas (iOS)** (quando houver build de iPhone)

- Restrições de aplicativo: **Apps iOS**, bundle `br.com.taaki.app`.
- Restrições de API: só **Maps SDK for iOS**.

**Taaki Mapas (retaguarda)**

- Restrições de aplicativo: **Sites (referenciadores HTTP)**, um por linha:
  - `https://api.taakidelivery.com.br/admin/*`
  - `https://cabana.managerpix.com.br/admin/*` (enquanto o domínio da Cabana existir)
  - `https://cabana-boemia-production.up.railway.app/admin/*`
  - `http://localhost:5174/*` e `http://localhost:3000/admin/*` (só se quiser testar no seu computador)
- Restrições de API: só **Maps JavaScript API**.

## 4. Google Cloud: alerta de orçamento e cota por dia (proteção extra)

1. **Faturamento › Orçamentos e alertas › Criar orçamento**: escopo = este projeto, valor mensal pequeno (por exemplo o que você aceita gastar no mês), alertas em 50%, 90% e 100% para o seu e-mail. O alerta **avisa, não bloqueia**.
2. **APIs e serviços › Geocoding API › Cotas** e **Routes API › Cotas**: dá para baixar o "por dia" para um pouco acima dos limites do passo 5. É uma segunda trava, do lado do Google, caso a API seja enganada.

## 5. Railway (serviço "Taaki Delivery")

Variables › Raw Editor, acrescente (os nomes já estão no `api/.env.example`; o valor real só aqui):

- `GOOGLE_MAPS_SERVER_KEY` = a chave **Taaki Mapas (servidor)**.
- `GOOGLE_MAPS_WEB_KEY` = a chave **Taaki Mapas (retaguarda)**.
- Opcionais (vazias = padrão):
  - `MAPAS_LIMITE_GEOCODING_DIA`: buscas de endereço por dia (padrão 300). Passou: o cliente posiciona o pino à mão.
  - `MAPAS_LIMITE_ROTAS_DIA`: cálculos de distância por dia (padrão 500). Passou: distância estimada. Pedidos para o mesmo lugar (até ~11 m) usam o cache e não contam.
  - `MAPAS_CENTRO`: centro da cidade `latitude,longitude` (padrão: Abatiá-PR). Pino a mais de 60 km dali é recusado.
  - `TAXA_KM_BASE_CENTAVOS` e `TAXA_KM_POR_KM_CENTAVOS`: fórmula da taxa por km (padrão 100 e 90). **Ainda não é cobrada**: fica pronta para a entrega pela plataforma.

Salvar reinicia o serviço. Sem a chave do servidor, o log de cada deploy avisa `GOOGLE_MAPS_SERVER_KEY ausente`.

Também acrescente as mesmas linhas, **vazias**, no seu `api/.env.railway` local (o teste `env-railway` confere que todas existem; o arquivo não vai para o git).

**Acompanhar o uso**: o log do Railway tem uma linha por chamada ao Google, só com a contagem (`[mapas] 2026-11-25 rotas: 13/500`), e um aviso quando o limite do dia acaba. O ADMIN também vê os últimos 30 dias em `GET /api/plataforma/mapas/uso` (com o token do ADMIN; ainda sem tela).

## 6. EAS (build do app)

As chaves do app entram no build por variável de ambiente do EAS (o `app.config.js` lê `GOOGLE_MAPS_ANDROID_KEY` e `GOOGLE_MAPS_IOS_KEY`; não use o prefixo `EXPO_PUBLIC_`). Na pasta `app/`:

```
npx eas-cli@latest env:create --name GOOGLE_MAPS_ANDROID_KEY --value "<a chave Taaki Mapas (Android)>" --environment production --environment preview --environment development --visibility sensitive
```

Quando houver build de iPhone, o mesmo com `GOOGLE_MAPS_IOS_KEY` e a chave iOS. (Também dá para criar pelo site: expo.dev › projeto `delivery-abatia` › Environment variables.)

Depois, **um build novo** (o versionCode 5 já está no `app.config.js`): `npx eas-cli@latest build -p android --profile production`. O versionCode 4 instalado não tem mapa nem pede localização, e continua funcionando.

Para testar no seu computador com `npx expo start`, ponha `GOOGLE_MAPS_ANDROID_KEY=...` no `app/.env.local` (ignorado pelo git). No Expo Go o mapa usa a chave do próprio Expo Go.

## 7. Play Console e App Store

- **Segurança dos dados**: acrescente **Local › Local exato** e **Local aproximado** (coletados, opcionais, compartilhados com a loja do pedido, finalidade Funcionalidade do app; sem localização em segundo plano). Rascunho completo em [`PUBLICACAO.md`](PUBLICACAO.md), seção 4.
- **App Store › Privacidade do app**: Localização › Localização precisa, vinculada ao usuário, Funcionalidade do app (seção 5 do `PUBLICACAO.md`).
- A política de privacidade (`/privacidade-app`) já fala da localização (versão `2026-11-25`): quem já tinha conta aceita de novo ao abrir o app.

## 8. Conferir

1. **Retaguarda** › Perfil da loja › Localização da loja: o mapa aparece, "Buscar no mapa" encontra o endereço, arrastar o pino e "Salvar localização". Sem a chave web, aparecem os campos de latitude e longitude.
2. **App** (build com a chave): Perfil › endereço › "Buscar no mapa" coloca o pino; "Usar minha localização" pede a permissão "Durante o uso do app" e move o pino; arrastar não muda o texto.
3. **Pedido** pelo app: no PDV, o detalhe mostra "Distância: X km" (sem "(estimada)" quando a chave do servidor está certa) e "Abrir no mapa"; o cupom sai com o QR (confira antes com o "Imprimir teste" na tela Impressora: se a térmica não imprimir QR, desligue a opção ali).
4. **Log do Railway**: linhas `[mapas] … rotas: N/500` a cada distância nova.
