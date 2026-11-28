-- Etapa 8 do pagamento online (revisão): Pix expirado do nosso lado cujo cancelamento no Mercado
-- Pago falhou. Até esta data (o fim dos 30 minutos que o Mercado Pago dá ao Pix) a rotina de
-- 1 minuto tenta cancelar de novo. Só aditiva.
ALTER TABLE "Pagamento" ADD COLUMN "cancelarNoMpAte" TIMESTAMP(3);
