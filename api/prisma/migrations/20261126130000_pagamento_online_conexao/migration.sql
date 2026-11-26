-- Pagamento online, etapa 3: conexão da loja com o Mercado Pago e alertas do ADMIN.
-- - Campanha da primeira compra: o telefone sai da tabela e entra só o HMAC-SHA256 dele
--   (CAMPANHA_TELEFONE_SECRET). O HMAC não pode ser calculado aqui (o segredo é do
--   ambiente): a migration recusa rodar com linhas na tabela. A tabela é desta mesma
--   leva (nunca foi para produção) e o banco de dev estava vazio.
-- - A mesma conta Mercado Pago só pode estar CONECTADA ou EXPIRADA em uma loja.
-- - Alertas para o ADMIN (tela "Alertas" da plataforma).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UsoCampanhaFreteGratis") THEN
    RAISE EXCEPTION 'UsoCampanhaFreteGratis tem linhas com o telefone em texto: migre para o hash à mão antes';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TipoAlerta" AS ENUM ('RENOVACAO_MP_FALHOU');

-- DropIndex
DROP INDEX "UsoCampanhaFreteGratis_telefone_key";

-- AlterTable
ALTER TABLE "UsoCampanhaFreteGratis" DROP COLUMN "telefone",
ADD COLUMN     "telefoneHash" VARCHAR(64) NOT NULL;

-- CreateTable
CREATE TABLE "AlertaPlataforma" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoAlerta" NOT NULL,
    "lojaId" INTEGER,
    "pedidoId" INTEGER,
    "mensagem" VARCHAR(500) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvidoEm" TIMESTAMP(3),
    "resolvidoPorId" INTEGER,

    CONSTRAINT "AlertaPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertaPlataforma_resolvidoEm_criadoEm_idx" ON "AlertaPlataforma"("resolvidoEm", "criadoEm");

-- CreateIndex
CREATE INDEX "AlertaPlataforma_lojaId_idx" ON "AlertaPlataforma"("lojaId");

-- CreateIndex
CREATE UNIQUE INDEX "UsoCampanhaFreteGratis_telefoneHash_key" ON "UsoCampanhaFreteGratis"("telefoneHash");

-- AddForeignKey
ALTER TABLE "AlertaPlataforma" ADD CONSTRAINT "AlertaPlataforma_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaPlataforma" ADD CONSTRAINT "AlertaPlataforma_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaPlataforma" ADD CONSTRAINT "AlertaPlataforma_resolvidoPorId_fkey" FOREIGN KEY ("resolvidoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- O CHECK antigo usava "telefone" e caiu junto com a coluna: volta com o hash.
ALTER TABLE "UsoCampanhaFreteGratis" ADD CONSTRAINT "UsoCampanhaFreteGratis_check"
  CHECK ((("situacao" = 'USADO') = ("usadoEm" IS NOT NULL)) AND "telefoneHash" ~ '^[0-9a-f]{64}$');

-- Mesma conta Mercado Pago em duas lojas ao mesmo tempo, não (desconectada pode ir para outra).
CREATE UNIQUE INDEX "ConexaoMercadoPago_conta_em_uso_key" ON "ConexaoMercadoPago"("mpUserId")
  WHERE "status" IN ('CONECTADA', 'EXPIRADA');

-- Alerta resolvido tem a data e quem resolveu (os dois ou nenhum).
ALTER TABLE "AlertaPlataforma" ADD CONSTRAINT "AlertaPlataforma_resolvido_check"
  CHECK (("resolvidoEm" IS NULL) = ("resolvidoPorId" IS NULL));
