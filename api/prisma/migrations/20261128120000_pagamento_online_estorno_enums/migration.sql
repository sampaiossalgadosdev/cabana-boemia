-- Etapa 5 do pagamento online (docs/pagamento-online.md): só valores novos de enum, em
-- migration própria (o Postgres exige o commit antes de usar um valor novo).

-- Contestação (chargeback) ou mediação aberta pelo comprador no Mercado Pago.
ALTER TYPE "StatusPagamento" ADD VALUE 'CONTESTADO';

-- Alertas novos para o ADMIN.
ALTER TYPE "TipoAlerta" ADD VALUE 'REEMBOLSO_FALHOU';
ALTER TYPE "TipoAlerta" ADD VALUE 'CHARGEBACK';
ALTER TYPE "TipoAlerta" ADD VALUE 'ESTORNO_EXTERNO';
ALTER TYPE "TipoAlerta" ADD VALUE 'PEDIDO_SEM_ACEITE';
