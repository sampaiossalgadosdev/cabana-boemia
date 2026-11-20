-- Só aditiva.
-- 1. Pedido.chaveNfce: chave de acesso da NFC-e da venda (44 dígitos), preenchida pela
--    equipe como prova de emissão. Única (uma nota por pedido); o service confere modelo 65
--    e dígito verificador.
-- 2. TrabalhoImpressao.reservadoPor/reservadoAte: reserva atômica do trabalho pelo agente
--    de impressão (dois PDVs da mesma loja nunca imprimem o mesmo cupom).

-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "chaveNfce" VARCHAR(44);
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_chaveNfce_check" CHECK ("chaveNfce" IS NULL OR "chaveNfce" ~ '^[0-9]{44}$');

-- AlterTable
ALTER TABLE "TrabalhoImpressao" ADD COLUMN     "reservadoAte" TIMESTAMP(3),
ADD COLUMN     "reservadoPor" VARCHAR(64);
-- Reserva tudo-ou-nada (quem e até quando).
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_reserva_check"
  CHECK (("reservadoPor" IS NULL) = ("reservadoAte" IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_chaveNfce_key" ON "Pedido"("chaveNfce");
