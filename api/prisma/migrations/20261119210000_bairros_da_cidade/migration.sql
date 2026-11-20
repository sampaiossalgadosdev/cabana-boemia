-- Bairros da cidade + área de entrega por loja.
--
-- Antes: Bairro era de uma loja (lojaId, nome, taxaCentavos, ativo).
-- Depois: Bairro = lista única da cidade (nome único, ativo; cadastrada pelo ADMIN) e
-- AreaEntrega (lojaId, bairroId, taxaCentavos, ativo) = onde cada loja entrega e por quanto.
--
-- Os ids dos bairros são mantidos: os endereços dos clientes continuam apontando para
-- o mesmo bairro, que agora vale para qualquer loja. A taxa e o "ativo" de cada loja vão
-- para a AreaEntrega; na cidade todos ficam ativos (desativar era decisão da loja).
-- Se duas lojas tivessem o mesmo nome de bairro, os dois viram um só (o de menor id),
-- com os endereços e as áreas apontando para ele. Para reverter, ver
-- api/prisma/REVERTER_MULTI_LOJA.md.

-- CreateTable
CREATE TABLE "AreaEntrega" (
    "lojaId" INTEGER NOT NULL,
    "bairroId" INTEGER NOT NULL,
    "taxaCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AreaEntrega_pkey" PRIMARY KEY ("lojaId","bairroId")
);

ALTER TABLE "AreaEntrega" ADD CONSTRAINT "AreaEntrega_taxa_check" CHECK ("taxaCentavos" >= 0);

-- Taxas e "ativo" atuais de cada loja (hoje, só a Cabana) viram a área de entrega dela.
INSERT INTO "AreaEntrega" ("lojaId", "bairroId", "taxaCentavos", "ativo")
SELECT "lojaId", "id", "taxaCentavos", "ativo" FROM "Bairro";

-- Mesmo nome em lojas diferentes = o mesmo bairro da cidade (fica o de menor id).
CREATE TEMP TABLE "_bairro_dup" ON COMMIT DROP AS
SELECT b."id" AS "velho", m."novo"
FROM "Bairro" b
JOIN (SELECT "nome", MIN("id") AS "novo" FROM "Bairro" GROUP BY "nome") m ON m."nome" = b."nome"
WHERE b."id" <> m."novo";

UPDATE "AreaEntrega" a SET "bairroId" = d."novo" FROM "_bairro_dup" d WHERE a."bairroId" = d."velho";
UPDATE "Endereco" e SET "bairroId" = d."novo" FROM "_bairro_dup" d WHERE e."bairroId" = d."velho";
DELETE FROM "Bairro" b USING "_bairro_dup" d WHERE b."id" = d."velho";

-- Na cidade, todos ativos: "não entregar" agora é a área da loja.
UPDATE "Bairro" SET "ativo" = true;

-- DropForeignKey
ALTER TABLE "Bairro" DROP CONSTRAINT "Bairro_lojaId_fkey";

-- DropIndex
DROP INDEX "Bairro_lojaId_nome_key";

-- AlterTable
ALTER TABLE "Bairro" DROP COLUMN "lojaId",
DROP COLUMN "taxaCentavos";

-- CreateIndex
CREATE INDEX "AreaEntrega_bairroId_idx" ON "AreaEntrega"("bairroId");

-- CreateIndex
CREATE UNIQUE INDEX "Bairro_nome_key" ON "Bairro"("nome");

-- AddForeignKey
ALTER TABLE "AreaEntrega" ADD CONSTRAINT "AreaEntrega_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaEntrega" ADD CONSTRAINT "AreaEntrega_bairroId_fkey" FOREIGN KEY ("bairroId") REFERENCES "Bairro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
