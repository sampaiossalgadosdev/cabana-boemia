import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { raizApi } from './helpers/banco.js';

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

test('.env.example declara toda variável de ambiente lida pela API', async () => {
  const usadas = new Set();
  for (const pasta of ['src', 'scripts', 'prisma']) {
    for (const arquivo of await arquivosJs(path.join(raizApi, pasta))) {
      const codigo = await readFile(arquivo, 'utf8');
      for (const m of codigo.matchAll(/process\.env\.([A-Z0-9_]+)/g)) usadas.add(m[1]);
      // Leitura indireta: segredo('JWT_SECRET') em lib/tokens.js
      for (const m of codigo.matchAll(/segredo\('([A-Z0-9_]+)'\)/g)) usadas.add(m[1]);
    }
  }
  const exemplo = await readFile(path.join(raizApi, '.env.example'), 'utf8');
  const declaradas = new Set([...exemplo.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));

  assert.ok(usadas.has('JWT_SECRET'), 'a varredura precisa enxergar os segredos');
  const faltando = [...usadas].filter((v) => !declaradas.has(v)).sort();
  assert.deepEqual(faltando, [], `faltam no .env.example: ${faltando.join(', ')}`);
});

test('.env.example traz as variáveis de banco, tokens (equipe e cliente), Google, CORS e porta', async () => {
  const exemplo = await readFile(path.join(raizApi, '.env.example'), 'utf8');
  for (const v of [
    'DATABASE_URL',
    'DATABASE_URL_TEST',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_CLIENTE_SECRET',
    'GOOGLE_CLIENT_ID',
    'CORS_ORIGINS',
    'PORT',
  ]) {
    assert.match(exemplo, new RegExp(`^${v}=`, 'm'), v);
  }
});
