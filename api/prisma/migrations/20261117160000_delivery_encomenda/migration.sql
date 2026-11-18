-- Painel de delivery/encomendas do PDV.

-- Status internos do PDV (o cliente do site não vê). Contam como "aberto".
ALTER TYPE "StatusPedido" ADD VALUE 'EM_PREPARO' BEFORE 'FINALIZADO';
ALTER TYPE "StatusPedido" ADD VALUE 'SAIU_ENTREGA' BEFORE 'FINALIZADO';

-- Encomenda (agendada no mesmo dia operacional), retirada no balcão, desconto,
-- observação do pedido e pagamento antecipado ("pago agora").
ALTER TABLE "Pedido"
  ADD COLUMN "encomenda" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "agendadoPara" TIMESTAMP(3),
  ADD COLUMN "retirarNoBalcao" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "descontoCentavos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "observacao" VARCHAR(200),
  ADD COLUMN "pagoEm" TIMESTAMP(3);

ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_desconto_check" CHECK ("descontoCentavos" >= 0);
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_encomenda_check" CHECK ("encomenda" = ("agendadoPara" IS NOT NULL));
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_retirada_check"
  CHECK (NOT "retirarNoBalcao" OR ("encomenda" AND "enderecoTexto" IS NULL AND "taxaEntregaCentavos" = 0));
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_pago_check"
  CHECK ("pagoEm" IS NULL OR ("formaPagamento" IS NOT NULL AND "caixaId" IS NOT NULL));

-- Cliente: anotação da equipe. Endereço: CEP, cidade e estado (preenchidos no PDV).
ALTER TABLE "Cliente" ADD COLUMN "observacao" VARCHAR(300);
ALTER TABLE "Endereco"
  ADD COLUMN "cep" VARCHAR(8),
  ADD COLUMN "cidade" VARCHAR(60),
  ADD COLUMN "estado" VARCHAR(30);
