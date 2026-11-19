import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { raizApi } from './banco.js';

/** Arquivos .js de produção (src, scripts, prisma), sem os testes. */
async function arquivosJs(dir) {
  const saida = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...(await arquivosJs(p)));
    else if (e.name.endsWith('.js')) saida.push(p);
  }
  return saida;
}

/**
 * Variáveis de ambiente lidas pelo código de produção da API:
 * `process.env.X`, `segredo('X')` (lib/tokens.js) e `env("X")` do schema.prisma.
 * @returns {Promise<Set<string>>}
 */
export async function variaveisLidasPelaApi() {
  const usadas = new Set();
  for (const pasta of ['src', 'scripts', 'prisma']) {
    for (const arquivo of await arquivosJs(path.join(raizApi, pasta))) {
      const codigo = await readFile(arquivo, 'utf8');
      // `process.env.X` e `env.X` (funções que recebem `env = process.env`, ex.: lib/apple.js)
      for (const m of codigo.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) usadas.add(m[1]);
      for (const m of codigo.matchAll(/segredo\('([A-Z0-9_]+)'\)/g)) usadas.add(m[1]);
    }
  }
  const schema = await readFile(path.join(raizApi, 'prisma', 'schema.prisma'), 'utf8');
  for (const m of schema.matchAll(/env\("([A-Z0-9_]+)"\)/g)) usadas.add(m[1]);
  return usadas;
}

/**
 * Lê um arquivo .env (linhas `CHAVE=valor`, aspas opcionais; `#` é comentário).
 * @returns {Map<string, string>}
 */
export function lerEnv(texto) {
  const vars = new Map();
  for (const m of texto.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
    vars.set(m[1], m[2].trim().replace(/^"(.*)"$/, '$1'));
  }
  return vars;
}
