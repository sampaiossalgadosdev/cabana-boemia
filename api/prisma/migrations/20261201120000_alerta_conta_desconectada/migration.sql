-- Etapa 8 do pagamento online (revisão): alerta para o ADMIN quando o Mercado Pago avisa de um
-- pagamento na conta de uma loja já desconectada do Taaki (sem token, o sistema não confere nem
-- estorna). Só o valor novo do enum, em migration própria (o Postgres exige commit antes do uso).
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGAMENTO_CONTA_DESCONECTADA';
