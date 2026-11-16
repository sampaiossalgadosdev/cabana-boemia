-- Dia operacional: vira às horaViradaDia:00 (America/Sao_Paulo), não à meia-noite.
-- Pedidos antigos mantêm o dataRef com que foram criados (reescrever colidiria com @@unique([dataRef, numeroDia])).
ALTER TABLE "Configuracao" ADD COLUMN     "horaViradaDia" INTEGER NOT NULL DEFAULT 4;

ALTER TABLE "Configuracao" ADD CONSTRAINT "Configuracao_horaViradaDia_check" CHECK ("horaViradaDia" BETWEEN 0 AND 12);
