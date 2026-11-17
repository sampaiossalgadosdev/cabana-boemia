-- "Peça também" na sacola do site: produtos marcados pelo dono. Padrão: não
-- (sem nenhum marcado, o site sugere as bebidas).
ALTER TABLE "Produto" ADD COLUMN     "sugerirNaSacola" BOOLEAN NOT NULL DEFAULT false;
