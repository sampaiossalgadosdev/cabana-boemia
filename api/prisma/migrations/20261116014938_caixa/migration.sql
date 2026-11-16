-- CreateEnum
CREATE TYPE "TipoMovimentoCaixa" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- AlterEnum
ALTER TYPE "TipoTrabalhoImpressao" ADD VALUE 'FECHAMENTO';

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "caixaId" INTEGER;

-- AlterTable
ALTER TABLE "TrabalhoImpressao" ADD COLUMN     "caixaId" INTEGER,
ALTER COLUMN "pedidoId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Caixa" (
    "id" SERIAL NOT NULL,
    "abertoPorId" INTEGER NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valorInicialCentavos" INTEGER NOT NULL,
    "fechadoPorId" INTEGER,
    "fechadoEm" TIMESTAMP(3),
    "valorContadoCentavos" INTEGER,
    "esperadoCentavos" INTEGER,
    "diferencaCentavos" INTEGER,
    "observacao" TEXT,

    CONSTRAINT "Caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentoCaixa" (
    "id" SERIAL NOT NULL,
    "caixaId" INTEGER NOT NULL,
    "tipo" "TipoMovimentoCaixa" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Caixa_abertoEm_idx" ON "Caixa"("abertoEm");

-- CreateIndex
CREATE INDEX "MovimentoCaixa_caixaId_idx" ON "MovimentoCaixa"("caixaId");

-- CreateIndex
CREATE INDEX "Pedido_caixaId_idx" ON "Pedido"("caixaId");

-- CreateIndex
CREATE INDEX "TrabalhoImpressao_caixaId_idx" ON "TrabalhoImpressao"("caixaId");

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_abertoPorId_fkey" FOREIGN KEY ("abertoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_fechadoPorId_fkey" FOREIGN KEY ("fechadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Regras sem suporte no schema Prisma ─────────

-- Só um caixa aberto por vez: duas aberturas simultâneas, a segunda bate aqui.
CREATE UNIQUE INDEX "Caixa_um_aberto" ON "Caixa" ((true)) WHERE "fechadoEm" IS NULL;

ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_valorInicial_check" CHECK ("valorInicialCentavos" >= 0);
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_valorContado_check" CHECK ("valorContadoCentavos" IS NULL OR "valorContadoCentavos" >= 0);

-- Fechamento é tudo ou nada: aberto = campos de fechamento nulos; fechado = todos preenchidos.
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_fechamento_check" CHECK (
  ("fechadoEm" IS NULL AND "fechadoPorId" IS NULL AND "valorContadoCentavos" IS NULL
    AND "esperadoCentavos" IS NULL AND "diferencaCentavos" IS NULL)
  OR
  ("fechadoEm" IS NOT NULL AND "fechadoPorId" IS NOT NULL AND "valorContadoCentavos" IS NOT NULL
    AND "esperadoCentavos" IS NOT NULL AND "diferencaCentavos" IS NOT NULL)
);

ALTER TABLE "MovimentoCaixa" ADD CONSTRAINT "MovimentoCaixa_valor_check" CHECK ("valorCentavos" > 0);

-- Trabalho de impressão pertence a exatamente um: pedido ou caixa (FECHAMENTO).
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_dono_check"
  CHECK (("pedidoId" IS NULL) <> ("caixaId" IS NULL));
