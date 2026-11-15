import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { raizApi } from './helpers/banco.js';
import { variaveisLidasPelaApi } from './helpers/variaveis.js';

test('.env.example declara toda variável de ambiente lida pela API', async () => {
  const usadas = await variaveisLidasPelaApi();
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
