-- Multi-loja: tabela Loja e lojaId em tudo que é de uma loja só.
--
-- 1. Cria a Loja "cabana-boemia" com os dados da antiga Configuracao (linha id = 1;
--    sem a linha, com os mesmos padrões de antes) e apaga a Configuracao.
-- 2. Acrescenta "lojaId" (preenchido com a Cabana) em Categoria, Produto, Insumo,
--    Turno, Bairro, Pedido, ContadorPedido, Caixa, TrabalhoImpressao e Usuario.
--    HorarioTurno, ProdutoTurno, ProdutoInsumo, ItemPedido e MovimentoCaixa herdam a
--    loja do pai (sem coluna própria).
-- 3. Unicidades por loja: nomes de produto/categoria/bairro/turno/insumo, numeroDia
--    por loja e dia (ContadorPedido com PK [lojaId, dataRef]) e um caixa aberto por loja.
-- 4. Usuario: ADMIN sem loja; DONO e ATENDENTE com loja (CHECK).
--
-- Nenhum id muda e nenhum pedido é reescrito (só ganha o lojaId). Para reverter,
-- ver api/prisma/REVERTER_MULTI_LOJA.md.

-- ───────── Loja ─────────

-- CreateTable
CREATE TABLE "Loja" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "razaoSocial" VARCHAR(150),
    "documento" VARCHAR(14),
    "endereco" VARCHAR(200),
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "logoUrl" VARCHAR(500),
    "corPrimaria" VARCHAR(7),
    "corFundo" VARCHAR(7),
    "descricao" VARCHAR(500),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "tempoEstimadoPadraoMin" INTEGER NOT NULL DEFAULT 40,
    "tempoEstimadoManualMin" INTEGER,
    "tempoManualDefinidoEm" TIMESTAMP(3),
    "horaViradaDia" INTEGER NOT NULL DEFAULT 4,
    "freteGratisAtivo" BOOLEAN NOT NULL DEFAULT false,
    "freteGratisMinimoCentavos" INTEGER,
    "freteGratisWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Loja_slug_key" ON "Loja"("slug");

-- Regras sem suporte no schema Prisma.
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_documento_check"
  CHECK ("documento" IS NULL OR "documento" ~ '^([0-9]{11}|[0-9]{14})$');
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_cores_check"
  CHECK (("corPrimaria" IS NULL OR "corPrimaria" ~ '^#[0-9A-Fa-f]{6}$')
     AND ("corFundo" IS NULL OR "corFundo" ~ '^#[0-9A-Fa-f]{6}$'));
-- As mesmas regras que eram da Configuracao.
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_horaViradaDia_check" CHECK ("horaViradaDia" BETWEEN 0 AND 12);
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_freteGratis_check"
  CHECK (("freteGratisMinimoCentavos" IS NULL OR "freteGratisMinimoCentavos" > 0)
     AND (NOT "freteGratisAtivo" OR "freteGratisMinimoCentavos" IS NOT NULL));

-- Cabana Boemia = loja 1, com a configuração atual (banco novo: os padrões de antes).
INSERT INTO "Loja" (
  "slug", "nome", "whatsapp", "corPrimaria", "corFundo", "ativa", "ordem",
  "tempoEstimadoPadraoMin", "tempoEstimadoManualMin", "tempoManualDefinidoEm", "horaViradaDia",
  "freteGratisAtivo", "freteGratisMinimoCentavos", "freteGratisWhatsapp", "atualizadoEm"
)
SELECT
  'cabana-boemia',
  COALESCE(c."nomeRestaurante", 'Cabana Boemia'),
  COALESCE(c."whatsappNumero", ''),
  '#C8102E',
  '#FBF3E8',
  true,
  0,
  COALESCE(c."tempoEstimadoPadraoMin", 40),
  c."tempoEstimadoManualMin",
  c."tempoManualDefinidoEm",
  COALESCE(c."horaViradaDia", 4),
  COALESCE(c."freteGratisAtivo", false),
  c."freteGratisMinimoCentavos",
  COALESCE(c."freteGratisWhatsapp", true),
  CURRENT_TIMESTAMP
FROM (SELECT 1) AS um
LEFT JOIN "Configuracao" c ON c."id" = 1;

-- DropTable (os dados já estão na Loja)
DROP TABLE "Configuracao";

-- ───────── lojaId: coluna, preenchimento com a Cabana, NOT NULL ─────────

ALTER TABLE "Categoria" ADD COLUMN "lojaId" INTEGER;
UPDATE "Categoria" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Categoria" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Produto" ADD COLUMN "lojaId" INTEGER;
UPDATE "Produto" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Produto" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Insumo" ADD COLUMN "lojaId" INTEGER;
UPDATE "Insumo" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Insumo" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Turno" ADD COLUMN "lojaId" INTEGER;
UPDATE "Turno" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Turno" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Bairro" ADD COLUMN "lojaId" INTEGER;
UPDATE "Bairro" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Bairro" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Pedido" ADD COLUMN "lojaId" INTEGER;
UPDATE "Pedido" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Pedido" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "ContadorPedido" ADD COLUMN "lojaId" INTEGER;
UPDATE "ContadorPedido" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "ContadorPedido" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "Caixa" ADD COLUMN "lojaId" INTEGER;
UPDATE "Caixa" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "Caixa" ALTER COLUMN "lojaId" SET NOT NULL;

ALTER TABLE "TrabalhoImpressao" ADD COLUMN "lojaId" INTEGER;
UPDATE "TrabalhoImpressao" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia');
ALTER TABLE "TrabalhoImpressao" ALTER COLUMN "lojaId" SET NOT NULL;

-- Usuario: hoje só existem DONO e ATENDENTE, todos da Cabana. ADMIN não tem loja.
ALTER TABLE "Usuario" ADD COLUMN "lojaId" INTEGER;
UPDATE "Usuario" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia') WHERE "papel" <> 'ADMIN';
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_loja_check" CHECK (("papel" = 'ADMIN') = ("lojaId" IS NULL));

-- ───────── Unicidades por loja ─────────

-- Número do pedido por loja e dia operacional.
ALTER TABLE "ContadorPedido" DROP CONSTRAINT "ContadorPedido_pkey",
ADD CONSTRAINT "ContadorPedido_pkey" PRIMARY KEY ("lojaId", "dataRef");

DROP INDEX "Pedido_dataRef_numeroDia_key";
CREATE UNIQUE INDEX "Pedido_lojaId_dataRef_numeroDia_key" ON "Pedido"("lojaId", "dataRef", "numeroDia");

DROP INDEX "Produto_nome_key";
CREATE UNIQUE INDEX "Produto_lojaId_nome_key" ON "Produto"("lojaId", "nome");

DROP INDEX "Categoria_nome_key";
CREATE UNIQUE INDEX "Categoria_lojaId_nome_key" ON "Categoria"("lojaId", "nome");

DROP INDEX "Bairro_nome_key";
CREATE UNIQUE INDEX "Bairro_lojaId_nome_key" ON "Bairro"("lojaId", "nome");

DROP INDEX "Turno_nome_key";
CREATE UNIQUE INDEX "Turno_lojaId_nome_key" ON "Turno"("lojaId", "nome");

DROP INDEX "Insumo_nome_key";
CREATE UNIQUE INDEX "Insumo_lojaId_nome_key" ON "Insumo"("lojaId", "nome");

-- Um caixa aberto por loja (índice único parcial; o Prisma não declara).
DROP INDEX "Caixa_um_aberto";
CREATE UNIQUE INDEX "Caixa_um_aberto" ON "Caixa" ("lojaId") WHERE "fechadoEm" IS NULL;

-- Índices das consultas por loja.
DROP INDEX "Caixa_abertoEm_idx";
CREATE INDEX "Caixa_lojaId_abertoEm_idx" ON "Caixa"("lojaId", "abertoEm");

DROP INDEX "TrabalhoImpressao_status_criadoEm_idx";
CREATE INDEX "TrabalhoImpressao_lojaId_status_criadoEm_idx" ON "TrabalhoImpressao"("lojaId", "status", "criadoEm");

CREATE INDEX "Usuario_lojaId_idx" ON "Usuario"("lojaId");

-- ───────── Chaves estrangeiras (loja não se apaga com dados) ─────────

ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bairro" ADD CONSTRAINT "Bairro_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContadorPedido" ADD CONSTRAINT "ContadorPedido_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Caixa" ADD CONSTRAINT "Caixa_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
