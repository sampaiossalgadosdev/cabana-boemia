-- Etapa 4 do pagamento online: quando o Mercado Pago foi consultado pela última vez
-- (a tela do Pix do app consulta no máximo a cada 30 s; a rotina, a cada minuto). Só aditiva.
ALTER TABLE "Pagamento" ADD COLUMN "consultadoEm" TIMESTAMP(3);
