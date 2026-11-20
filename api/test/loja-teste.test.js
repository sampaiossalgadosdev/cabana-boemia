import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // Cabana (Lanches) e loja de teste (dia todo) abertas

/**
 * A loja de teste do script `criar-loja-teste` ao lado da Cabana: pedido de uma
 * não aparece no PDV (fila, socket, impressão) nem na retaguarda (relatório,
 * caixa) da outra, e cada uma tem a sua cor e a sua logo.
 */
describe('loja de teste (script) × Cabana: isolamento e identidade', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  const tk = {};
  let teste;
  let cabana;
  let gerarTokenCliente;

  async function api(metodo, rota, { corpo, token, cabecalhos = {} } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }
  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo;

  async function conectar(token, auth = {}) {
    const socket = conectarSocket(new URL(base).origin, { path: '/api/socket.io', auth: { token, ...auth }, transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarLojaTeste } = await import('../scripts/criar-loja-teste.js');
    const r = await criarLojaTeste({ senha: 'senha-da-loja-teste', log: () => {} });
    assert.equal(r.dono.criado, true);
    // Rodar de novo não duplica nada nem troca a senha.
    assert.equal((await criarLojaTeste({ log: () => {} })).dono.criado, false);
    teste = r.loja;
    cabana = await prisma.loja.findUnique({ where: { slug: 'cabana-boemia' } });

    ({ gerarTokenCliente } = await import('../src/lib/tokens.js'));
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarDono({ nome: 'Dono Cabana', email: 'dono@cabana.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');
    // Cabana: estoque e a área de entrega no Centro (a loja de teste já tem a dela).
    await prisma.insumo.updateMany({ where: { lojaId: cabana.id }, data: { estoque: 50 } });
    await prisma.produto.updateMany({ where: { lojaId: cabana.id, controlaEstoque: true }, data: { estoque: 50 } });
    const centro = await prisma.bairro.findUnique({ where: { nome: 'Centro' } });
    await prisma.areaEntrega.create({ data: { lojaId: cabana.id, bairroId: centro.id, taxaCentavos: 500 } });

    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    servidor = http.createServer(criarApp({ log: false, relogio: () => SABADO_20H }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.teste = (await login('dono@lanchonete-teste.test', 'senha-da-loja-teste')).accessToken;
    tk.cabana = (await login('dono@cabana.test', 'senha-do-dono')).accessToken;
    tk.admin = (await login('admin@teste.test', 'senha-do-admin')).accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('cada loja com a sua cor e a sua logo (login, PDV, retaguarda e vitrine do app)', async () => {
    const lt = (await login('dono@lanchonete-teste.test', 'senha-da-loja-teste')).usuario.loja;
    const cb = (await login('dono@cabana.test', 'senha-do-dono')).usuario.loja;
    assert.equal(lt.nome, 'Lanchonete Teste');
    assert.equal(lt.corPrimaria, '#1E7B3C');
    assert.equal(cb.corPrimaria, '#C8102E');
    assert.match(lt.logoUrl, /^\/api\/publico\/imagens\/\d+$/);
    assert.match(cb.logoUrl, /^\/api\/publico\/imagens\/\d+$/);
    assert.notEqual(lt.logoUrl, cb.logoUrl);
    const origem = new URL(base).origin;
    const [imgTeste, imgCabana] = await Promise.all([fetch(`${origem}${lt.logoUrl}`), fetch(`${origem}${cb.logoUrl}`)]);
    assert.equal(imgTeste.headers.get('content-type'), 'image/png');
    assert.notDeepEqual(Buffer.from(await imgTeste.arrayBuffer()), Buffer.from(await imgCabana.arrayBuffer()));

    assert.equal((await api('GET', '/equipe/loja', { token: tk.teste })).corpo.loja.corPrimaria, '#1E7B3C');
    assert.equal((await api('GET', '/retaguarda/perfil', { token: tk.cabana })).corpo.perfil.corPrimaria, '#C8102E');
    const vitrine = (await api('GET', '/publico/lojas')).corpo.lojas;
    assert.deepEqual(
      vitrine.map((l) => [l.slug, l.corPrimaria]),
      [['cabana-boemia', '#C8102E'], ['lanchonete-teste', '#1E7B3C']],
    );
  });

  test('vitrine e rotas por loja: logo como URL da rota de imagem (nunca base64 no JSON); dados legais; bairros da cidade', async () => {
    const { lojas } = (await api('GET', '/publico/lojas')).corpo;
    const origem = new URL(base).origin;
    for (const l of lojas) {
      assert.match(l.logoUrl, /^\/api\/publico\/imagens\/\d+$/, l.slug);
      const img = await fetch(`${origem}${l.logoUrl}`);
      assert.equal(img.status, 200);
      assert.match(img.headers.get('cache-control'), /max-age=31536000/);
    }
    const texto = JSON.stringify(lojas);
    assert.ok(!texto.includes('data:image') && !texto.includes('base64'), 'nada de imagem embutida');
    await prisma.loja.update({ where: { id: teste.id }, data: { razaoSocial: 'Lanchonete Teste LTDA', documento: '11222333000181', endereco: 'Rua A, 1, Abatiá-PR' } });
    const cfg = (await api('GET', '/publico/lojas/lanchonete-teste/config')).corpo;
    assert.equal(cfg.razaoSocial, 'Lanchonete Teste LTDA');
    assert.equal(cfg.documento, '11222333000181');
    assert.equal(cfg.endereco, 'Rua A, 1, Abatiá-PR');
    assert.match(cfg.logoUrl, /^\/api\/publico\/imagens\/\d+$/);
    const cidade = (await api('GET', '/publico/bairros-da-cidade')).corpo.bairros;
    assert.deepEqual(cidade.map((b) => b.nome), ['Centro', 'Jardim Primavera']);
    assert.deepEqual(Object.keys(cidade[0]).sort(), ['id', 'nome']);
  });

  test('pedido da loja de teste não aparece no PDV nem na retaguarda da Cabana, e vice-versa', async () => {
    const cliente = await prisma.cliente.create({ data: { googleId: 'g-iso', nome: 'Cliente Iso', telefone: '43999990011' } });
    const centro = await prisma.bairro.findUnique({ where: { nome: 'Centro' } });
    const endereco = await prisma.endereco.create({ data: { clienteId: cliente.id, rua: 'Rua A', numero: '1', bairroId: centro.id, principal: true } });
    const tokenCliente = gerarTokenCliente(cliente);
    const xTeste = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: teste.id, nome: 'X-Teste' } } });
    const xBacon = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: cabana.id, nome: 'X-Bacon' } } });

    // Sockets das duas equipes (o ADMIN na loja de teste).
    const sTeste = await conectar(tk.teste);
    const sCabana = await conectar(tk.cabana);
    const sAdmin = await conectar(tk.admin, { loja: 'lanchonete-teste' });
    const chegou = { teste: [], cabana: [], admin: [] };
    sTeste.on('pedido:novo', (p) => chegou.teste.push(p.id));
    sCabana.on('pedido:novo', (p) => chegou.cabana.push(p.id));
    sAdmin.on('pedido:novo', (p) => chegou.admin.push(p.id));
    try {
      // Site/app: um pedido em cada loja (taxa de cada área: 400 × 500).
      const pTeste = await api('POST', '/cliente/pedidos', {
        token: tokenCliente,
        corpo: { lojaSlug: 'lanchonete-teste', itens: [{ produtoId: xTeste.id, quantidade: 2 }], enderecoId: endereco.id, formaPagamento: 'PIX', totalEsperadoCentavos: 3400, chaveIdempotencia: randomUUID() },
      });
      assert.equal(pTeste.status, 201, JSON.stringify(pTeste.corpo));
      const pCabana = await api('POST', '/cliente/pedidos', {
        token: tokenCliente,
        corpo: { itens: [{ produtoId: xBacon.id, quantidade: 1 }], enderecoId: endereco.id, formaPagamento: 'PIX', totalEsperadoCentavos: xBacon.precoCentavos + 500, chaveIdempotencia: randomUUID() },
      });
      assert.equal(pCabana.status, 201, JSON.stringify(pCabana.corpo));
      const idTeste = pTeste.corpo.pedido.id;
      const idCabana = pCabana.corpo.pedido.id;
      assert.equal(pTeste.corpo.pedido.numeroDia, 1);
      assert.equal(pCabana.corpo.pedido.numeroDia, 1, 'cada loja numera o seu dia');
      await new Promise((r) => setTimeout(r, 300));

      // PDV: fila do dia e tempo real.
      const filaTeste = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.teste })).corpo.pedidos.map((p) => p.id);
      const filaCabana = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.cabana })).corpo.pedidos.map((p) => p.id);
      assert.deepEqual(filaTeste, [idTeste]);
      assert.deepEqual(filaCabana, [idCabana]);
      assert.deepEqual(chegou.teste, [idTeste]);
      assert.deepEqual(chegou.cabana, [idCabana]);
      assert.deepEqual(chegou.admin, [idTeste]);
      // Detalhe/ações do pedido da outra loja = 404.
      assert.equal((await api('PATCH', `/equipe/pedidos/${idTeste}/status`, { token: tk.cabana, corpo: { status: 'EM_PREPARO' } })).status, 404);
      assert.equal((await api('PATCH', `/equipe/pedidos/${idCabana}/status`, { token: tk.teste, corpo: { status: 'EM_PREPARO' } })).status, 404);

      // Impressão: cada agente só reserva os cupons da própria loja (e com o nome dela no cupom).
      const fTeste = (await api('POST', '/equipe/impressoes/reservar', { token: tk.teste, corpo: { agente: 'pdv-teste' } })).corpo;
      const fCabana = (await api('POST', '/equipe/impressoes/reservar', { token: tk.cabana, corpo: { agente: 'pdv-cabana' } })).corpo;
      assert.deepEqual(fTeste.trabalhos.map((t) => t.pedidoId), [idTeste]);
      assert.deepEqual(fCabana.trabalhos.map((t) => t.pedidoId), [idCabana]);
      assert.equal(fTeste.restaurante.nome, 'Lanchonete Teste');
      assert.equal(fCabana.restaurante.nome, 'Cabana Boemia');

      // Retaguarda: finalizados entram só no relatório e no caixa da própria loja.
      for (const [token, id] of [[tk.teste, idTeste], [tk.cabana, idCabana]]) {
        await api('POST', '/equipe/caixa/abrir', { token, corpo: { valorInicialCentavos: 0 } });
        assert.equal((await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token, corpo: { formaPagamento: 'DINHEIRO' } })).status, 200);
      }
      const relTeste = (await api('GET', '/retaguarda/relatorios/dia?data=hoje', { token: tk.teste })).corpo;
      const relCabana = (await api('GET', '/retaguarda/relatorios/dia?data=hoje', { token: tk.cabana })).corpo;
      assert.equal(relTeste.quantidadePedidos, 1);
      assert.equal(relTeste.totalCentavos, 3400);
      assert.deepEqual(relTeste.topPorQuantidade.map((p) => p.nome), ['X-Teste']);
      assert.equal(relCabana.quantidadePedidos, 1);
      assert.deepEqual(relCabana.topPorQuantidade.map((p) => p.nome), ['X-Bacon']);
      const caixaTeste = (await api('GET', '/retaguarda/caixas?data=hoje', { token: tk.teste })).corpo.caixas;
      assert.equal(caixaTeste.length, 1);
      assert.equal(caixaTeste[0].vendasDinheiroCentavos, 3400);
      // Catálogo da retaguarda também é só da loja.
      const prodTeste = (await api('GET', '/retaguarda/produtos', { token: tk.teste })).corpo.produtos.map((p) => p.nome);
      assert.deepEqual(prodTeste.sort(), ['X-Salada Teste', 'X-Teste', 'Suco de laranja', 'Água sem gás'].sort());
      assert.equal((await api('GET', `/retaguarda/produtos/${xBacon.id}`, { token: tk.teste })).status, 404);
      // PDV: bairros da área de cada loja, com a taxa dela.
      assert.deepEqual((await api('GET', '/equipe/bairros', { token: tk.teste })).corpo.bairros.map((b) => [b.nome, b.taxaCentavos]), [['Centro', 400], ['Jardim Primavera', 600]]);
      assert.deepEqual((await api('GET', '/equipe/bairros', { token: tk.cabana })).corpo.bairros.map((b) => [b.nome, b.taxaCentavos]), [['Centro', 500]]);
    } finally {
      sTeste.close();
      sCabana.close();
      sAdmin.close();
    }
  });
});
