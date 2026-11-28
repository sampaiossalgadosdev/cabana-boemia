-- Etapa 8 do pagamento online (revisão): estorno que falhou sem saber se o Mercado Pago chegou a
-- fazê-lo (rede, tempo esgotado, 5xx). O "Tentar de novo" repete ESSE estorno com a mesma chave de
-- idempotência (o Mercado Pago não cria um segundo); recusa clara do Mercado Pago = chave nova.
-- Só aditiva.
ALTER TABLE "Estorno" ADD COLUMN "resultadoIncerto" BOOLEAN NOT NULL DEFAULT false;
