/**
 * Cria (ou completa) a LOJA DE TESTE com um cardápio pequeno e o dono dela,
 * para conferir o isolamento entre lojas e o tema por loja:
 *   npm run criar-loja-teste -w api -- [--senha "senha-do-dono"] [--email dono@lanchonete-teste.test] [--confirmar]
 *
 * - Loja "lanchonete-teste" (verde, logo de teste, aberta todos os dias 00:00–23:59),
 *   2 lanches, 2 bebidas com estoque e área de entrega (Centro e Jardim Primavera),
 *   tudo do JSON prisma/cardapios/loja-teste.json pelo mesmo seed da Cabana (idempotente).
 * - Dono: criado só se o e-mail ainda não existir (sem --senha, uma senha
 *   aleatória é mostrada uma vez).
 * - Em produção (NODE_ENV=production) exige --confirmar.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { criarDono } from '../src/services/usuario.service.js';
import { lerCardapio, seed } from '../prisma/seed.js';

export const CARDAPIO_TESTE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prisma/cardapios/loja-teste.json');

/**
 * @param {{ email?: string, senha?: string, log?: (m: string) => void }} [opcoes]
 * @returns {Promise<{ loja: object, dono: { email: string, senha: string | null, criado: boolean } }>}
 */
export async function criarLojaTeste({ email = 'dono@lanchonete-teste.test', senha, log = console.log } = {}) {
  const cardapio = await lerCardapio(CARDAPIO_TESTE);
  await seed(prisma, { cardapio, caminho: CARDAPIO_TESTE, log });
  const loja = await prisma.loja.findUnique({ where: { slug: cardapio.loja.slug } });

  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    if (existente.lojaId !== loja.id) throw new Error(`O e-mail ${email} já é de outro usuário (de outra loja).`);
    return { loja, dono: { email, senha: null, criado: false } };
  }
  const senhaFinal = senha ?? randomBytes(9).toString('base64url');
  await criarDono({ nome: 'Dono da Loja Teste', email, senha: senhaFinal, lojaId: loja.id });
  return { loja, dono: { email, senha: senhaFinal, criado: true } };
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, senha: { type: 'string' }, confirmar: { type: 'boolean' } },
    strict: true,
  });
  if (process.env.NODE_ENV === 'production' && !values.confirmar) {
    console.error('Em produção, rode com --confirmar (cria uma loja de teste no banco de verdade).');
    return 1;
  }
  if (values.senha != null && values.senha.length < 8) {
    console.error('--senha precisa ter pelo menos 8 caracteres');
    return 1;
  }
  const { loja, dono } = await criarLojaTeste({ email: values.email, senha: values.senha });
  console.log(`\nLoja de teste: ${loja.nome} (/${loja.slug}, id ${loja.id}), cor ${loja.corPrimaria}.`);
  if (dono.criado) console.log(`Dono criado: ${dono.email}${values.senha ? '' : ` — senha: ${dono.senha} (anote; não aparece de novo)`}`);
  else console.log(`Dono já existia: ${dono.email} (senha não muda).`);
  console.log('Entre na retaguarda (/admin) e no PDV com esse e-mail para ver o cardápio, a cor e a logo da loja.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(err.message ?? err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
