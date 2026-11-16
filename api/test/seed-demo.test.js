import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed.js';
import { semBancoDeTeste, resetarBancoDeTeste, raizApi } from './helpers/banco.js';

/** Roda o script como o dono rodaria (processo separado, banco de teste). */
function rodarDemo(args = [], env = {}) {
  return spawnSync(process.execPath, [path.join(raizApi, 'scripts', 'seed-demo.js'), ...args], {
    cwd: raizApi,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST, NODE_ENV: 'test', ...env },
  });
}

describe('seed:demo (dados de demonstração)', { skip: semBancoDeTeste }, () => {
  /** @type {PrismaClient} */
  let prisma;

  before(async () => {
    resetarBancoDeTeste();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
    await seed(prisma, { log: () => {} });
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  test('sem dono: recusa com instrução', () => {
    const r = rodarDemo();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /criar-dono/);
  });

  test('em produção exige --confirmar', () => {
    const r = rodarDemo([], { NODE_ENV: 'production' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--confirmar/);
  });

  test('cria 5 clientes, 8 pedidos do dia, 2 comandas abertas, pão acabando e nada para imprimir', async () => {
    await prisma.usuario.create({
      data: { nome: 'Dono', email: 'dono@demo.test', senhaHash: await bcrypt.hash('x', 4), papel: 'DONO' },
    });
    const r = rodarDemo();
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    assert.equal(await prisma.cliente.count(), 5);
    const pedidos = await prisma.pedido.findMany({ orderBy: { numeroDia: 'asc' } });
    assert.equal(pedidos.length, 10, '8 do dia + 2 comandas abertas');
    assert.deepEqual(pedidos.map((p) => p.numeroDia), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'mesmo contador do dia');

    const porCanal = (canal) => pedidos.filter((p) => p.canal === canal).length;
    assert.deepEqual([porCanal('SITE'), porCanal('WHATSAPP'), porCanal('SALAO')], [3, 3, 4]);
    const porStatus = (status) => pedidos.filter((p) => p.status === status).length;
    assert.equal(porStatus('FINALIZADO'), 5);
    assert.equal(porStatus('CANCELADO'), 1);
    assert.equal(pedidos.filter((p) => p.canal !== 'SALAO' && ['ABERTO', 'CONFIRMADO'].includes(p.status)).length, 2, '2 na fila do PDV');
    assert.equal(pedidos.filter((p) => p.canal === 'SALAO' && p.status === 'ABERTO').length, 2, '2 comandas abertas');
    assert.equal(new Set(pedidos.filter((p) => p.status === 'FINALIZADO').map((p) => p.formaPagamento)).size, 4, 'as 4 formas');
    assert.ok(pedidos.filter((p) => p.status === 'FINALIZADO').every((p) => p.caixaId), 'finalizados no caixa aberto');

    // Prato por quilo: preço × gramas.
    const kg = await prisma.itemPedido.findFirst({ where: { pesoGramas: 487 } });
    assert.equal(kg.totalCentavos, Math.round(5990 * 487 / 1000));

    // Saldos oficiais coerentes: pão ajustado para 3; cancelamento devolveu o pão de cachorro.
    const paes = Object.fromEntries((await prisma.insumo.findMany()).map((i) => [i.nome, i.estoque]));
    assert.equal(paes['Pão de lanche'], 5);
    assert.equal(paes['Pão de cachorro-quente'], 10);
    const lata = await prisma.produto.findUnique({ where: { nome: 'Refrigerante Lata' } });
    assert.equal(lata.estoque, 24 - 2 - 1 - 2, 'baixa no lançamento: 2 (site) + 1 (Roberto) + 2 (Seu Zé)');

    assert.equal(await prisma.trabalhoImpressao.count({ where: { status: 'PENDENTE' } }), 0, 'nada sai na impressora');
    assert.equal(await prisma.bairro.count({ where: { ativo: true } }), 2, 'bairros criados (não havia nenhum)');
  });

  test('rodar de novo no mesmo dia é recusado (não duplica)', async () => {
    const r = rodarDemo();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /já foram criados/);
    assert.equal(await prisma.pedido.count(), 10);
  });
});
