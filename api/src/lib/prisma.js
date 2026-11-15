import { PrismaClient } from '@prisma/client';

// Cliente único por processo. Em dev, o `node --watch` reinicia o processo
// inteiro, então não há acúmulo de conexões entre recargas.
export const prisma = new PrismaClient();
