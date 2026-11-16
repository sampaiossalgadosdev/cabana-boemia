-- AlterEnum
ALTER TYPE "TipoTrabalhoImpressao" ADD VALUE 'RELATORIO_DIA';

-- AlterTable
ALTER TABLE "TrabalhoImpressao" ADD COLUMN     "dataRelatorio" DATE;

-- Exatamente um dono: pedido, caixa (FECHAMENTO) ou dia operacional (RELATORIO_DIA).
ALTER TABLE "TrabalhoImpressao" DROP CONSTRAINT "TrabalhoImpressao_dono_check";
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_dono_check"
  CHECK (num_nonnulls("pedidoId", "caixaId", "dataRelatorio") = 1);
