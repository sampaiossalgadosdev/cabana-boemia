import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { seed, contarTabelas } from '../prisma/seed.js';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

describe('seed do cardápio', { skip: semBancoDeTeste }, () => {
  /** @type {PrismaClient} */
  let prisma;
  const avisosPorRodada = [];

  before(() => {
    resetarBancoDeTeste();
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  test('rodar o seed 2 vezes seguidas não duplica nada', async () => {
    avisosPorRodada.push(await seed(prisma, { log: () => {} }));
    const primeira = await contarTabelas(prisma);

    avisosPorRodada.push(await seed(prisma, { log: () => {} }));
    const segunda = await contarTabelas(prisma);

    assert.deepEqual(segunda, primeira);
  });

  test('contagens por tabela batem com o JSON (30 produtos = 29 + Prato por kg)', async () => {
    assert.deepEqual(await contarTabelas(prisma), {
      configuracao: 1,
      turno: 2,
      horarioTurno: 4,
      insumo: 2,
      categoria: 6,
      produto: 30,
      produtoTurno: 35, // 21 (lanches/pizzas/porções) + 10 (bebidas × 2) + 3 (marmitas) + 1 (prato)
      produtoInsumo: 9,
    });
  });

  test('marmitas entram com preço 0 e inativas', async () => {
    const marmitas = await prisma.produto.findMany({ where: { nome: { startsWith: 'Marmita' } } });
    assert.equal(marmitas.length, 3);
    for (const m of marmitas) {
      assert.equal(m.precoCentavos, 0);
      assert.equal(m.ativo, false);
    }
  });

  test('Prato por kg: POR_KG, categoria Pratos, turno Almoço, fora do site, inativo', async () => {
    const p = await prisma.produto.findUnique({
      where: { nome: 'Prato por kg' },
      include: { categoria: true, turnos: { include: { turno: true } } },
    });
    assert.equal(p.tipoPreco, 'POR_KG');
    assert.equal(p.precoCentavos, 0);
    assert.equal(p.ativo, false);
    assert.equal(p.vendidoNoSite, false);
    assert.equal(p.categoria.nome, 'Pratos');
    assert.deepEqual(p.turnos.map((t) => t.turno.nome), ['Almoço']);
  });

  test('sexta e sábado do turno Lanches fecham à meia-noite (fim "00:00")', async () => {
    const horarios = await prisma.horarioTurno.findMany({
      where: { turno: { nome: 'Lanches' } },
      orderBy: { diaSemana: 'asc' },
      select: { diaSemana: true, inicio: true, fim: true },
    });
    assert.deepEqual(horarios, [
      { diaSemana: 0, inicio: '18:00', fim: '23:00' },
      { diaSemana: 4, inicio: '19:00', fim: '23:00' },
      { diaSemana: 5, inicio: '19:00', fim: '00:00' },
      { diaSemana: 6, inicio: '19:00', fim: '00:00' },
    ]);
  });

  test('rodar de novo não sobrescreve preço, estoque nem ativo editados pelo dono', async () => {
    await prisma.produto.update({
      where: { nome: 'Coca-Cola 2L' },
      data: { precoCentavos: 1600, estoque: 12, ativo: false },
    });
    await prisma.insumo.update({ where: { nome: 'Pão de lanche' }, data: { estoque: 40 } });

    await seed(prisma, { log: () => {} });

    const coca = await prisma.produto.findUnique({ where: { nome: 'Coca-Cola 2L' } });
    assert.equal(coca.precoCentavos, 1600);
    assert.equal(coca.estoque, 12);
    assert.equal(coca.ativo, false);
    const pao = await prisma.insumo.findUnique({ where: { nome: 'Pão de lanche' } });
    assert.equal(pao.estoque, 40);
  });

  test('avisos: marmitas e prato sem preço, Almoço sem horários, WhatsApp vazio', () => {
    const avisos = avisosPorRodada[0];
    const semPreco = avisos.filter((a) => a.includes('sem preço'));
    assert.equal(semPreco.length, 4);
    assert.ok(avisos.some((a) => a.includes('Turno "Almoço" sem horários')));
    assert.ok(avisos.some((a) => a.includes('whatsappNumero vazio')));
  });
});
