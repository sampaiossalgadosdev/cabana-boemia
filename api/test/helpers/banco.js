import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const raizApi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cliPrisma = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Motivo para pular testes de banco, ou false se o banco de teste está configurado. */
export const semBancoDeTeste = process.env.DATABASE_URL_TEST
  ? false
  : 'DATABASE_URL_TEST não definida em api/.env';

/** Apaga e recria o banco de teste aplicando todas as migrations. */
export function resetarBancoDeTeste() {
  const url = process.env.DATABASE_URL_TEST;
  // Travas: o reset apaga o banco inteiro.
  assert.ok(url, 'DATABASE_URL_TEST ausente');
  assert.notEqual(url, process.env.DATABASE_URL_DEV, 'DATABASE_URL_TEST não pode ser o banco de dev');
  assert.match(new URL(url).pathname, /test/, 'o nome do banco de teste deve conter "test"');

  const r = spawnSync(process.execPath, [cliPrisma, 'migrate', 'reset', '--force', '--skip-seed'], {
    cwd: raizApi,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  assert.equal(r.status, 0, `migrate reset falhou:\n${r.stdout}\n${r.stderr}`);
}
