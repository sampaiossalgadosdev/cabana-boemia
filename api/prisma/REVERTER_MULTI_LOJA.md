# Reverter as migrations `papel_admin`, `multi_loja` e `bairros_da_cidade`

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

## Bairros da cidade (`20261119210000_bairros_da_cidade`)

Reverta esta primeiro: ela é a mais recente, e as outras dependem dela já ter sido desfeita.

Só vale enquanto cada bairro estiver na área de entrega de **uma loja só** (hoje, a Cabana). Os ids dos bairros são mantidos, então os endereços continuam válidos. Bairro da cidade sem área volta para a Cabana desativado e com taxa 0.

```sql
BEGIN;

-- Bairro volta a ser de uma loja, com a taxa e o "ativo" da área de entrega dela.
ALTER TABLE "Bairro" ADD COLUMN "lojaId" INTEGER, ADD COLUMN "taxaCentavos" INTEGER;
UPDATE "Bairro" b SET "lojaId" = a."lojaId", "taxaCentavos" = a."taxaCentavos", "ativo" = (b."ativo" AND a."ativo")
FROM "AreaEntrega" a WHERE a."bairroId" = b."id";
-- Bairro da cidade sem área: fica na Cabana, desativado e sem taxa.
UPDATE "Bairro" SET "lojaId" = (SELECT "id" FROM "Loja" WHERE "slug" = 'cabana-boemia'), "taxaCentavos" = 0, "ativo" = false
WHERE "lojaId" IS NULL;
ALTER TABLE "Bairro" ALTER COLUMN "lojaId" SET NOT NULL, ALTER COLUMN "taxaCentavos" SET NOT NULL;
DROP INDEX "Bairro_nome_key";
CREATE UNIQUE INDEX "Bairro_lojaId_nome_key" ON "Bairro"("lojaId", "nome");
ALTER TABLE "Bairro" ADD CONSTRAINT "Bairro_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "AreaEntrega";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119210000_bairros_da_cidade';

COMMIT;
```

Volte também o código para antes do commit dos bairros da cidade.

Testado em 19/11/2026 numa cópia do banco de dev:

- reverter deixou o banco igual ao schema da etapa 1 (`migrate diff` sem diferença);
- reaplicar com `migrate deploy` também ficou sem diferença.

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

## Identidade da loja (`20261120120000_identidade_loja`)

Só aditiva (colunas `corPrimariaPadrao`/`logoUrlPadrao` na `Loja` e a tabela `ImagemLoja`). Para voltar sem restaurar o backup:

```sql
ALTER TABLE "Loja" DROP CONSTRAINT IF EXISTS "Loja_corPrimariaPadrao_check";
ALTER TABLE "Loja" DROP COLUMN "corPrimariaPadrao", DROP COLUMN "logoUrlPadrao";
UPDATE "Loja" SET "logoUrl" = NULL WHERE "logoUrl" LIKE '/api/publico/imagens/%';
DROP TABLE "ImagemLoja";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261120120000_identidade_loja';
```

E voltar o código para antes dela (a API desta etapa lê as colunas novas).

## Testado

Aplicação: numa cópia do banco de dev (`createdb -T restaurante restaurante_copia_multiloja`), com WhatsApp, frete grátis, tempo manual e virada alterados antes de migrar. Resultado:

- a Loja recebeu os valores;
- todas as linhas ganharam `lojaId = 1`, com as mesmas contagens;
- `prisma migrate diff` contra o schema: sem diferença.

Reversão, testada em 19/11/2026 na mesma cópia:

- o SQL da opção 2 devolveu a `Configuracao` com os mesmos valores, e os pedidos continuaram lá;
- o `migrate diff` contra o schema anterior só acusou o `ADMIN` no enum, como esperado;
- `migrate resolve --applied 20261119200000_papel_admin` seguido de `migrate deploy` reaplicou a `multi_loja` sem diferença.
