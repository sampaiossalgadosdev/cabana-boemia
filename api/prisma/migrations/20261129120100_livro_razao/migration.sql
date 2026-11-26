-- Etapa 6 do pagamento online: livro-razão da loja e fechamento semanal. Só aditiva.

-- Taxa de entrega antes do frete grátis (gravada na criação; só com entrega). É dela que sai o
-- crédito da campanha em loja com motoboy próprio. Pedidos antigos: preenchida quando dá para
-- saber (entregador da plataforma = entregador + plataforma; sem frete grátis = a taxa cobrada).
ALTER TABLE "Pedido" ADD COLUMN "taxaEntregaCheiaCentavos" INTEGER;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_taxa_cheia_check"
  CHECK ("taxaEntregaCheiaCentavos" IS NULL OR "taxaEntregaCheiaCentavos" >= 0);
UPDATE "Pedido"
   SET "taxaEntregaCheiaCentavos" = CASE
         WHEN "origemTaxaEntrega" IS NOT NULL THEN "valorEntregadorCentavos" + "valorPlataformaEntregaCentavos"
         WHEN "origemFreteGratis" = 'NENHUM' THEN "taxaEntregaCentavos"
       END
 WHERE "enderecoTexto" IS NOT NULL;

-- Estorno de lançamento: aponta o lançamento que desfaz (um estorno por lançamento).
ALTER TABLE "LancamentoLoja" ADD COLUMN "estornaId" INTEGER;
CREATE UNIQUE INDEX "LancamentoLoja_estornaId_key" ON "LancamentoLoja"("estornaId");
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_estornaId_fkey"
  FOREIGN KEY ("estornaId") REFERENCES "LancamentoLoja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ESTORNO = sempre com o lançamento desfeito; automáticos = sempre com o pedido; ajuste manual =
-- sempre com a observação.
ALTER TABLE "LancamentoLoja" ADD CONSTRAINT "LancamentoLoja_tipo_check"
  CHECK ((("tipo" = 'ESTORNO') = ("estornaId" IS NOT NULL))
     AND ("tipo" = 'AJUSTE_MANUAL' OR "pedidoId" IS NOT NULL)
     AND ("tipo" <> 'AJUSTE_MANUAL' OR length(btrim(coalesce("observacao", ''))) > 0));

-- Nunca dois lançamentos automáticos do mesmo tipo no mesmo pedido.
CREATE UNIQUE INDEX "LancamentoLoja_pedido_tipo_automatico_key" ON "LancamentoLoja"("pedidoId", "tipo")
  WHERE "tipo" IN ('TAXA_ENTREGA_DINHEIRO', 'TAXA_ENTREGA_COMPLEMENTO', 'CREDITO_CAMPANHA');

-- Trigger do livro-razão com o campo novo (continua: só inserção; só ganha o fechamento).
CREATE OR REPLACE FUNCTION "lancamento_loja_imutavel"() RETURNS trigger AS $$
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
     OR NEW."estornaId" IS DISTINCT FROM OLD."estornaId"
     OR (OLD."fechamentoId" IS NOT NULL AND NEW."fechamentoId" IS DISTINCT FROM OLD."fechamentoId") THEN
    RAISE EXCEPTION 'Lançamento % do livro-razão não pode ser alterado', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fechamento: não se apaga; depois de criado, loja, semana e saldo não mudam; o status só anda
-- para frente (ABERTO → AGUARDANDO_PAGAMENTO/QUITADO, AGUARDANDO_PAGAMENTO → QUITADO) e o
-- quitado não muda mais.
CREATE FUNCTION "fechamento_semanal_imutavel"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fechamento % não pode ser apagado', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lojaId" IS DISTINCT FROM OLD."lojaId"
     OR NEW."inicio" IS DISTINCT FROM OLD."inicio"
     OR NEW."fim" IS DISTINCT FROM OLD."fim"
     OR NEW."saldoCentavos" IS DISTINCT FROM OLD."saldoCentavos"
     OR NEW."criadoEm" IS DISTINCT FROM OLD."criadoEm"
     OR (OLD."status" = 'QUITADO' AND (NEW."status" IS DISTINCT FROM OLD."status"
         OR NEW."quitadoEm" IS DISTINCT FROM OLD."quitadoEm"
         OR NEW."quitadoPorId" IS DISTINCT FROM OLD."quitadoPorId"
         OR NEW."observacao" IS DISTINCT FROM OLD."observacao"))
     OR (OLD."status" = 'AGUARDANDO_PAGAMENTO' AND NEW."status" = 'ABERTO') THEN
    RAISE EXCEPTION 'Fechamento % não pode ser alterado', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FechamentoSemanal_imutavel"
  BEFORE UPDATE OR DELETE ON "FechamentoSemanal"
  FOR EACH ROW EXECUTE FUNCTION "fechamento_semanal_imutavel"();

-- Alerta de fechamento atrasado: um por fechamento.
ALTER TABLE "AlertaPlataforma" ADD COLUMN "fechamentoId" INTEGER;
ALTER TABLE "AlertaPlataforma" ADD CONSTRAINT "AlertaPlataforma_fechamentoId_fkey"
  FOREIGN KEY ("fechamentoId") REFERENCES "FechamentoSemanal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AlertaPlataforma_fechamentoId_idx" ON "AlertaPlataforma"("fechamentoId");
