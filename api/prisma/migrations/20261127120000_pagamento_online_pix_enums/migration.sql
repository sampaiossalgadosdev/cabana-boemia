-- Etapa 4 do pagamento online (docs/pagamento-online.md): só valores novos de enum, em
-- migration própria (o Postgres exige o commit antes de usar um valor novo).

-- Pedido feito pelo app (antes ia como SITE).
ALTER TYPE "CanalPedido" ADD VALUE 'APP';

-- Pago depois de expirar: o pedido não revive e o valor volta ao cliente (Etapa 5).
ALTER TYPE "StatusPagamento" ADD VALUE 'A_ESTORNAR';

-- Alertas novos para o ADMIN.
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGAMENTO_DIVERGENTE';
ALTER TYPE "TipoAlerta" ADD VALUE 'PAGO_APOS_EXPIRAR';
ALTER TYPE "TipoAlerta" ADD VALUE 'MP_DESVINCULADA';
ALTER TYPE "TipoAlerta" ADD VALUE 'TAXA_ENTREGA_COMPLEMENTO';
ALTER TYPE "TipoAlerta" ADD VALUE 'PIX_FALHANDO';
ALTER TYPE "TipoAlerta" ADD VALUE 'LOJA_SEM_LOCALIZACAO';
