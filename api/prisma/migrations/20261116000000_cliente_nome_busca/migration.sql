-- Cliente.nomeBusca: nome sem acento, minúsculo e com espaços simples, para a
-- busca do PDV ("joao" acha "João"). Sem extensão do banco (nada de unaccent):
-- a API calcula o valor em toda gravação (src/lib/prisma.js, paraBusca em
-- src/lib/texto.js) e aqui preenchemos os clientes que já existem com a mesma
-- regra em SQL puro (translate cobre as letras acentuadas do português/espanhol).

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "nomeBusca" TEXT NOT NULL DEFAULT '';

-- Preenche os existentes
UPDATE "Cliente" SET "nomeBusca" = btrim(regexp_replace(lower(translate("nome", 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')), '\s+', ' ', 'g'));

-- Daqui em diante a API sempre informa o valor
ALTER TABLE "Cliente" ALTER COLUMN "nomeBusca" DROP DEFAULT;
