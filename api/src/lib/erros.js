import { Prisma } from '@prisma/client';

/**
 * Erro de negócio com status HTTP. Lance em services/controllers e o
 * middleware central de erro transforma em resposta JSON.
 */
export class ErroHttp extends Error {
  /**
   * @param {number} status
   * @param {string} mensagem
   * @param {{ codigo?: string, detalhes?: unknown }} [extra]
   */
  constructor(status, mensagem, { codigo, detalhes } = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Violação de unicidade do Prisma (P2002), ex.: nome repetido. */
export const ehDuplicado = (err) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** Registro do update/delete não existe (P2025). */
export const ehInexistente = (err) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
