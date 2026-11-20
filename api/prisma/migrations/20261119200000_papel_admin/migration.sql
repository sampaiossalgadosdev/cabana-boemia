-- Papel ADMIN (plataforma Delivery Abatiá), acima do DONO e sem loja.
-- Migration própria: um valor novo de enum só pode ser usado depois do commit
-- (a migration multi_loja usa 'ADMIN' no CHECK do Usuario). Só aditiva.

-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'ADMIN' BEFORE 'DONO';
