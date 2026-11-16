# Roteiro de demonstração (10 minutos)

Mostra o sistema inteiro funcionando de ponta a ponta: o cliente pede pelo celular e o cupom sai no balcão; a atendente lança um pedido do WhatsApp; o salão usa comanda com prato por quilo; o estoque tira lanche do site sozinho; o dono fecha o dia no relatório.

## Antes da demonstração (na véspera ou 30 minutos antes)

1. **PDV instalado no computador do balcão** (`Cabana Boemia PDV Setup <versão>.exe`).
   - O instalador não tem assinatura digital, então o Windows mostra **"O Windows protegeu o computador"** / **editor desconhecido**. Clique em **Mais informações** e depois em **Executar assim mesmo**. Isso só acontece na instalação.
   - Na primeira abertura, informe o servidor **`https://cabana.managerpix.com.br`** (sem `/api`) e escolha a impressora térmica e a largura do papel. Clique em **Imprimir teste**: o cupom tem que sair com acentos e cortar.
2. **Login com Google do site:** já configurado e em produção (qualquer conta Google entra; ver README › Google).
3. **Bairros cadastrados** na retaguarda (**Bairros e taxas**), com as taxas reais. Sem bairro, o cliente não consegue cadastrar o endereço no site.
4. **Loja aberta na hora da demo.** O site só aceita pedidos no turno ativo. Na retaguarda (`/admin` › **Turnos e horários**), confira se há horário cobrindo a demo; se não houver, crie um temporário no turno Lanches (e apague depois).
5. **WhatsApp do restaurante** preenchido em **Configurações** (aparece no link de cancelamento do site).
6. **Dados de demonstração.** Rode **uma vez no dia** da demo:
   - no computador de desenvolvimento: `npm run seed:demo`
   - no Railway (produção): `railway ssh -- "cd api && node scripts/seed-demo.js --confirmar"`

   O script cria 5 clientes, 8 pedidos do dia (site, WhatsApp e salão; 5 finalizados nas 4 formas, 2 abertos na fila, 1 cancelado), 2 comandas abertas (Família Silva com prato por quilo e Seu Zé), abre o caixa (R$ 100,00 de fundo) se estiver fechado e deixa o **Pão de lanche com 5 unidades** (o X-Bacon do passo 1 e o X-Tudo do passo 2 gastam 2; sobram 3 para o passo 4). Os cupons desses pedidos ficam como já impressos (a impressora não solta nada ao abrir). Se não houver bairro cadastrado, cria "Centro" e "Jardim Primavera"; se o "Prato por kg" estiver sem preço, ativa a R$ 59,90/kg.

   Os pedidos de demonstração entram no relatório e no caixa do dia. No sistema de produção, faça a demo **antes de começar a vender de verdade** (ou num dia sem movimento).
7. **No celular:** abra o site (`https://cabana.managerpix.com.br`) e deixe na tela do cardápio. **No balcão:** PDV aberto e logado, som ligado. **Num notebook:** retaguarda aberta e logada como dono.

## Roteiro

### 1. Pedido pelo site sai na impressora (0:00 a 2:30)

1. No celular: mostre o cardápio por categoria, toque em **X-Bacon**, escreva a observação "sem cebola" e adicione. Adicione uma **Coca-Cola 2L**.
2. **Ver carrinho** › **Continuar** › **Fazer login com o Google** › escolha a conta. No primeiro acesso o site pede o telefone; depois, o endereço (bairro com a taxa).
3. Escolha **Pix**, confira o resumo (itens, taxa, total) e toque em **Enviar pedido**. A tela mostra o número do pedido, a previsão de entrega e o botão de cancelamento pelo WhatsApp.
4. No balcão, em cerca de 1 segundo: o PDV toca o alerta, o pedido aparece na fila e **o cupom sai na impressora** com a observação em negrito.
5. No PDV, clique em **Finalizar** no cartão (Pix já vem marcado).

### 2. Pedido do WhatsApp no PDV (2:30 a 4:30)

1. No PDV, aperte **F2**. Digite "diego" e Enter: o cadastro do Diego Rocha aparece com telefone e endereço para confirmar.
2. Na grade, toque em **X-Tudo** e **Refrigerante Lata** (repare no "restam N" e nos itens esgotados desabilitados).
3. Pagamento **Dinheiro**, troco para **R$ 100,00**: o PDV mostra quanto levar de troco. **Confirmar**.
4. "Pedido #N lançado": entra na fila e o cupom sai na impressora.

### 3. Comanda do salão com peso (4:30 a 6:30)

1. Aba **Salão**: as comandas abertas (Família Silva, mesa 4; Seu Zé, mesa 7) com total parcial e tempo aberta.
2. **+ Nova comanda** › nome "Joana", mesa 3.
3. **Prato por kg** › digite **530** (gramas) › o valor aparece antes de lançar › Enter.
4. Toque em **Suco 300ml**. Os itens entram na hora (e baixam o estoque na hora).
5. **Fechar conta** › **Crédito** › marque **Imprimir conta** › o cupom da conta sai com o peso, o preço do quilo e o total.

### 4. Pão acabando e lanche sumindo do site (6:30 a 8:30)

1. Na retaguarda, **Estoque**: o **Pão de lanche** está com 3 (o X-Bacon e o X-Tudo dos passos anteriores já gastaram 2).
2. No PDV, abra a comanda do **Seu Zé** e lance **3 X-Burguer** (cada toque gasta 1 pão).
3. Na retaguarda, **Estoque**: pão em 0. No celular, puxe o cardápio (ou espere até 30 segundos): **todos os lanches que usam pão de lanche sumiram do site**. O Cachorro Quente continua (usa outro pão). No PDV, os lanches aparecem esgotados.
4. Na retaguarda, **Estoque** › **Entrada** de 20 pães de lanche: os lanches voltam ao site na próxima atualização.

### 5. Relatório do dia (8:30 a 10:00)

1. Na retaguarda, **Relatório do dia**: total vendido, número de pedidos, ticket médio, taxas de entrega, vendas por forma de pagamento e por canal, produtos mais vendidos (por quantidade e por valor), o pedido cancelado e os itens removidos à parte.
2. Em **Caixas do dia**: abertura, fundo de troco e vendas em dinheiro.
3. **Imprimir fechamento do dia**: o resumo sai na impressora do balcão.

## Se algo falhar na hora

| Sintoma | O que fazer |
|---|---|
| Cupom não saiu | Indicador "Impressora" na barra do PDV: papel, tampa, cabo. Ao resolver, sai sozinho (uma vez só). Log em `%APPDATA%\Cabana Boemia PDV\logs\impressao.log`. |
| "Estamos fechados agora" no site | Falta horário do turno cobrindo agora (passo 4 da preparação). |
| Botão do Google não aparece ou dá erro | Abra o site pelo endereço `https://cabana.managerpix.com.br` (origem autorizada no Google); confira `GOOGLE_CLIENT_ID` no Railway. |
| "Abrir caixa" no lugar da tela principal | Abra o caixa com o fundo de troco (o seed:demo abre se não houver). |
| PDV "Reconectando…" | Internet do balcão. Pedidos feitos nesse meio tempo imprimem quando a conexão voltar. |
