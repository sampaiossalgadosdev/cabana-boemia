import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { raizApi } from './helpers/banco.js';
import { variaveisLidasPelaApi, lerEnv } from './helpers/variaveis.js';
import { problemasNosSegredos } from '../src/lib/tokens.js';

/**
 * api/.env.railway (variáveis de produção para o Raw Editor do Railway) tem
 * segredos e NÃO é versionado: só existe na máquina do dono. Sem ele (clone
 * novo, CI), estes testes são pulados. Nenhuma asserção imprime valores.
 */
const ARQUIVO = path.join(raizApi, '.env.railway');
const ARQUIVO_DEV = path.join(raizApi, '.env');
const semArquivo = existsSync(ARQUIVO) ? false : 'api/.env.railway não existe nesta máquina';
const SEGREDOS = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_CLIENTE_SECRET'];
// Lidas pelo código, mas não precisam estar no arquivo: o Railway injeta PORT.
const OPCIONAIS_EM_PRODUCAO = new Set(['PORT']);

describe('api/.env.railway (produção)', { skip: semArquivo }, () => {
  const prod = () => lerEnv(readFileSync(ARQUIVO, 'utf8'));

  test('declara toda variável de ambiente lida pela API (PORT é opcional: o Railway injeta)', async () => {
    const usadas = await variaveisLidasPelaApi();
    assert.ok(usadas.has('DATABASE_URL'), 'a varredura precisa enxergar o env() do schema.prisma');
    assert.ok(usadas.has('JWT_CLIENTE_SECRET'), 'a varredura precisa enxergar os segredos');
    assert.ok(usadas.has('PORT'), 'PORT continua sendo lida pelo server.js');
    const declaradas = prod();
    const faltando = [...usadas]
      .filter((v) => !declaradas.has(v) && !OPCIONAIS_EM_PRODUCAO.has(v))
      .sort();
    assert.deepEqual(faltando, [], `faltam no .env.railway: ${faltando.join(', ')}`);
  });

  test('segredos válidos (32+ caracteres, diferentes entre si) e diferentes dos de dev', () => {
    const p = prod();
    const env = Object.fromEntries(SEGREDOS.map((s) => [s, p.get(s)]));
    assert.deepEqual(problemasNosSegredos(env), []);

    if (existsSync(ARQUIVO_DEV)) {
      const dev = lerEnv(readFileSync(ARQUIVO_DEV, 'utf8'));
      const valoresDev = new Set(SEGREDOS.map((s) => dev.get(s)).filter(Boolean));
      for (const s of SEGREDOS) {
        assert.ok(!valoresDev.has(p.get(s)), `${s} de produção não pode repetir um segredo de dev`);
      }
    }
  });

  test('banco pela referência do Postgres do Railway, NODE_ENV=production e nada de banco de teste', () => {
    const p = prod();
    assert.equal(p.get('DATABASE_URL'), '${{Postgres.DATABASE_URL}}');
    assert.equal(p.get('NODE_ENV'), 'production');
    assert.equal(p.has('DATABASE_URL_TEST'), false, 'banco de teste não vai para produção');
  });
});
