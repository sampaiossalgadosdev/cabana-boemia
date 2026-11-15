import { PrismaClient } from '@prisma/client';
import { paraBusca } from './texto.js';

/** Valor de `nome` num `data` do Prisma (string ou `{ set }`), ou undefined. */
function nomeGravado(data) {
  const nome = data?.nome;
  if (typeof nome === 'string') return nome;
  if (typeof nome?.set === 'string') return nome.set;
  return undefined;
}

/** Acrescenta `nomeBusca` sempre que o `data` grava `nome`. */
function comNomeBusca(data) {
  const nome = nomeGravado(data);
  return nome === undefined ? data : { ...data, nomeBusca: paraBusca(nome) };
}

/**
 * `Cliente.nomeBusca` (nome sem acento e minúsculo, para a busca do PDV) é
 * calculado AQUI, em toda criação e alteração de nome, por qualquer caminho
 * (site, PDV, scripts, testes): nenhum service precisa lembrar de preencher.
 * Vale também dentro de `$transaction` interativa.
 */
function criarPrisma() {
  return new PrismaClient().$extends({
    name: 'clienteNomeBusca',
    query: {
      cliente: {
        create: ({ args, query }) => query({ ...args, data: comNomeBusca(args.data) }),
        update: ({ args, query }) => query({ ...args, data: comNomeBusca(args.data) }),
        updateMany: ({ args, query }) => query({ ...args, data: comNomeBusca(args.data) }),
        upsert: ({ args, query }) =>
          query({ ...args, create: comNomeBusca(args.create), update: comNomeBusca(args.update) }),
        createMany: ({ args, query }) =>
          query({
            ...args,
            data: Array.isArray(args.data) ? args.data.map(comNomeBusca) : comNomeBusca(args.data),
          }),
      },
    },
  });
}

// Cliente único por processo. Em dev, o `node --watch` reinicia o processo
// inteiro, então não há acúmulo de conexões entre recargas.
export const prisma = criarPrisma();
