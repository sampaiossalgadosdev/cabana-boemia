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
      loja: 1,
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
      where: { lojaId_nome: { lojaId: 1, nome: 'Prato por kg' } },
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

  test('produtos são criados com disponivelHoje = true', async () => {
    const indisponiveis = await prisma.produto.count({ where: { disponivelHoje: false } });
    assert.equal(indisponiveis, 0);
  });

  test('rodar de novo não sobrescreve preço, estoque, ativo nem disponivelHoje editados pelo dono', async () => {
    await prisma.produto.update({
      where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } },
      data: { precoCentavos: 1600, estoque: 12, ativo: false, disponivelHoje: false },
    });
    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } }, data: { estoque: 40 } });

    await seed(prisma, { log: () => {} });

    const coca = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } } });
    assert.equal(coca.precoCentavos, 1600);
    assert.equal(coca.estoque, 12);
    assert.equal(coca.ativo, false);
    assert.equal(coca.disponivelHoje, false, 'o dono desligou: o seed não religa');
    const pao = await prisma.insumo.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } } });
    assert.equal(pao.estoque, 40);
  });

  test('rodar de novo não desfaz a ordem das categorias nem a categoria/ordem dos produtos editadas pelo dono', async () => {
    const lanches = await prisma.categoria.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Lanches' } } });
    const bebidas = await prisma.categoria.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Bebidas' } } });
    await prisma.categoria.update({ where: { id: lanches.id }, data: { ordem: 90 } });
    await prisma.categoria.update({ where: { id: bebidas.id }, data: { ordem: 5 } });
    const coca = await prisma.produto.update({
      where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } },
      data: { categoriaId: lanches.id, ordem: 77 },
    });

    await seed(prisma, { log: () => {} });

    assert.equal((await prisma.categoria.findUnique({ where: { id: lanches.id } })).ordem, 90);
    assert.equal((await prisma.categoria.findUnique({ where: { id: bebidas.id } })).ordem, 5);
    const depois = await prisma.produto.findUnique({ where: { id: coca.id } });
    assert.equal(depois.categoriaId, lanches.id, 'o dono mudou de categoria: o seed não devolve');
    assert.equal(depois.ordem, 77);
  });

  test('avisos: marmitas e prato sem preço, Almoço sem horários, WhatsApp vazio', () => {
    const avisos = avisosPorRodada[0];
    const semPreco = avisos.filter((a) => a.includes('sem preço'));
    assert.equal(semPreco.length, 4);
    assert.ok(avisos.some((a) => a.includes('Turno "Almoço" sem horários')));
    assert.ok(avisos.some((a) => a.includes('WhatsApp da loja vazio')));
  });

  test('logo e cor padrão da Cabana: gravadas uma vez (logo do shared/assets); o seed não troca a do dono', async () => {
    const cabana = await prisma.loja.findUnique({ where: { slug: 'cabana-boemia' } });
    assert.match(cabana.logoUrlPadrao, /^\/api\/publico\/imagens\/\d+$/);
    assert.equal(cabana.logoUrl, cabana.logoUrlPadrao);
    assert.equal(cabana.corPrimariaPadrao, '#C8102E');
    assert.equal(await prisma.imagemLoja.count(), 1, 'rodou várias vezes: uma imagem só');
    const img = await prisma.imagemLoja.findFirst();
    assert.equal(img.mime, 'image/png');

    await prisma.loja.update({ where: { id: cabana.id }, data: { corPrimaria: '#1E3A5F', logoUrl: null } });
    await seed(prisma, { log: () => {} });
    const depois = await prisma.loja.findUnique({ where: { id: cabana.id } });
    assert.equal(depois.corPrimaria, '#1E3A5F');
    assert.equal(depois.logoUrl, null, 'o seed não mexe na logo atual');
    await prisma.loja.update({ where: { id: cabana.id }, data: { corPrimaria: '#C8102E', logoUrl: cabana.logoUrl } });
  });

  test('seed por loja: o JSON da loja de teste cria outra loja, sem tocar na Cabana', async () => {
    const antes = await contarTabelas(prisma);
    const { CAMINHO_JSON } = await import('../prisma/seed.js');
    const caminho = new URL('../prisma/cardapios/loja-teste.json', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    await seed(prisma, { caminho: fileURLToPath(caminho), log: () => {} });
    await seed(prisma, { caminho: fileURLToPath(caminho), log: () => {} }); // idempotente
    assert.ok(CAMINHO_JSON.endsWith('cardapio-cabana-boemia.json'));

    const teste = await prisma.loja.findUnique({ where: { slug: 'lanchonete-teste' } });
    assert.equal(teste.nome, 'Lanchonete Teste');
    assert.equal(teste.corPrimaria, '#1E7B3C');
    assert.equal(teste.corPrimariaPadrao, '#1E7B3C');
    assert.match(teste.logoUrl, /^\/api\/publico\/imagens\/\d+$/);
    assert.equal(await prisma.produto.count({ where: { lojaId: teste.id } }), 4, 'sem Prato por kg');
    assert.equal(await prisma.turno.count({ where: { lojaId: teste.id } }), 1);
    assert.equal(await prisma.horarioTurno.count({ where: { turno: { lojaId: teste.id } } }), 7);
    const areas = await prisma.areaEntrega.findMany({ where: { lojaId: teste.id }, include: { bairro: true }, orderBy: { taxaCentavos: 'asc' } });
    assert.deepEqual(areas.map((a) => [a.bairro.nome, a.taxaCentavos]), [['Centro', 400], ['Jardim Primavera', 600]]);
    // A Cabana continua igual (só ganhou os bairros na lista da cidade, que é da plataforma).
    const depois = await contarTabelas(prisma);
    assert.equal(depois.loja, antes.loja + 1);
    assert.equal(depois.produto, antes.produto + 4);
    assert.equal(await prisma.produto.count({ where: { lojaId: 1 } }), 30);
    assert.equal(await prisma.areaEntrega.count({ where: { lojaId: 1 } }), 0);
  });
});
