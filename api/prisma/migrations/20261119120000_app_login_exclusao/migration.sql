-- App Delivery Abatiá: Entrar com Apple (Cliente.appleId), refresh token do cliente
-- (RefreshTokenCliente, só o app usa; o site segue com o JWT de 7 dias) e pedidos de
-- exclusão de conta pela página pública /excluir-conta (SolicitacaoExclusao).
-- Só aditiva: nada existente muda.

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "appleId" TEXT;

-- CreateTable
CREATE TABLE "RefreshTokenCliente" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshTokenCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitacaoExclusao" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(100),
    "email" VARCHAR(200),
    "telefone" VARCHAR(20),
    "mensagem" VARCHAR(500),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendidaEm" TIMESTAMP(3),

    CONSTRAINT "SolicitacaoExclusao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshTokenCliente_hash_key" ON "RefreshTokenCliente"("hash");

-- CreateIndex
CREATE INDEX "RefreshTokenCliente_clienteId_idx" ON "RefreshTokenCliente"("clienteId");

-- CreateIndex
CREATE INDEX "SolicitacaoExclusao_criadoEm_idx" ON "SolicitacaoExclusao"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_appleId_key" ON "Cliente"("appleId");

-- AddForeignKey
ALTER TABLE "RefreshTokenCliente" ADD CONSTRAINT "RefreshTokenCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

