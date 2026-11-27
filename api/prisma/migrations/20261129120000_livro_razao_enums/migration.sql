-- Etapa 6 do pagamento online: alerta do fechamento semanal atrasado (enum em migration
-- própria: o Postgres exige commit antes de usar o valor novo).
ALTER TYPE "TipoAlerta" ADD VALUE 'FECHAMENTO_ATRASADO';
