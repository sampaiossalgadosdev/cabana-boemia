-- Etapa 5 do pagamento online: aceite da loja, meio do pagamento online no pedido e os estornos.
-- Só aditiva.

-- Pedido pago online: o meio (gravado na criação; nulo = pago na entrega) e o aceite da loja.
ALTER TABLE "Pedido" ADD COLUMN "meioOnline" "MetodoPagamentoOnline";
ALTER TABLE "Pedido" ADD COLUMN "aceitoEm" TIMESTAMP(3);
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_aceite_so_online_check" CHECK ("aceitoEm" IS NULL OR "meioOnline" IS NOT NULL);

-- Pedidos já criados com pagamento online (Etapa 4): o meio vem do primeiro pagamento.
UPDATE "Pedido" p SET "meioOnline" = pg."metodo"
  FROM (SELECT DISTINCT ON ("pedidoId") "pedidoId", "metodo" FROM "Pagamento" ORDER BY "pedidoId", "id") pg
  WHERE pg."pedidoId" = p."id";

-- Estorno: uma linha por tentativa (automática, do ADMIN ou vinda do Mercado Pago).
CREATE TYPE "OrigemEstorno" AS ENUM ('AUTOMATICO', 'ADMIN', 'MERCADO_PAGO');
CREATE TYPE "StatusEstorno" AS ENUM ('PROCESSANDO', 'CONCLUIDO', 'FALHOU', 'RESOLVIDO_POR_FORA');

CREATE TABLE "Estorno" (
    "id" SERIAL NOT NULL,
    "pagamentoId" INTEGER NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "motivo" VARCHAR(300) NOT NULL,
    "origem" "OrigemEstorno" NOT NULL,
    "status" "StatusEstorno" NOT NULL DEFAULT 'PROCESSANDO',
    "idempotencyKey" VARCHAR(64),
    "mpRefundId" VARCHAR(30),
    "erro" VARCHAR(300),
    "observacao" VARCHAR(500),
    "usuarioId" INTEGER,
    "resolvidoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),
    CONSTRAINT "Estorno_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Estorno_valor_check" CHECK ("valorCentavos" > 0),
    CONSTRAINT "Estorno_chave_check" CHECK ("origem" = 'MERCADO_PAGO' OR "idempotencyKey" IS NOT NULL),
    CONSTRAINT "Estorno_concluido_check" CHECK (("status" IN ('CONCLUIDO', 'RESOLVIDO_POR_FORA')) = ("concluidoEm" IS NOT NULL))
);

CREATE UNIQUE INDEX "Estorno_idempotencyKey_key" ON "Estorno"("idempotencyKey");
CREATE INDEX "Estorno_pagamentoId_idx" ON "Estorno"("pagamentoId");
CREATE INDEX "Estorno_status_idx" ON "Estorno"("status");
CREATE INDEX "Estorno_concluidoEm_idx" ON "Estorno"("concluidoEm");

ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "Pagamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Estorno" ADD CONSTRAINT "Estorno_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
