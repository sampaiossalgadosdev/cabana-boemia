-- Identidade visual por loja (só aditiva).
-- Padrão definido pelo ADMIN (o dono personaliza corPrimaria/logoUrl e pode voltar a ele)
-- e as imagens enviadas (logo), guardadas no banco e servidas em /api/publico/imagens/:id.

ALTER TABLE "Loja" ADD COLUMN "corPrimariaPadrao" VARCHAR(7);
ALTER TABLE "Loja" ADD COLUMN "logoUrlPadrao" VARCHAR(500);
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_corPrimariaPadrao_check"
  CHECK ("corPrimariaPadrao" IS NULL OR "corPrimariaPadrao" ~ '^#[0-9A-Fa-f]{6}$');

-- O que cada loja tem hoje vira o padrão dela (a Cabana: o vermelho #C8102E).
UPDATE "Loja" SET "corPrimariaPadrao" = "corPrimaria", "logoUrlPadrao" = "logoUrl";

CREATE TABLE "ImagemLoja" (
    "id" SERIAL NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "mime" VARCHAR(20) NOT NULL,
    "dados" BYTEA NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagemLoja_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImagemLoja_lojaId_idx" ON "ImagemLoja"("lojaId");

ALTER TABLE "ImagemLoja" ADD CONSTRAINT "ImagemLoja_lojaId_fkey"
  FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImagemLoja" ADD CONSTRAINT "ImagemLoja_mime_check"
  CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "ImagemLoja" ADD CONSTRAINT "ImagemLoja_tamanho_check"
  CHECK (octet_length("dados") BETWEEN 1 AND 512000);
