import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // turno Lanches aberto

describe('fila de impressão (/equipe/impressoes)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let criarPedido;
  let token;
  let centro;
  let coca;

  async function api(metodo, rota, { corpo, semToken } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (!semToken) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, headers: res.headers, corpo: texto ? JSON.parse(texto) : null };
  }

  const zap = (nome, quando = SABADO_20H) =>
    criarPedido({
      lojaId: 1,
      canal: 'WHATSAPP',
      itens: [{ produtoId: coca.id, quantidade: 1, observacao: 'bem gelada' }],
      cliente: { nome, telefone: '43988887777' },
      endereco: { texto: 'Rua A, 10', bairroId: centro.id },
      pagamento: { forma: 'PIX' },
      agora: quando,
    });

  const pendentes = async () => (await api('GET', '/equipe/impressoes/pendentes')).corpo;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    ({ criarPedido } = await import('../src/services/pedido.service.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');

    coca = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: 1, nome: 'Coca-Cola 1L' } } });
    await prisma.produto.update({ where: { id: coca.id }, data: { ativo: true, estoque: 50 } });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' }, semToken: true });
    token = login.corpo.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('exige login da equipe e não guarda em cache', async () => {
    assert.equal((await api('GET', '/equipe/impressoes/pendentes', { semToken: true })).status, 401);
    const r = await api('GET', '/equipe/impressoes/pendentes');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('pendentes: em ordem de id, com o pedido completo e o nome do restaurante', async () => {
    const a = (await zap('Primeiro')).pedido;
    const b = (await zap('Segundo')).pedido;
    const r = await pendentes();
    assert.equal(r.restaurante.nome, 'Cabana Boemia');
    assert.equal(r.limite, 50);
    const meus = r.trabalhos.filter((t) => [a.id, b.id].includes(t.pedidoId));
    assert.deepEqual(meus.map((t) => t.pedido.nomeCliente), ['Primeiro', 'Segundo']);
    const ids = r.trabalhos.map((t) => t.id);
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
    const t = meus[0];
    assert.equal(t.tipo, 'PEDIDO');
    assert.equal(t.status, 'PENDENTE');
    assert.equal(t.pedido.itens[0].observacao, 'bem gelada');
    assert.equal(t.pedido.telefone, '43988887777');
  });

  test('confirmar o mesmo id duas vezes não duplica (idempotente)', async () => {
    const { pedido } = await zap('Duplo');
    const trabalho = (await pendentes()).trabalhos.find((t) => t.pedidoId === pedido.id);

    const r1 = await api('POST', `/equipe/impressoes/${trabalho.id}/confirmar`);
    assert.equal(r1.status, 200);
    assert.equal(r1.corpo.jaConfirmado, false);
    assert.equal(r1.corpo.trabalho.status, 'IMPRESSO');
    const impressoEm = r1.corpo.trabalho.impressoEm;

    agora = new Date(SABADO_20H.getTime() + 60_000);
    const r2 = await api('POST', `/equipe/impressoes/${trabalho.id}/confirmar`);
    agora = SABADO_20H;
    assert.equal(r2.status, 200);
    assert.equal(r2.corpo.jaConfirmado, true);
    assert.equal(r2.corpo.trabalho.impressoEm, impressoEm, 'segunda confirmação não muda nada');

    const noBanco = await prisma.trabalhoImpressao.findMany({ where: { pedidoId: pedido.id } });
    assert.equal(noBanco.length, 1, 'nenhum trabalho novo');
    assert.ok(!(await pendentes()).trabalhos.some((t) => t.id === trabalho.id), 'saiu dos pendentes');
  });

  test('confirmações simultâneas: só uma muda o registro', async () => {
    const { pedido } = await zap('Corrida');
    const trabalho = (await pendentes()).trabalhos.find((t) => t.pedidoId === pedido.id);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => api('POST', `/equipe/impressoes/${trabalho.id}/confirmar`)),
    );
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(rs.filter((r) => r.corpo.jaConfirmado === false).length, 1);
  });

  test('falha incrementa tentativas, guarda o erro e mantém pendente', async () => {
    const { pedido } = await zap('Sem papel');
    const trabalho = (await pendentes()).trabalhos.find((t) => t.pedidoId === pedido.id);

    const r1 = await api('POST', `/equipe/impressoes/${trabalho.id}/falha`, { corpo: { erro: 'Sem papel' } });
    assert.equal(r1.status, 200);
    assert.equal(r1.corpo.trabalho.tentativas, 1);
    assert.equal(r1.corpo.trabalho.ultimoErro, 'Sem papel');
    const r2 = await api('POST', `/equipe/impressoes/${trabalho.id}/falha`, { corpo: {} });
    assert.equal(r2.corpo.trabalho.tentativas, 2);
    assert.equal(r2.corpo.trabalho.ultimoErro, 'Falha na impressão');

    const ainda = (await pendentes()).trabalhos.find((t) => t.id === trabalho.id);
    assert.equal(ainda.status, 'PENDENTE', 'volta na próxima busca: nada se perde');
    assert.equal(ainda.tentativas, 2);

    // Confirmado depois: falha não reabre.
    await api('POST', `/equipe/impressoes/${trabalho.id}/confirmar`);
    const r3 = await api('POST', `/equipe/impressoes/${trabalho.id}/falha`, { corpo: { erro: 'tarde' } });
    assert.equal(r3.status, 409);
    assert.equal(r3.corpo.erro.codigo, 'TRABALHO_IMPRESSO');
    const final = await prisma.trabalhoImpressao.findUnique({ where: { id: trabalho.id } });
    assert.equal(final.status, 'IMPRESSO');
    assert.equal(final.tentativas, 2);
  });

  test('id inexistente = 404; id inválido = 400', async () => {
    assert.equal((await api('POST', '/equipe/impressoes/999999/confirmar')).status, 404);
    assert.equal((await api('POST', '/equipe/impressoes/999999/falha', { corpo: {} })).status, 404);
    assert.equal((await api('POST', '/equipe/impressoes/abc/confirmar')).status, 400);
  });

  test('pendente de dias atrás não volta (janela: dia local + 2 h antes)', async () => {
    const { pedido } = await zap('Antigo');
    const t = await prisma.trabalhoImpressao.findFirst({ where: { pedidoId: pedido.id } });
    await prisma.trabalhoImpressao.update({ where: { id: t.id }, data: { criadoEm: local('2026-11-12T20:00') } });
    assert.ok(!(await pendentes()).trabalhos.some((x) => x.id === t.id));

    // 23h50 de ontem ainda sai às 00h30 de hoje.
    await prisma.trabalhoImpressao.update({ where: { id: t.id }, data: { criadoEm: local('2026-11-14T23:50') } });
    agora = local('2026-11-15T00:30');
    try {
      assert.ok((await pendentes()).trabalhos.some((x) => x.id === t.id));
    } finally {
      agora = SABADO_20H;
    }
  });

  test('cancelar o pedido cria trabalho CANCELAMENTO pendente', async () => {
    const { pedido } = await zap('Cancela');
    assert.equal((await api('PATCH', `/equipe/pedidos/${pedido.id}/cancelar`)).status, 200);
    const tipos = (await pendentes()).trabalhos.filter((t) => t.pedidoId === pedido.id).map((t) => t.tipo);
    assert.deepEqual(tipos, ['PEDIDO', 'CANCELAMENTO']);
    const cancel = (await pendentes()).trabalhos.find((t) => t.pedidoId === pedido.id && t.tipo === 'CANCELAMENTO');
    assert.equal(cancel.pedido.status, 'CANCELADO');
    assert.equal(cancel.pedido.itens.length, 1, 'itens continuam para o cupom');
  });

  test('reimprimir cria um trabalho NOVO e avisa a equipe pelo socket', async () => {
    const { pedido } = await zap('Reimprime');
    const original = (await pendentes()).trabalhos.find((t) => t.pedidoId === pedido.id);
    await api('POST', `/equipe/impressoes/${original.id}/confirmar`);

    const socket = conectarSocket(new URL(base).origin, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    try {
      const chegou = new Promise((resolve) => socket.once('impressao:nova', resolve));
      const r = await api('POST', `/equipe/pedidos/${pedido.id}/reimprimir`);
      assert.equal(r.status, 201);
      assert.notEqual(r.corpo.trabalho.id, original.id);
      assert.equal(r.corpo.trabalho.tipo, 'PEDIDO');
      assert.equal((await chegou).id, r.corpo.trabalho.id);
      const orig = await prisma.trabalhoImpressao.findUnique({ where: { id: original.id } });
      assert.equal(orig.status, 'IMPRESSO', 'o antigo continua impresso');
    } finally {
      socket.close();
    }

    // Pedido cancelado reimprime o cupom de cancelamento.
    const { pedido: p2 } = await zap('Reimprime cancelado');
    await api('PATCH', `/equipe/pedidos/${p2.id}/cancelar`);
    const r2 = await api('POST', `/equipe/pedidos/${p2.id}/reimprimir`);
    assert.equal(r2.corpo.trabalho.tipo, 'CANCELAMENTO');
    assert.equal((await api('POST', '/equipe/pedidos/999999/reimprimir')).status, 404);
  });
});
