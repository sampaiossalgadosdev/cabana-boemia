/**
 * Promove um usuário a ADMIN (plataforma Delivery do Batiá: acima do DONO, sem loja).
 *   npm run promover-admin -w api -- --email voce@exemplo.com
 * Desfazer (volta a DONO da loja; padrão: Cabana Boemia):
 *   npm run promover-admin -w api -- --email voce@exemplo.com --desfazer [--loja cabana-boemia]
 * O ADMIN escolhe a loja no PDV (depois do login) e na retaguarda (seletor "Loja aberta", cabeçalho X-Loja).
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma.js';
import { ErroHttp } from '../src/lib/erros.js';
import { promoverAAdmin, voltarADono } from '../src/services/usuario.service.js';
import { SLUG_LOJA_PADRAO } from '../src/services/loja.service.js';

const schema = z.object({
  email: z.email('--email inválido'),
  desfazer: z.boolean().default(false),
  loja: z.string().trim().min(1).default(SLUG_LOJA_PADRAO),
});

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      desfazer: { type: 'boolean' },
      loja: { type: 'string' },
    },
    strict: true,
  });
  const dados = schema.safeParse(values);
  if (!dados.success) {
    for (const i of dados.error.issues) console.error(`Erro: ${i.message}`);
    console.error('Uso: npm run promover-admin -w api -- --email voce@exemplo.com [--desfazer [--loja slug]]');
    return 1;
  }

  try {
    if (dados.data.desfazer) {
      const loja = await prisma.loja.findUnique({ where: { slug: dados.data.loja } });
      if (!loja) {
        console.error(`Erro: loja "${dados.data.loja}" não existe.`);
        return 1;
      }
      const u = await voltarADono(dados.data.email, loja.id);
      console.log(`#${u.id} ${u.nome} <${u.email}> voltou a DONO da loja ${loja.nome}.`);
    } else {
      const u = await promoverAAdmin(dados.data.email);
      console.log(`#${u.id} ${u.nome} <${u.email}> agora é ADMIN (sem loja; escolhe a loja no PDV e na retaguarda).`);
    }
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
