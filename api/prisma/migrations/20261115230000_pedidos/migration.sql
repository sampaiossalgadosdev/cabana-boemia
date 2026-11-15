-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "chaveIdempotencia" TEXT;

-- CreateTable
CREATE TABLE "ContadorPedido" (
    "dataRef" DATE NOT NULL,
    "ultimo" INTEGER NOT NULL,

    CONSTRAINT "ContadorPedido_pkey" PRIMARY KEY ("dataRef")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_chaveIdempotencia_key" ON "Pedido"("chaveIdempotencia");


-- Defesa no banco: saldo de estoque nunca negativo (o Prisma não modela CHECK).
-- A baixa já é condicionada (estoque >= qtd); isto barra qualquer bug futuro.
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_estoque_nao_negativo" CHECK ("estoque" IS NULL OR "estoque" >= 0);
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_estoque_nao_negativo" CHECK ("estoque" >= 0);
