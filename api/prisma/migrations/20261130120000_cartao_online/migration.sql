-- Etapa 7 do pagamento online: cartão pelo Checkout Pro. Só aditiva.

-- Tipo real do pagamento com cartão pelo app (o Mercado Pago informa na aprovação): crédito,
-- débito, pré-pago, saldo Mercado Pago ou outro (ex.: Linha de Crédito). Só no CARTAO_ONLINE.
CREATE TYPE "TipoPagamentoOnline" AS ENUM ('CREDITO', 'DEBITO', 'PRE_PAGO', 'SALDO_MERCADO_PAGO', 'OUTRO');
ALTER TABLE "Pedido" ADD COLUMN "tipoPagamentoOnline" "TipoPagamentoOnline";
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_tipo_online_so_cartao_check"
  CHECK ("tipoPagamentoOnline" IS NULL OR "meioOnline" = 'CARTAO_ONLINE');

-- Link do Checkout Pro (init_point da preferência) para o app abrir de novo ("Tentar de novo").
ALTER TABLE "Pagamento" ADD COLUMN "checkoutUrl" VARCHAR(500);
