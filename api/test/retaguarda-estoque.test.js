import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { abaixoDoMinimo } from '../src/services/estoque.service.js';

test('abaixoDoMinimo: estritamente menor; mínimo vazio nunca destaca', () => {
  assert.equal(abaixoDoMinimo(2, 3), true);
  assert.equal(abaixoDoMinimo(3, 3), false);
  assert.equal(abaixoDoMinimo(0, null), false);
  assert.equal(abaixoDoMinimo(null, 1), true);
});

describe('retaguarda: estoque (entrada, ajuste, histórico)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tkDono;
  let dono;
  let eventos = [];
  let pararEventos;
  const p = {};
  const ins = {};

  async function api(metodo, rota, corpo) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tkDono}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarDono } = await import('../src/services/usuario.service.js');
    const { aoEmitirParaEquipe } = await import('../src/lib/eventos.js');
    pararEventos = aoEmitirParaEquipe((evento, dados) => eventos.push({ evento, dados }));

    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    for (const i of await prisma.insumo.findMany()) ins[i.nome] = i;
    dono = await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });

    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const r = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dono@teste.com', senha: 'senha-do-dono' }),
    });
    tkDono = (await r.json()).accessToken;
  });

  beforeEach(() => {
    eventos = [];
  });

  after(async () => {
    pararEventos?.();
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  const coca = () => p['Refrigerante Lata'];
  const pao = () => ins['Pão de lanche'];

  test('visão geral: bebidas com estoque próprio e insumos, com destaque abaixo do mínimo', async () => {
    await prisma.produto.update({ where: { id: coca().id }, data: { estoque: 2, estoqueMinimo: 6 } });
    await prisma.insumo.update({ where: { id: pao().id }, data: { estoque: 10, estoqueMinimo: 5 } });
    const r = await api('GET', '/retaguarda/estoque');
    assert.equal(r.status, 200);
    assert.ok(r.corpo.produtos.every((x) => typeof x.estoque === 'number'));
    assert.equal(r.corpo.produtos.some((x) => x.nome === 'Prato por kg'), false, 'só quem controla estoque');
    const c = r.corpo.produtos.find((x) => x.id === coca().id);
    assert.equal(c.abaixoDoMinimo, true);
    const i = r.corpo.insumos.find((x) => x.id === pao().id);
    assert.equal(i.abaixoDoMinimo, false);
    assert.ok(i.produtos.length > 0, 'insumo mostra os produtos que o consomem');
  });

  test('entrada soma ao saldo e grava ENTRADA com usuarioId e motivo; emite cardapio:atualizado', async () => {
    await prisma.produto.update({ where: { id: coca().id }, data: { estoque: 3 } });
    const r = await api('POST', '/retaguarda/estoque/entrada', { produtoId: coca().id, quantidade: 24, motivo: 'Fardo do mercado' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.item.estoque, 27);
    const m = await prisma.movimentacaoEstoque.findUnique({ where: { id: r.corpo.movimentacao.id } });
    assert.equal(m.tipo, 'ENTRADA');
    assert.equal(m.quantidade, 24);
    assert.equal(m.usuarioId, dono.id);
    assert.equal(m.motivo, 'Fardo do mercado');
    assert.equal(m.produtoId, coca().id);
    assert.deepEqual(eventos, [{ evento: 'cardapio:atualizado', dados: { origem: 'estoque' } }]);

    const semMotivo = await api('POST', '/retaguarda/estoque/entrada', { insumoId: pao().id, quantidade: 5 });
    assert.equal(semMotivo.status, 201);
    assert.equal(semMotivo.corpo.movimentacao.motivo, null);
    assert.equal(semMotivo.corpo.movimentacao.usuario.id, dono.id);
  });

  test('entradas simultâneas não se perdem (incremento atômico)', async () => {
    await prisma.insumo.update({ where: { id: pao().id }, data: { estoque: 0 } });
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => api('POST', '/retaguarda/estoque/entrada', { insumoId: pao().id, quantidade: 3 })),
    );
    assert.ok(rs.every((r) => r.status === 201));
    assert.equal((await prisma.insumo.findUnique({ where: { id: pao().id } })).estoque, 30);
  });

  test('ajuste grava o saldo contado e a movimentação AJUSTE com o delta, usuarioId e motivo', async () => {
    await prisma.produto.update({ where: { id: coca().id }, data: { estoque: 20 } });
    const r = await api('POST', '/retaguarda/estoque/ajuste', { produtoId: coca().id, saldoContado: 17, motivo: 'Contagem: 3 latas amassadas' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.item.estoque, 17);
    const m = await prisma.movimentacaoEstoque.findUnique({ where: { id: r.corpo.movimentacao.id } });
    assert.equal(m.tipo, 'AJUSTE');
    assert.equal(m.quantidade, -3);
    assert.equal(m.usuarioId, dono.id);
    assert.equal(m.motivo, 'Contagem: 3 latas amassadas');
    assert.equal((await prisma.produto.findUnique({ where: { id: coca().id } })).estoque, 17);

    const sobe = await api('POST', '/retaguarda/estoque/ajuste', { insumoId: pao().id, saldoContado: 40, motivo: 'Recontagem' });
    assert.equal(sobe.status, 201);
    const atual = 40 - (await prisma.movimentacaoEstoque.findUnique({ where: { id: sobe.corpo.movimentacao.id } })).quantidade;
    assert.equal(atual, 30, 'delta = contado − saldo anterior');
    assert.equal((await prisma.movimentacaoEstoque.findUnique({ where: { id: sobe.corpo.movimentacao.id } })).usuarioId, dono.id);
  });

  test('ajuste sem diferença não grava movimentação nem emite evento', async () => {
    await prisma.produto.update({ where: { id: coca().id }, data: { estoque: 9 } });
    const antes = await prisma.movimentacaoEstoque.count();
    const r = await api('POST', '/retaguarda/estoque/ajuste', { produtoId: coca().id, saldoContado: 9, motivo: 'Conferência' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.movimentacao, null);
    assert.equal(await prisma.movimentacaoEstoque.count(), antes);
    assert.deepEqual(eventos, []);
  });

  test('validação: motivo obrigatório no ajuste, saldo negativo, sem alvo ou com os dois alvos = 400', async () => {
    const antes = await prisma.movimentacaoEstoque.count();
    for (const corpo of [
      { produtoId: coca().id, saldoContado: 5 },
      { produtoId: coca().id, saldoContado: 5, motivo: '   ' },
      { produtoId: coca().id, saldoContado: -1, motivo: 'x' },
      { produtoId: coca().id, saldoContado: 1.5, motivo: 'x' },
      { saldoContado: 5, motivo: 'x' },
      { produtoId: coca().id, insumoId: pao().id, saldoContado: 5, motivo: 'x' },
    ]) {
      assert.equal((await api('POST', '/retaguarda/estoque/ajuste', corpo)).status, 400, JSON.stringify(corpo));
    }
    for (const corpo of [{ produtoId: coca().id, quantidade: 0 }, { produtoId: coca().id, quantidade: -2 }, { produtoId: coca().id }]) {
      assert.equal((await api('POST', '/retaguarda/estoque/entrada', corpo)).status, 400, JSON.stringify(corpo));
    }
    assert.equal(await prisma.movimentacaoEstoque.count(), antes);
  });

  test('produto sem controle de estoque = 422 SEM_CONTROLE_DE_ESTOQUE; inexistente = 404', async () => {
    const semControle = Object.values(p).find((x) => !x.controlaEstoque);
    for (const [rota, corpo] of [
      ['/retaguarda/estoque/entrada', { produtoId: semControle.id, quantidade: 1 }],
      ['/retaguarda/estoque/ajuste', { produtoId: semControle.id, saldoContado: 1, motivo: 'x' }],
    ]) {
      const r = await api('POST', rota, corpo);
      assert.equal(r.status, 422, rota);
      assert.equal(r.corpo.erro.codigo, 'SEM_CONTROLE_DE_ESTOQUE');
    }
    assert.equal((await api('POST', '/retaguarda/estoque/entrada', { produtoId: 999999, quantidade: 1 })).status, 404);
    assert.equal((await api('POST', '/retaguarda/estoque/ajuste', { insumoId: 999999, saldoContado: 1, motivo: 'x' })).status, 404);
  });

  test('ajuste e venda ao mesmo tempo: Σ movimentações = variação do saldo (nada se perde)', async () => {
    const { criarPedido } = await import('../src/services/pedido.service.js');
    await prisma.produto.update({ where: { id: coca().id }, data: { estoque: 10, ativo: true } });
    const desde = (await prisma.movimentacaoEstoque.aggregate({ _max: { id: true } }))._max.id ?? 0;
    const [ajuste, venda] = await Promise.all([
      api('POST', '/retaguarda/estoque/ajuste', { produtoId: coca().id, saldoContado: 4, motivo: 'Contagem' }),
      criarPedido({ canal: 'SALAO', itens: [{ produtoId: coca().id, quantidade: 2 }], cliente: { nome: 'Mesa' } }),
    ]);
    assert.equal(ajuste.status, 201, JSON.stringify(ajuste.corpo));
    assert.ok(venda.pedido.id);
    const final = (await prisma.produto.findUnique({ where: { id: coca().id } })).estoque;
    assert.ok([2, 4].includes(final), `saldo final ${final}`); // venda depois do ajuste = 2; antes = 4
    const { _sum } = await prisma.movimentacaoEstoque.aggregate({
      where: { produtoId: coca().id, id: { gt: desde } },
      _sum: { quantidade: true },
    });
    assert.equal(_sum.quantidade, final - 10);
  });

  test('histórico: mais recente primeiro, filtros por produto/insumo/tipo e paginação por antesDeId', async () => {
    for (let i = 0; i < 55; i++) {
      await prisma.movimentacaoEstoque.create({
        data: { tipo: 'ENTRADA', insumoId: pao().id, quantidade: 1, usuarioId: dono.id, motivo: `lote ${i}` },
      });
    }
    const pg1 = await api('GET', `/retaguarda/estoque/movimentacoes?insumoId=${pao().id}`);
    assert.equal(pg1.status, 200);
    assert.equal(pg1.corpo.movimentacoes.length, 50);
    const ids = pg1.corpo.movimentacoes.map((m) => m.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    assert.ok(pg1.corpo.movimentacoes.every((m) => m.insumo?.id === pao().id));
    assert.equal(pg1.corpo.movimentacoes[0].usuario.nome, 'Dono');
    assert.ok(pg1.corpo.proximo);

    const pg2 = await api('GET', `/retaguarda/estoque/movimentacoes?insumoId=${pao().id}&antesDeId=${pg1.corpo.proximo}`);
    assert.ok(pg2.corpo.movimentacoes.every((m) => m.id < pg1.corpo.proximo));

    const ajustes = await api('GET', '/retaguarda/estoque/movimentacoes?tipo=AJUSTE');
    assert.ok(ajustes.corpo.movimentacoes.length > 0);
    assert.ok(ajustes.corpo.movimentacoes.every((m) => m.tipo === 'AJUSTE'));

    const vendas = await api('GET', `/retaguarda/estoque/movimentacoes?produtoId=${coca().id}&tipo=VENDA`);
    for (const m of vendas.corpo.movimentacoes) assert.ok(m.pedido?.numeroDia, 'venda mostra o pedido');

    assert.equal((await api('GET', `/retaguarda/estoque/movimentacoes?produtoId=1&insumoId=1`)).status, 400);
    assert.equal((await api('GET', '/retaguarda/estoque/movimentacoes?tipo=ROUBO')).status, 400);
  });

  test('insumos: criar (saldo 0), renomear, mínimo; nome repetido = 409; o saldo não muda pelo cadastro', async () => {
    const r = await api('POST', '/retaguarda/insumos', { nome: 'Pão de hambúrguer australiano', estoqueMinimo: 4 });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.insumo.estoque, 0);
    assert.equal(r.corpo.insumo.abaixoDoMinimo, true);
    assert.deepEqual(eventos.map((e) => e.evento), ['cardapio:atualizado']);

    const rep = await api('POST', '/retaguarda/insumos', { nome: 'Pão de hambúrguer australiano' });
    assert.equal(rep.status, 409);
    assert.equal(rep.corpo.erro.codigo, 'NOME_EM_USO');

    const alt = await api('PUT', `/retaguarda/insumos/${r.corpo.insumo.id}`, { nome: 'Pão australiano', estoqueMinimo: 0, estoque: 999 });
    assert.equal(alt.status, 200);
    assert.equal(alt.corpo.insumo.nome, 'Pão australiano');
    assert.equal(alt.corpo.insumo.estoque, 0, 'estoque no corpo é ignorado');
    assert.equal((await api('PUT', '/retaguarda/insumos/999999', { nome: 'X' })).status, 404);
  });
});
