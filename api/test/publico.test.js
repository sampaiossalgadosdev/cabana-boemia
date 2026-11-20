import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00');
const QUINTA_18H59 = local('2026-11-12T18:59');

describe('rotas públicas do site', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;

  async function get(rota) {
    const res = await fetch(`${base}${rota}`);
    return { status: res.status, headers: res.headers, corpo: await res.json() };
  }

  const nomesNoCardapio = async () =>
    (await get('/publico/cardapio')).corpo.categorias.flatMap((c) => c.produtos.map((p) => p.nome));

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });

    const { criarApp } = await import('../src/app.js');
    const app = criarApp({ log: false, relogio: () => agora });
    servidor = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${servidor.address().port}/api`;
  });

  // Estado conhecido: tudo disponível hoje, com saldo.
  beforeEach(async () => {
    agora = SABADO_20H;
    await prisma.produto.updateMany({ data: { disponivelHoje: true } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 10 } });
    await prisma.insumo.updateMany({ data: { estoque: 10 } });
    await prisma.loja.update({
      where: { id: 1 },
      data: { tempoEstimadoPadraoMin: 40, tempoEstimadoManualMin: null, tempoManualDefinidoEm: null },
    });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('sábado 20:00: aberto no turno Lanches, só produtos vendáveis no site', async () => {
    const { status, corpo } = await get('/publico/cardapio');
    assert.equal(status, 200);
    assert.equal(corpo.aberto, true);
    assert.equal(corpo.turno.nome, 'Lanches');
    assert.equal(corpo.proximaAbertura, null);
    assert.deepEqual(
      corpo.categorias.map((c) => c.nome),
      ['Lanches', 'Pizzas', 'Porções', 'Bebidas'],
    );
    const nomes = corpo.categorias.flatMap((c) => c.produtos.map((p) => p.nome));
    assert.equal(nomes.length, 26);
    assert.ok(!nomes.includes('Prato por kg'));
    assert.ok(!nomes.some((n) => n.startsWith('Marmita')));
    // Não vaza dados internos de estoque: só o limite da sacola (até 20).
    assert.deepEqual(Object.keys(corpo.categorias[0].produtos[0]).sort(), [
      'descricao',
      'id',
      'imagemUrl',
      'maxSacola',
      'nome',
      'precoCentavos',
      'sugerirNaSacola',
      'tipoPreco',
    ]);
  });

  test('maxSacola: saldo do produto ou dos insumos, nunca acima de 20; fechado = null; sugerirNaSacola', async () => {
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } }, data: { estoque: 3, sugerirNaSacola: true } });
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 1L' } }, data: { estoque: 500 } });
    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } }, data: { estoque: 4 } });
    try {
      const produtos = new Map((await get('/publico/cardapio')).corpo.categorias.flatMap((c) => c.produtos).map((p) => [p.nome, p]));
      assert.equal(produtos.get('Coca-Cola 2L').maxSacola, 3);
      assert.equal(produtos.get('Coca-Cola 2L').sugerirNaSacola, true);
      assert.equal(produtos.get('Coca-Cola 1L').maxSacola, 20, 'estoque alto não aparece');
      assert.equal(produtos.get('Coca-Cola 1L').sugerirNaSacola, false);
      assert.equal(produtos.get('X-Bacon').maxSacola, 4, 'limitado pelo pão');
      assert.equal(produtos.get('Pizza Bacon').maxSacola, 20, 'sem controle de estoque');

      agora = QUINTA_18H59;
      const fechado = (await get('/publico/cardapio')).corpo;
      assert.equal(fechado.aberto, false);
      assert.ok(fechado.categorias.flatMap((c) => c.produtos).every((p) => p.maxSacola === null));
    } finally {
      agora = SABADO_20H;
      await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } }, data: { sugerirNaSacola: false } });
    }
  });

  test('lanche some do cardápio quando o pão zera', async () => {
    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de lanche' } }, data: { estoque: 0 } });
    const nomes = await nomesNoCardapio();
    assert.ok(!nomes.includes('Misto Quente'));
    assert.ok(!nomes.includes('X-Tudo'));
    assert.ok(nomes.includes('Cachorro Quente'), 'usa outro pão, continua');

    await prisma.insumo.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pão de cachorro-quente' } }, data: { estoque: 0 } });
    const cats = (await get('/publico/cardapio')).corpo.categorias.map((c) => c.nome);
    assert.ok(!cats.includes('Lanches'), 'categoria vazia não aparece');
  });

  test('bebida some quando o estoque zera', async () => {
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 2L' } }, data: { estoque: 0 } });
    const nomes = await nomesNoCardapio();
    assert.ok(!nomes.includes('Coca-Cola 2L'));
    assert.ok(nomes.includes('Coca-Cola 1L'));
  });

  test('produto fora do cardápio do dia ou inativo não aparece', async () => {
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Pizza Bacon' } }, data: { disponivelHoje: false } });
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } }, data: { ativo: false } });
    const nomes = await nomesNoCardapio();
    assert.ok(!nomes.includes('Pizza Bacon'));
    assert.ok(!nomes.includes('Salame'));
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } }, data: { ativo: true } });
  });

  test('quinta 18:59: fechado, com próxima abertura e prévia do cardápio do turno Lanches', async () => {
    agora = QUINTA_18H59;
    const { corpo } = await get('/publico/cardapio');
    assert.equal(corpo.aberto, false);
    assert.equal(corpo.turno, null);
    assert.equal(corpo.proximaAbertura.turno.nome, 'Lanches');
    assert.equal(corpo.proximaAbertura.em, '2026-11-12T22:00:00.000Z');
    assert.deepEqual(
      corpo.categorias.map((c) => c.nome),
      ['Lanches', 'Pizzas', 'Porções', 'Bebidas'],
    );
  });

  test('prévia com a loja fechada ignora disponivelHoje e saldo, mas não ativo nem vendidoNoSite', async () => {
    agora = QUINTA_18H59;
    await prisma.produto.updateMany({ data: { disponivelHoje: false } });
    await prisma.insumo.updateMany({ data: { estoque: 0 } });
    await prisma.produto.updateMany({ where: { controlaEstoque: true }, data: { estoque: 0 } });
    await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } }, data: { ativo: false } });
    try {
      const nomes = await nomesNoCardapio();
      assert.equal(nomes.length, 25, '26 do turno Lanches menos o Salame inativo');
      assert.ok(nomes.includes('X-Tudo'), 'sem pão continua na prévia');
      assert.ok(nomes.includes('Coca-Cola 2L'), 'sem estoque continua na prévia');
      assert.ok(!nomes.includes('Salame'));
      assert.ok(!nomes.includes('Prato por kg'));
      assert.ok(!nomes.some((n) => n.startsWith('Marmita')), 'Almoço não é o próximo turno');
    } finally {
      await prisma.produto.update({ where: { lojaId_nome: { lojaId: 1, nome: 'Salame' } }, data: { ativo: true } });
    }
  });

  test('fechado e sem nenhum horário cadastrado: sem próxima abertura e sem categorias', async () => {
    agora = QUINTA_18H59;
    const horarios = await prisma.horarioTurno.findMany();
    await prisma.horarioTurno.deleteMany();
    try {
      const { corpo } = await get('/publico/cardapio');
      assert.equal(corpo.aberto, false);
      assert.equal(corpo.proximaAbertura, null);
      assert.deepEqual(corpo.categorias, []);
    } finally {
      await prisma.horarioTurno.createMany({ data: horarios });
    }
  });

  test('tempoEstimadoMin: manual vale no dia OPERACIONAL em que foi definido (vira às 04:00)', async () => {
    // Sábado 20:00. Definido sábado 04:00: mesmo dia operacional.
    await prisma.loja.update({
      where: { id: 1 },
      data: { tempoEstimadoManualMin: 70, tempoManualDefinidoEm: local('2026-11-14T04:00') },
    });
    assert.equal((await get('/publico/cardapio')).corpo.tempoEstimadoMin, 70);

    // Sábado 00:10 ainda é o expediente de sexta: para sábado 20:00, vale o padrão.
    await prisma.loja.update({ where: { id: 1 }, data: { tempoManualDefinidoEm: local('2026-11-14T00:10') } });
    assert.equal((await get('/publico/cardapio')).corpo.tempoEstimadoMin, 40);

    // Definido sexta 23:00 e consultado sábado 00:30: mesmo expediente, continua valendo.
    agora = local('2026-11-14T00:30');
    await prisma.loja.update({ where: { id: 1 }, data: { tempoManualDefinidoEm: local('2026-11-13T23:00') } });
    assert.equal((await get('/publico/cardapio')).corpo.tempoEstimadoMin, 70);
    agora = SABADO_20H;
  });

  test('cache-control curto e sem autenticação', async () => {
    for (const rota of ['/publico/cardapio', '/publico/bairros', '/publico/config']) {
      const r = await get(rota);
      assert.equal(r.status, 200, rota);
      assert.equal(r.headers.get('cache-control'), 'public, max-age=15', rota);
    }
  });

  test('GET /publico/bairros: onde a loja entrega (área ativa, bairro ativo na cidade), com a taxa dela, em ordem alfabética', async () => {
    await criarBairro(prisma, { nome: 'Vila Nova', taxaCentavos: 700 });
    await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await criarBairro(prisma, { nome: 'Sítio Desativado', taxaCentavos: 1500, ativo: false });
    await criarBairro(prisma, { nome: 'Fechado na Cidade', taxaCentavos: 900, ativoNaCidade: false });
    await prisma.bairro.create({ data: { nome: 'Fora da Área' } }); // na cidade, mas a Cabana não entrega
    const { corpo } = await get('/publico/bairros');
    assert.deepEqual(
      corpo.bairros.map(({ nome, taxaCentavos }) => ({ nome, taxaCentavos })),
      [
        { nome: 'Centro', taxaCentavos: 500 },
        { nome: 'Vila Nova', taxaCentavos: 700 },
      ],
    );
  });

  test('GET /publico/config: nome, identidade da loja, whatsapp, client ID do Google e frete grátis (desligado)', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { whatsapp: '5543999990000' } });
    const { corpo } = await get('/publico/config');
    assert.match(corpo.logoUrl, /^\/api\/publico\/imagens\/\d+$/, 'logo do seed');
    assert.deepEqual(corpo, {
      nome: 'Cabana Boemia',
      slug: 'cabana-boemia',
      logoUrl: corpo.logoUrl,
      corPrimaria: '#C8102E',
      corTexto: '#FFFFFF',
      corFundo: '#FBF3E8',
      whatsapp: '5543999990000',
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      freteGratis: null,
    });
  });
});
