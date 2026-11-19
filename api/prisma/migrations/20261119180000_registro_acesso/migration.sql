-- Registros de acesso do cliente (Marco Civil, art. 15): login, refresh, envio de pedido
-- e exclusão de conta, com IP e data/hora. Guardados por 6 meses (rotina diária apaga
-- os mais antigos). clienteId sem FK: o registro sobrevive à exclusão da conta.
-- Só aditiva.

-- CreateEnum
CREATE TYPE "EventoAcesso" AS ENUM ('LOGIN', 'REFRESH', 'PEDIDO', 'EXCLUSAO_CONTA');

-- CreateTable
CREATE TABLE "RegistroAcesso" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER,
    "ip" VARCHAR(45) NOT NULL,
    "evento" "EventoAcesso" NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroAcesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistroAcesso_criadoEm_idx" ON "RegistroAcesso"("criadoEm");

-- CreateIndex
CREATE INDEX "RegistroAcesso_clienteId_idx" ON "RegistroAcesso"("clienteId");

