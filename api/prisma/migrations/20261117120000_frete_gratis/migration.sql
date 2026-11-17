-- Frete grátis a partir de um subtotal (sem a taxa), configurado na retaguarda.
-- Dinheiro em centavos (Int), como o resto do schema. Desligado por padrão.
ALTER TABLE "Configuracao" ADD COLUMN     "freteGratisAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freteGratisMinimoCentavos" INTEGER;

-- Mínimo, quando existe, é positivo; ligado exige mínimo.
ALTER TABLE "Configuracao" ADD CONSTRAINT "Configuracao_freteGratis_check"
  CHECK (("freteGratisMinimoCentavos" IS NULL OR "freteGratisMinimoCentavos" > 0)
     AND (NOT "freteGratisAtivo" OR "freteGratisMinimoCentavos" IS NOT NULL));
