/**
 * Cria um usuário DONO de uma loja (padrão: a Cabana Boemia).
 *   npm run criar-dono -w api -- --nome "Fulano" --email dono@exemplo.com --senha "segredo123" [--loja cabana-boemia]
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma.js';
import { ErroHttp } from '../src/lib/erros.js';
import { criarDono } from '../src/services/usuario.service.js';
import { SLUG_LOJA_PADRAO } from '../src/services/loja.service.js';

const schema = z.object({
  nome: z.string().trim().min(1, '--nome é obrigatório'),
  email: z.email('--email inválido'),
  senha: z.string().min(8, '--senha precisa ter pelo menos 8 caracteres').max(72),
  loja: z.string().trim().min(1).default(SLUG_LOJA_PADRAO),
});

async function main() {
  const { values } = parseArgs({
    options: {
      nome: { type: 'string' },
      email: { type: 'string' },
      senha: { type: 'string' },
      loja: { type: 'string' },
    },
    strict: true,
  });

  const dados = schema.safeParse(values);
  if (!dados.success) {
    for (const i of dados.error.issues) console.error(`Erro: ${i.message}`);
    console.error('Uso: npm run criar-dono -- --nome "Nome" --email email@exemplo.com --senha "senha"');
    return 1;
  }

  const { loja: slug, ...usuario } = dados.data;
  const loja = await prisma.loja.findUnique({ where: { slug } });
  if (!loja) {
    console.error(`Erro: loja "${slug}" não existe.`);
    return 1;
  }

  try {
    const dono = await criarDono({ ...usuario, lojaId: loja.id });
    console.log(`DONO criado: #${dono.id} ${dono.nome} <${dono.email}> na loja ${loja.nome}`);
    return 0;
  } catch (err) {
    if (err instanceof ErroHttp) {
      console.error(`Erro: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err.message ?? err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
