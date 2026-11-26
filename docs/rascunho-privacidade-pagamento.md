# Rascunho: política de privacidade e termos do app com o pagamento online

**PENDENTE DE REVISÃO JURÍDICA. NÃO PUBLICADO.** Escrito em 2026-11-25 (Etapa 4 do pagamento online, Decisão 10). Nada aqui está no ar: a página `/privacidade-app` e os `/termos-app` (`api/src/routes/legal.routes.js`) continuam com o texto atual, e `DOCUMENTOS_APP.versao` (`api/src/lib/controlador.js`) continua `2026-11-25`.

## Como publicar (quando a revisão jurídica aprovar)

1. Aplicar os trechos abaixo em `api/src/routes/legal.routes.js` (privacidade e termos) e, se for o caso, na página `/excluir-conta` (`api/src/routes/exclusao.routes.js`).
2. Trocar `DOCUMENTOS_APP.versao` e `vigencia` em `api/src/lib/controlador.js` (ex.: `versao: '2026-12-XX'`). **É a troca da versão que faz todo cliente do app aceitar de novo** (tela "Aceitar e continuar"); mudar o texto sem mudar a versão publicaria a mudança sem novo aceite.
3. Publicar antes (ou junto) de ligar `PAGAMENTO_ONLINE_ATIVO=sim` em produção: o Mercado Pago passa a receber dados do pagador a partir do primeiro Pix.
4. Atualizar o formulário "Segurança dos dados" do Play e os rótulos da App Store (`app/PUBLICACAO.md`): e-mail e informações de pagamento (compras) passam a ser compartilhados com o processador de pagamentos.

## Política de privacidade (`/privacidade-app`)

### 1. Dados que coletamos (alterar e acrescentar)

- **Conta** (substitui o item atual): nome e e-mail, recebidos do Google ou da Apple quando você entra. Com a Apple, o e-mail pode ser um endereço de retransmissão criado por ela. Se você entrou com o celular e não tem e-mail na conta, **pedimos o e-mail uma vez quando você escolhe pagar com Pix pelo app** (o processador de pagamentos exige o e-mail do pagador) e o guardamos na sua conta.
- **Telefone** (acrescentar ao item atual): quando você confirma o telefone com o código de 6 números (no login com celular ou no checkout, para ganhar o frete grátis da primeira compra), guardamos que ele foi confirmado e quando.
- **Pagamentos pelo app** (novo): quando você paga com Pix pelo app, guardamos o identificador do pagamento no Mercado Pago, o valor, a situação (pendente, aprovado, expirado, devolvido) e as datas. **Não guardamos dados bancários nem do cartão**: o Pix é pago no app do seu banco.
- **Frete grátis da primeira compra** (novo): para que o benefício valha uma vez por telefone, guardamos um **código irreversível do telefone** (hash HMAC-SHA256 com uma chave secreta), não o número, junto com a situação do benefício (reservado ou usado) e as datas.

### 2. Para que usamos (acrescentar)

- Receber o pagamento do pedido pelo app e conferir com o processador de pagamentos se ele foi aprovado, expirou ou foi devolvido (execução do contrato).
- Conceder o frete grátis da primeira compra uma única vez por telefone e evitar que seja usado de novo, inclusive com outra conta (legítimo interesse de prevenir fraude no benefício).

### 3. Com quem compartilhamos (acrescentar)

- **Mercado Pago** (Mercado Pago Instituição de Pagamento Ltda.), **processador dos pagamentos feitos pelo app**. Quando você paga com Pix pelo app, o Mercado Pago recebe o **valor do pedido, o seu e-mail, o número do pedido e o nome da loja**, para gerar o Pix e confirmar o pagamento. O pagamento é feito na **conta Mercado Pago da loja**; a parte da taxa de entrega que é do Taaki Delivery é separada pelo próprio Mercado Pago. O Mercado Pago trata esses dados conforme a política de privacidade dele e as regras do Banco Central. Pagamentos feitos na entrega não passam pelo Mercado Pago.

*Para a revisão: confirmar se o Mercado Pago recebe dados do pagador também pelo banco do cliente (nome e CPF de quem paga o Pix chegam ao recebedor pelo arranjo Pix) e como isso deve aparecer; confirmar a razão social correta do Mercado Pago para o Brasil.*

### 5. Por quanto tempo guardamos (alterar e acrescentar)

- **Pedidos** (acrescentar ao item atual): o registro do pagamento pelo app (identificador, valor, situação e datas) fica junto do pedido, pelo mesmo prazo.
- **Frete grátis da primeira compra** (novo): o código irreversível do telefone **continua guardado depois da exclusão da conta**, sem ligação com nome, e-mail ou endereço, só para impedir que o benefício seja usado de novo com o mesmo telefone. O número em si não é guardado e não pode ser obtido a partir do código. *Para a revisão: definir o prazo (ex.: enquanto a campanha existir) e a base legal (legítimo interesse; avaliar o teste de balanceamento).*

### 7. Como excluir sua conta (acrescentar)

- Com um Pix aguardando pagamento, a exclusão espera ele ser pago ou expirar (até 15 minutos), como já acontece com um pedido em andamento.
- Depois da exclusão fica, além do que já está descrito, o código irreversível do telefone usado no frete grátis da primeira compra (veja "Por quanto tempo guardamos").

## Termos de uso (`/termos-app`)

### 4. Pagamento (substituir)

Você pode pagar **na entrega** ou, quando a loja oferece, **pelo app com Pix**.

- **Na entrega**: direto à loja ou ao entregador, pelo valor confirmado no app. Em lojas atendidas pelos entregadores do Taaki Delivery, o pagamento na entrega é só em dinheiro.
- **Pix pelo app**: o app mostra o QR code e o código "copia e cola". Você tem **15 minutos** para pagar; o pedido só vai para a loja depois que o pagamento é aprovado. Passado o prazo sem pagamento, o pedido não é enviado e os itens voltam a ficar disponíveis. Se o pagamento for aprovado depois do prazo, o valor é devolvido.
- O pagamento pelo app é processado pelo **Mercado Pago** e cai na conta da loja. A plataforma não guarda dados bancários nem do cartão.
- **Taxa de entrega**: nas lojas atendidas pelos entregadores do Taaki Delivery, a taxa é calculada pela distância da loja até o endereço marcado no mapa (R$ 1,00 + R$ 0,90 por quilômetro de ida e volta). Nas outras lojas, é a taxa que a loja define para o seu bairro.
- **Frete grátis da primeira compra**: quando houver, vale uma vez por telefone confirmado por código, no primeiro pedido feito pelo app.

*Para a revisão: o valor por km está fixo no texto; se mudar (`TAXA_KM_*`), o texto muda e a versão também. Avaliar se é melhor dizer só "calculada pela distância" e mostrar o valor no checkout.*

### 5. Cancelamento (acrescentar)

- Pedido pago pelo app e cancelado pela loja: o valor é devolvido pelo Mercado Pago. *(O estorno automático é da Etapa 5: publicar este trecho só depois dela.)*

## Página `/excluir-conta` (acrescentar ao "o que fica")

- O código irreversível do telefone usado no frete grátis da primeira compra (o número não é guardado).
- O registro dos pagamentos feitos pelo app, junto dos pedidos (registro fiscal).
