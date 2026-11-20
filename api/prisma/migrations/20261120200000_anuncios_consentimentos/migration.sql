-- Anúncios do app (carrossel "Patrocinado") e consentimentos do cliente (aceite
-- dos termos/política por versão e marketing opcional). Só aditiva.

-- CreateEnum
CREATE TYPE "TipoConsentimento" AS ENUM ('TERMOS', 'MARKETING_CONCEDIDO', 'MARKETING_REVOGADO');

-- CreateEnum
CREATE TYPE "DestinoAnuncio" AS ENUM ('LOJA', 'LINK');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "marketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketingEm" TIMESTAMP(3),
ADD COLUMN     "termosAceitosEm" TIMESTAMP(3),
ADD COLUMN     "termosVersao" VARCHAR(20);

-- CreateTable
CREATE TABLE "Consentimento" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "tipo" "TipoConsentimento" NOT NULL,
    "versao" VARCHAR(20),
    "ip" VARCHAR(45) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagemAnuncio" (
    "id" SERIAL NOT NULL,
    "mime" VARCHAR(20) NOT NULL,
    "dados" BYTEA NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagemAnuncio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anuncio" (
    "id" SERIAL NOT NULL,
    "anuncianteNome" VARCHAR(150) NOT NULL,
    "anuncianteDocumento" VARCHAR(14) NOT NULL,
    "imagemId" INTEGER NOT NULL,
    "destino" "DestinoAnuncio" NOT NULL,
    "destinoLojaId" INTEGER,
    "destinoUrl" VARCHAR(500),
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "valorPagoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "naoDirigidoACriancas" BOOLEAN NOT NULL,
    "criadoPorId" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Anuncio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consentimento_clienteId_criadoEm_idx" ON "Consentimento"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "Anuncio_inicio_fim_idx" ON "Anuncio"("inicio", "fim");

-- CreateIndex
CREATE INDEX "Anuncio_imagemId_idx" ON "Anuncio"("imagemId");

-- CreateIndex
CREATE INDEX "Anuncio_destinoLojaId_idx" ON "Anuncio"("destinoLojaId");

-- AddForeignKey
ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_imagemId_fkey" FOREIGN KEY ("imagemId") REFERENCES "ImagemAnuncio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_destinoLojaId_fkey" FOREIGN KEY ("destinoLojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───── Regras que o Prisma não declara ─────

ALTER TABLE "Consentimento" ADD CONSTRAINT "Consentimento_versao_termos"
  CHECK (("tipo" = 'TERMOS') = ("versao" IS NOT NULL));

ALTER TABLE "ImagemAnuncio" ADD CONSTRAINT "ImagemAnuncio_mime"
  CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp'));
ALTER TABLE "ImagemAnuncio" ADD CONSTRAINT "ImagemAnuncio_tamanho"
  CHECK (octet_length("dados") BETWEEN 1 AND 512000);

ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_documento"
  CHECK ("anuncianteDocumento" ~ '^([0-9]{11}|[0-9]{14})$');
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_periodo" CHECK ("fim" > "inicio");
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_valor" CHECK ("valorPagoCentavos" >= 0);
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_nao_dirigido_a_criancas" CHECK ("naoDirigidoACriancas" = true);
ALTER TABLE "Anuncio" ADD CONSTRAINT "Anuncio_destino" CHECK (
  ("destino" = 'LOJA' AND "destinoLojaId" IS NOT NULL AND "destinoUrl" IS NULL)
  OR ("destino" = 'LINK' AND "destinoUrl" ~ '^https://' AND "destinoLojaId" IS NULL)
);

-- Registro da veiculação: o anúncio só pode ser apagado 1 ano depois do fim.
CREATE FUNCTION "anuncio_reter_registro"() RETURNS trigger AS $$
BEGIN
  -- "fim" é timestamp sem fuso, em UTC (como todas as datas do Prisma).
  IF OLD."fim" > (now() AT TIME ZONE 'UTC') - interval '1 year' THEN
    RAISE EXCEPTION 'Anúncio % precisa ser guardado até 1 ano depois do fim da veiculação', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Anuncio_reter_registro"
  BEFORE DELETE ON "Anuncio"
  FOR EACH ROW EXECUTE FUNCTION "anuncio_reter_registro"();
