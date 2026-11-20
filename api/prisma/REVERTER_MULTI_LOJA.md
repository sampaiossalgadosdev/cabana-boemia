# Reverter as migrations `papel_admin` e `multi_loja`

As duas migrations (`20261119200000_papel_admin` e `20261119200100_multi_loja`) não mudam nenhum id e não reescrevem pedidos. Elas:

- criam a `Loja` "cabana-boemia" com os dados da `Configuracao`;
- apagam a `Configuracao`;
- acrescentam `lojaId` em várias tabelas;
- trocam as unicidades globais por unicidades por loja.

## Antes de aplicar em produção

Faça um backup antes do deploy. É o caminho de volta mais seguro:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=antes-multi-loja.dump
```

No Railway: `railway connect Postgres` ou a aba Backups do serviço Postgres.

## Opção 1 (recomendada): restaurar o backup

1. Volte o código para o commit anterior à branch `feat/multi-loja`. Sem isso, o `prisma migrate deploy` do `start:producao` aplica as migrations de novo.
2. Restaure o backup:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" antes-multi-loja.dump
```

O que foi gravado depois do deploy (pedidos, caixas) se perde. Se houve movimento, use a opção 2.

## Opção 2: SQL de volta, mantendo os dados novos

Só vale **enquanto existir uma loja só** (a Cabana): as unicidades globais voltam e duas lojas colidiriam.

Primeiro, quem foi promovido a ADMIN volta a DONO (o CHECK do Usuario exige loja para o DONO):

```bash
npm run promover-admin -w api -- --email voce@exemplo.com --desfazer
```

Depois, numa transação:

```sql
BEGIN;

-- 1. Configuracao de volta, com os dados da Cabana.
CREATE TABLE "Configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nomeRestaurante" TEXT NOT NULL DEFAULT 'Cabana Boemia',
    "whatsappNumero" TEXT NOT NULL DEFAULT '',
    "tempoEstimadoPadraoMin" INTEGER NOT NULL DEFAULT 40,
    "tempoEstimadoManualMin" INTEGER,
    "tempoManualDefinidoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "horaViradaDia" INTEGER NOT NULL DEFAULT 4,
    "freteGratisAtivo" BOOLEAN NOT NULL DEFAULT false,
    "freteGratisMinimoCentavos" INTEGER,
    "freteGratisWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Configuracao_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Configuracao" ADD CONSTRAINT "Configuracao_horaViradaDia_check" CHECK ("horaViradaDia" BETWEEN 0 AND 12);
ALTER TABLE "Configuracao" ADD CONSTRAINT "Configuracao_freteGratis_check"
  CHECK (("freteGratisMinimoCentavos" IS NULL OR "freteGratisMinimoCentavos" > 0)
     AND (NOT "freteGratisAtivo" OR "freteGratisMinimoCentavos" IS NOT NULL));
INSERT INTO "Configuracao" ("id", "nomeRestaurante", "whatsappNumero", "tempoEstimadoPadraoMin", "tempoEstimadoManualMin",
  "tempoManualDefinidoEm", "atualizadoEm", "horaViradaDia", "freteGratisAtivo", "freteGratisMinimoCentavos", "freteGratisWhatsapp")
SELECT 1, "nome", "whatsapp", "tempoEstimadoPadraoMin", "tempoEstimadoManualMin",
  "tempoManualDefinidoEm", "atualizadoEm", "horaViradaDia", "freteGratisAtivo", "freteGratisMinimoCentavos", "freteGratisWhatsapp"
FROM "Loja" WHERE "slug" = 'cabana-boemia';

-- 2. Unicidades globais de volta.
DROP INDEX "Caixa_um_aberto";
CREATE UNIQUE INDEX "Caixa_um_aberto" ON "Caixa" ((true)) WHERE "fechadoEm" IS NULL;
DROP INDEX "Caixa_lojaId_abertoEm_idx";
CREATE INDEX "Caixa_abertoEm_idx" ON "Caixa"("abertoEm");
DROP INDEX "TrabalhoImpressao_lojaId_status_criadoEm_idx";
CREATE INDEX "TrabalhoImpressao_status_criadoEm_idx" ON "TrabalhoImpressao"("status", "criadoEm");
DROP INDEX "Pedido_lojaId_dataRef_numeroDia_key";
CREATE UNIQUE INDEX "Pedido_dataRef_numeroDia_key" ON "Pedido"("dataRef", "numeroDia");
DROP INDEX "Produto_lojaId_nome_key";   CREATE UNIQUE INDEX "Produto_nome_key" ON "Produto"("nome");
DROP INDEX "Categoria_lojaId_nome_key"; CREATE UNIQUE INDEX "Categoria_nome_key" ON "Categoria"("nome");
DROP INDEX "Bairro_lojaId_nome_key";    CREATE UNIQUE INDEX "Bairro_nome_key" ON "Bairro"("nome");
DROP INDEX "Turno_lojaId_nome_key";     CREATE UNIQUE INDEX "Turno_nome_key" ON "Turno"("nome");
DROP INDEX "Insumo_lojaId_nome_key";    CREATE UNIQUE INDEX "Insumo_nome_key" ON "Insumo"("nome");
ALTER TABLE "ContadorPedido" DROP CONSTRAINT "ContadorPedido_pkey",
  ADD CONSTRAINT "ContadorPedido_pkey" PRIMARY KEY ("dataRef");

-- 3. Colunas lojaId (as FKs, o índice do Usuario e o CHECK caem junto).
ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_loja_check";
ALTER TABLE "Usuario" DROP COLUMN "lojaId";
ALTER TABLE "Categoria" DROP COLUMN "lojaId";
ALTER TABLE "Produto" DROP COLUMN "lojaId";
ALTER TABLE "Insumo" DROP COLUMN "lojaId";
ALTER TABLE "Turno" DROP COLUMN "lojaId";
ALTER TABLE "Bairro" DROP COLUMN "lojaId";
ALTER TABLE "Pedido" DROP COLUMN "lojaId";
ALTER TABLE "ContadorPedido" DROP COLUMN "lojaId";
ALTER TABLE "Caixa" DROP COLUMN "lojaId";
ALTER TABLE "TrabalhoImpressao" DROP COLUMN "lojaId";

-- 4. Loja.
DROP TABLE "Loja";

-- 5. O Prisma esquece as duas migrations.
DELETE FROM "_prisma_migrations" WHERE "migration_name" IN ('20261119200100_multi_loja', '20261119200000_papel_admin');

COMMIT;
```

O valor `ADMIN` continua no enum `Papel`. Isso é inofensivo: nenhum usuário o usa depois do `--desfazer`, e o PostgreSQL não remove valor de enum sem recriar o tipo. Se a migration `papel_admin` for aplicada de novo, ela falha com "já existe". Nesse caso:

```sql
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '', '20261119200000_papel_admin', now(), now(), 1);
```

Ou rode `npx prisma migrate resolve --applied 20261119200000_papel_admin`.

Por fim, volte o código para o commit anterior à branch `feat/multi-loja`.

## Testado

Aplicação: numa cópia do banco de dev (`createdb -T restaurante restaurante_copia_multiloja`), com WhatsApp, frete grátis, tempo manual e virada alterados antes de migrar. Resultado:

- a Loja recebeu os valores;
- todas as linhas ganharam `lojaId = 1`, com as mesmas contagens;
- `prisma migrate diff` contra o schema: sem diferença.

Reversão, testada em 19/11/2026 na mesma cópia:

- o SQL da opção 2 devolveu a `Configuracao` com os mesmos valores, e os pedidos continuaram lá;
- o `migrate diff` contra o schema anterior só acusou o `ADMIN` no enum, como esperado;
- `migrate resolve --applied 20261119200000_papel_admin` seguido de `migrate deploy` reaplicou a `multi_loja` sem diferença.
