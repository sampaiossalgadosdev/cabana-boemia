-- Login com celular: telefone confirmado por código. Só aditiva: os clientes
-- existentes ficam com o telefone NÃO verificado (ninguém confirmou ainda).
ALTER TABLE "Cliente" ADD COLUMN "telefoneVerificado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cliente" ADD COLUMN "telefoneVerificadoEm" TIMESTAMP(3);

-- Verificado = tem telefone e a data da verificação; não verificado = sem data.
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_telefone_verificado_check"
  CHECK (("telefoneVerificado" AND "telefone" IS NOT NULL AND "telefoneVerificadoEm" IS NOT NULL)
      OR (NOT "telefoneVerificado" AND "telefoneVerificadoEm" IS NULL));

-- Um telefone verificado pertence a um cliente só. Telefones não verificados
-- (digitados no site ou cadastrados pelo PDV) podem se repetir, como antes.
CREATE UNIQUE INDEX "Cliente_telefone_verificado_key" ON "Cliente"("telefone") WHERE "telefoneVerificado";
