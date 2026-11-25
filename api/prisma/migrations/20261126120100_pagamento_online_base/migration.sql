-- Pagamento online (Mercado Pago, Split 1:1), etapa 2: modelos e regras no banco.
-- Só aditiva, menos "numeroDia" que passa a aceitar nulo (só enquanto aguarda o
-- pagamento; CHECK abaixo). Nenhuma linha existente muda: lojas nascem PROPRIO com
-- o pagamento online desligado, pedidos com origemFreteGratis NENHUM.
-- Plano e decisões: docs/pagamento-online.md.

-- CreateEnum
CREATE TYPE "ModoEntrega" AS ENUM ('PLATAFORMA', 'PROPRIO');

-- CreateEnum
CREATE TYPE "OrigemFreteGratis" AS ENUM ('NENHUM', 'LOJA', 'CAMPANHA');

-- CreateEnum
CREATE TYPE "OrigemTaxaEntrega" AS ENUM ('KM', 'AREA');

-- CreateEnum
CREATE TYPE "StatusConexaoMp" AS ENUM ('CONECTADA', 'EXPIRADA', 'DESCONECTADA');

-- CreateEnum
CREATE TYPE "MetodoPagamentoOnline" AS ENUM ('PIX', 'CARTAO_ONLINE');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'EXPIRADO', 'CANCELADO', 'REEMBOLSADO', 'REEMBOLSO_PARCIAL', 'REEMBOLSO_PENDENTE');

-- CreateEnum
CREATE TYPE "SituacaoCampanha" AS ENUM ('RESERVADO', 'USADO');

-- CreateEnum
CREATE TYPE "TipoLancamentoLoja" AS ENUM ('TAXA_ENTREGA_DINHEIRO', 'TAXA_ENTREGA_COMPLEMENTO', 'CREDITO_CAMPANHA', 'AJUSTE_MANUAL', 'ESTORNO');

-- CreateEnum
CREATE TYPE "StatusFechamento" AS ENUM ('ABERTO', 'AGUARDANDO_PAGAMENTO', 'QUITADO');

-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "modoEntrega" "ModoEntrega" NOT NULL DEFAULT 'PROPRIO',
ADD COLUMN     "pagamentoOnlineAtivo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "origemFreteGratis" "OrigemFreteGratis" NOT NULL DEFAULT 'NENHUM',
ADD COLUMN     "origemTaxaEntrega" "OrigemTaxaEntrega",
ADD COLUMN     "valorEntregadorCentavos" INTEGER,
ADD COLUMN     "valorPlataformaEntregaCentavos" INTEGER,
ALTER COLUMN "numeroDia" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConexaoMercadoPago" (
    "id" SERIAL NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "mpUserId" VARCHAR(30) NOT NULL,
    "accessTokenCifrado" TEXT,
    "refreshTokenCifrado" TEXT,
    "publicKey" VARCHAR(100),
    "expiraEm" TIMESTAMP(3),
    "status" "StatusConexaoMp" NOT NULL DEFAULT 'CONECTADA',
    "conectadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConexaoMercadoPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pagamento" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "metodo" "MetodoPagamentoOnline" NOT NULL,
    "status" "StatusPagamento" NOT NULL DEFAULT 'PENDENTE',
    "mpPaymentId" VARCHAR(30),
    "mpPreferenceId" VARCHAR(80),
    "valorTotalCentavos" INTEGER NOT NULL,
    "valorPlataformaCentavos" INTEGER NOT NULL DEFAULT 0,
    "valorReembolsadoCentavos" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "pixQrCode" TEXT,
    "pixQrCodeBase64" TEXT,
    "dadosMp" JSONB,
    "aprovadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoWebhook" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(200) NOT NULL,
    "tipo" VARCHAR(60) NOT NULL,
    "recursoId" VARCHAR(60),
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),
    "resultado" VARCHAR(200),

    CONSTRAINT "EventoWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsoCampanhaFreteGratis" (
    "id" SERIAL NOT NULL,
    "telefone" VARCHAR(11) NOT NULL,
    "clienteId" INTEGER,
    "pedidoId" INTEGER NOT NULL,
    "situacao" "SituacaoCampanha" NOT NULL DEFAULT 'RESERVADO',
    "reservadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usadoEm" TIMESTAMP(3),

    CONSTRAINT "UsoCampanhaFreteGratis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LancamentoLoja" (
    "id" SERIAL NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "pedidoId" INTEGER,
    "tipo" "TipoLancamentoLoja" NOT NULL,
    "valorCentavos" INTEGER NOT NULL,
    "observacao" VARCHAR(300),
    "fechamentoId" INTEGER,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LancamentoLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FechamentoSemanal" (
    "id" SERIAL NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "saldoCentavos" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusFechamento" NOT NULL DEFAULT 'ABERTO',
    "quitadoEm" TIMESTAMP(3),
    "quitadoPorId" INTEGER,
    "observacao" VARCHAR(300),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FechamentoSemanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConexaoMercadoPago_lojaId_key" ON "ConexaoMercadoPago"("lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_mpPaymentId_key" ON "Pagamento"("mpPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_mpPreferenceId_key" ON "Pagamento"("mpPreferenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_idempotencyKey_key" ON "Pagamento"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Pagamento_pedidoId_idx" ON "Pagamento"("pedidoId");

-- CreateIndex
CREATE INDEX "Pagamento_status_expiraEm_idx" ON "Pagamento"("status", "expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "EventoWebhook_chave_key" ON "EventoWebhook"("chave");

-- CreateIndex
CREATE INDEX "EventoWebhook_recebidoEm_idx" ON "EventoWebhook"("recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "UsoCampanhaFreteGratis_telefone_key" ON "UsoCampanhaFreteGratis"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "UsoCampanhaFreteGratis_pedidoId_key" ON "UsoCampanhaFreteGratis"("pedidoId");

-- CreateIndex
CREATE INDEX "LancamentoLoja_lojaId_criadoEm_idx" ON "LancamentoLoja"("lojaId", "criadoEm");

-- CreateIndex
CREATE INDEX "LancamentoLoja_pedidoId_idx" ON "LancamentoLoja"("pedidoId");

-- CreateIndex
CREATE INDEX "LancamentoLoja_fechamentoId_idx" ON "LancamentoLoja"("fechamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "FechamentoSemanal_lojaId_inicio_key" ON "FechamentoSemanal"("lojaId", "inicio");

-- AddForeignKey
ALTER TABLE "ConexaoMercadoPago" ADD CONSTRAINT "ConexaoMercadoPago_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoCampanhaFreteGratis" ADD CONSTRAINT "UsoCampanhaFreteGratis_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsoCampanhaFreteGratis" ADD CONSTRAINT "UsoCampanhaFreteGratis_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_fechamentoId_fkey" FOREIGN KEY ("fechamentoId") REFERENCES "FechamentoSemanal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FechamentoSemanal" ADD CONSTRAINT "FechamentoSemanal_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FechamentoSemanal" ADD CONSTRAINT "FechamentoSemanal_quitadoPorId_fkey" FOREIGN KEY ("quitadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── Regras (CHECKs) ─────────

-- Número do dia só falta no pedido que espera o pagamento (e no que expirou sem aprovar).
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_numero_dia_check"
  CHECK ("numeroDia" IS NOT NULL OR "status" IN ('AGUARDANDO_PAGAMENTO', 'EXPIRADO'));

-- Entregador da plataforma: origem da taxa e divisão 95/5 juntas, nunca negativas
-- (IS NOT NULL explícito: com um NULL a comparação daria NULL e o CHECK passaria).
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_entrega_plataforma_check"
  CHECK (("origemTaxaEntrega" IS NULL AND "valorEntregadorCentavos" IS NULL AND "valorPlataformaEntregaCentavos" IS NULL)
      OR ("origemTaxaEntrega" IS NOT NULL AND "valorEntregadorCentavos" IS NOT NULL AND "valorPlataformaEntregaCentavos" IS NOT NULL
          AND "valorEntregadorCentavos" >= 0 AND "valorPlataformaEntregaCentavos" >= 0));

-- Conexão CONECTADA sempre tem o access token (cifrado).
ALTER TABLE "ConexaoMercadoPago" ADD CONSTRAINT "ConexaoMercadoPago_token_check"
  CHECK ("status" <> 'CONECTADA' OR "accessTokenCifrado" IS NOT NULL);

-- Valores do pagamento: total positivo; comissão e reembolsado entre 0 e o total.
ALTER TABLE "Pagamento" ADD CONSTRAINT "Pagamento_valores_check"
  CHECK ("valorTotalCentavos" > 0
     AND "valorPlataformaCentavos" >= 0 AND "valorPlataformaCentavos" <= "valorTotalCentavos"
     AND "valorReembolsadoCentavos" >= 0 AND "valorReembolsadoCentavos" <= "valorTotalCentavos");

-- Campanha: data de uso só (e sempre) no USADO; telefone só com os 11 dígitos.
ALTER TABLE "UsoCampanhaFreteGratis" ADD CONSTRAINT "UsoCampanhaFreteGratis_check"
  CHECK ((("situacao" = 'USADO') = ("usadoEm" IS NOT NULL)) AND "telefone" ~ '^[0-9]{11}$');

-- Lançamento nunca é zero.
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_valor_check"
  CHECK ("valorCentavos" <> 0);

-- Fechamento: semana com fim depois do início; QUITADO = data da quitação.
ALTER TABLE "FechamentoSemanal" ADD CONSTRAINT "FechamentoSemanal_check"
  CHECK ("fim" > "inicio" AND (("status" = 'QUITADO') = ("quitadoEm" IS NOT NULL)));

-- Livro-razão só de inserção: não se apaga lançamento e, depois de gravado, só pode
-- ganhar o fechamento (de nulo para um fechamento). Correção = lançamento ESTORNO.
CREATE FUNCTION "lancamento_loja_imutavel"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lançamento % do livro-razão não pode ser apagado', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lojaId" IS DISTINCT FROM OLD."lojaId"
     OR NEW."pedidoId" IS DISTINCT FROM OLD."pedidoId"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo"
     OR NEW."valorCentavos" IS DISTINCT FROM OLD."valorCentavos"
     OR NEW."observacao" IS DISTINCT FROM OLD."observacao"
     OR NEW."criadoPorId" IS DISTINCT FROM OLD."criadoPorId"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR (OLD."fechamentoId" IS NOT NULL AND NEW."fechamentoId" IS DISTINCT FROM OLD."fechamentoId") THEN
    RAISE EXCEPTION 'Lançamento % do livro-razão não pode ser alterado', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LancamentoLoja_imutavel"
  BEFORE UPDATE OR DELETE ON "LancamentoLoja"
  FOR EACH ROW EXECUTE FUNCTION "lancamento_loja_imutavel"();
