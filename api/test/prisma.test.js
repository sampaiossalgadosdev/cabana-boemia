import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { raizApi, cliPrisma } from './helpers/banco.js';

test('prisma validate passa no schema.prisma', () => {
  const r = spawnSync(process.execPath, [cliPrisma, 'validate'], {
    cwd: raizApi,
    encoding: 'utf8',
    // validate não conecta no banco; a variável só precisa existir
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://x:x@localhost:5432/x',
    },
  });
  assert.equal(r.status, 0, `prisma validate falhou:\n${r.stdout}\n${r.stderr}`);
});
