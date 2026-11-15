/**
 * Cria um usuário DONO.
 *   npm run criar-dono -w api -- --nome "Fulano" --email dono@exemplo.com --senha "segredo123"
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma.js';
import { ErroHttp } from '../src/lib/erros.js';
import { criarDono } from '../src/services/usuario.service.js';

const schema = z.object({
  nome: z.string().trim().min(1, '--nome é obrigatório'),
  email: z.email('--email inválido'),
  senha: z.string().min(8, '--senha precisa ter pelo menos 8 caracteres').max(72),
});

async function main() {
  const { values } = parseArgs({
    options: {
      nome: { type: 'string' },
      email: { type: 'string' },
      senha: { type: 'string' },
    },
    strict: true,
  });

  const dados = schema.safeParse(values);
  if (!dados.success) {
    for (const i of dados.error.issues) console.error(`Erro: ${i.message}`);
    console.error('Uso: npm run criar-dono -- --nome "Nome" --email email@exemplo.com --senha "senha"');
    return 1;
  }

  try {
    const dono = await criarDono(dados.data);
    console.log(`DONO criado: #${dono.id} ${dono.nome} <${dono.email}>`);
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
