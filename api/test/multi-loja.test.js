import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

/**
 * Multi-loja (migration multi_loja): a Cabana é a loja 1 e o site continua nela;
 * uma segunda loja não enxerga nem altera nada da Cabana, e vice-versa.
 */
describe('multi-loja: Cabana é a loja 1 e as lojas não se misturam', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let svc;
  let outra;
  const tk = {};
  const bairro = {};

  async function api(metodo, rota, { corpo, token, cabecalhos = {} } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    svc = await import('../src/services/usuario.service.js');

    outra = await prisma.loja.create({ data: { slug: 'lanchonete-teste', nome: 'Lanchonete Teste' } });
    await svc.criarDono({ nome: 'Dono Cabana', email: 'dono@cabana.test', senha: 'senha-do-dono' });
    await svc.criarDono({ nome: 'Dono Outra', email: 'dono@outra.test', senha: 'senha-do-dono', lojaId: outra.id });
    await svc.criarAtendente({ nome: 'Ana Outra', email: 'ana@outra.test', senha: 'senha-da-ana', lojaId: outra.id });
    await svc.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await svc.promoverAAdmin('admin@teste.test');

    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.cabana = await login('dono@cabana.test', 'senha-do-dono');
    tk.outra = await login('dono@outra.test', 'senha-do-dono');
    tk.anaOutra = await login('ana@outra.test', 'senha-da-ana');
    tk.admin = await login('admin@teste.test', 'senha-do-admin');
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('a migration cria a Cabana (slug cabana-boemia) e o seed põe o cardápio nela', async () => {
    const cabana = await prisma.loja.findUnique({ where: { slug: 'cabana-boemia' } });
    assert.equal(cabana.id, 1);
    assert.equal(cabana.nome, 'Cabana Boemia');
    assert.equal(await prisma.produto.count({ where: { lojaId: { not: 1 } } }), 0);
    assert.ok((await prisma.produto.count({ where: { lojaId: 1 } })) > 0);
    // Site e /publico continuam na Cabana.
    assert.equal((await api('GET', '/publico/config')).corpo.nome, 'Cabana Boemia');
  });

  test('bairros da cidade: só o ADMIN cadastra; cada loja escolhe os seus com a própria taxa', async () => {
    assert.equal((await api('POST', '/plataforma/bairros', { corpo: { nome: 'Centro' }, token: tk.outra })).status, 403);
    const centro = await api('POST', '/plataforma/bairros', { corpo: { nome: 'Centro' }, token: tk.admin });
    assert.equal(centro.status, 201);
    assert.equal((await api('POST', '/plataforma/bairros', { corpo: { nome: 'Centro' }, token: tk.admin })).corpo.erro.codigo, 'NOME_EM_USO');
    const jardim = await api('POST', '/plataforma/bairros', { corpo: { nome: 'Jardim' }, token: tk.admin });
    bairro.centro = centro.corpo.bairro.id;
    bairro.jardim = jardim.corpo.bairro.id;
    // O mesmo bairro, uma taxa em cada loja; a Cabana também entrega no Jardim, a outra não.
    assert.equal((await api('POST', '/retaguarda/bairros', { corpo: { bairroId: bairro.centro, taxaCentavos: 300 }, token: tk.outra })).status, 201);
    assert.equal((await api('POST', '/retaguarda/bairros', { corpo: { bairroId: bairro.centro, taxaCentavos: 500 }, token: tk.cabana })).status, 201);
    assert.equal((await api('POST', '/retaguarda/bairros', { corpo: { bairroId: bairro.jardim, taxaCentavos: 800 }, token: tk.cabana })).status, 201);
    const lista = (await api('GET', '/plataforma/bairros', { token: tk.admin })).corpo.bairros;
    assert.deepEqual(lista.map((b) => [b.nome, b.lojas]), [['Centro', 2], ['Jardim', 1]]);
  });

  test('nomes são únicos por loja (a outra pode ter o mesmo produto, categoria, turno e insumo)', async () => {
    const r = await api('POST', '/retaguarda/categorias', { corpo: { nome: 'Lanches' }, token: tk.outra });
    assert.equal(r.status, 201);
    assert.equal((await api('POST', '/retaguarda/categorias', { corpo: { nome: 'Lanches' }, token: tk.outra })).status, 409);
    assert.equal((await api('POST', '/retaguarda/insumos', { corpo: { nome: 'Pão de lanche', estoqueMinimo: 0 }, token: tk.outra })).status, 201);
    await prisma.turno.create({ data: { lojaId: outra.id, nome: 'Lanches' } });
  });

  test('cada loja só vê o próprio catálogo, bairros, configuração e equipe', async () => {
    const cats = (await api('GET', '/retaguarda/categorias', { token: tk.outra })).corpo.categorias;
    assert.deepEqual(cats.map((c) => c.nome), ['Lanches']);
    assert.equal((await api('GET', '/retaguarda/produtos', { token: tk.outra })).corpo.produtos.length, 0);
    assert.deepEqual((await api('GET', '/retaguarda/bairros', { token: tk.outra })).corpo.bairros.map((b) => b.taxaCentavos), [300]);
    assert.equal((await api('GET', '/retaguarda/config', { token: tk.outra })).corpo.config.nomeRestaurante, 'Lanchonete Teste');
    assert.equal((await api('GET', '/retaguarda/config', { token: tk.cabana })).corpo.config.nomeRestaurante, 'Cabana Boemia');
    const equipe = (await api('GET', '/usuarios', { token: tk.outra })).corpo.usuarios.map((u) => u.email).sort();
    assert.deepEqual(equipe, ['ana@outra.test', 'dono@outra.test']);
    // O site (loja padrão) vê a área da Cabana, com a taxa dela.
    assert.deepEqual((await api('GET', '/publico/bairros')).corpo.bairros.map((b) => [b.nome, b.taxaCentavos]), [['Centro', 500], ['Jardim', 800]]);
  });

  test('dono não altera dado de outra loja (404, como inexistente)', async () => {
    const produto = await prisma.produto.findFirst({ where: { lojaId: 1 } });
    assert.equal((await api('GET', `/retaguarda/produtos/${produto.id}`, { token: tk.outra })).status, 404);
    const r = await api('PATCH', `/retaguarda/produtos/${produto.id}/disponivel-hoje`, { corpo: { disponivelHoje: false }, token: tk.outra });
    assert.equal(r.status, 404);
    assert.equal((await prisma.produto.findUnique({ where: { id: produto.id } })).disponivelHoje, true);
    const ana = await prisma.usuario.findUnique({ where: { email: 'ana@outra.test' } });
    assert.equal((await api('PATCH', `/usuarios/${ana.id}/desativar`, { token: tk.cabana })).status, 404);
    // Produto da outra loja não pode usar categoria da Cabana.
    const catCabana = await prisma.categoria.findFirst({ where: { lojaId: 1 } });
    const novo = await api('POST', '/retaguarda/produtos', {
      corpo: { nome: 'X-Teste', categoriaId: catCabana.id, tipoPreco: 'UNIDADE', precoCentavos: 1000, ativo: true, turnoIds: [], insumos: [] },
      token: tk.outra,
    });
    assert.equal(novo.status, 422);
    assert.equal(novo.corpo.erro.codigo, 'CATEGORIA_INVALIDA');
  });

  test('pedido é de uma loja só: número do dia, caixa e fila por loja; produto da outra loja é recusado', async () => {
    const cliente = await prisma.cliente.create({ data: { nome: 'Cliente Único', telefone: '43999990001' } });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua A', numero: '1', bairroId: bairro.centro, principal: true },
    });
    const cat = await prisma.categoria.findFirst({ where: { lojaId: outra.id } });
    const lanche = await prisma.produto.create({ data: { lojaId: outra.id, nome: 'X-Bacon', categoriaId: cat.id, precoCentavos: 2000 } });
    const pedir = (token, produtoId) =>
      api('POST', '/equipe/pedidos', {
        corpo: { clienteId: cliente.id, enderecoId: endereco.id, itens: [{ produtoId, quantidade: 1 }], formaPagamento: 'PIX' },
        token,
      });

    const r = await pedir(tk.anaOutra, lanche.id);
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.numeroDia, 1);
    assert.equal(r.corpo.pedido.totalCentavos, 2300); // taxa da outra loja para o Centro
    assert.equal(r.corpo.pedido.bairroNome, 'Centro');
    assert.equal((await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } })).lojaId, outra.id);

    // Produto da Cabana pedido na outra loja: não existe lá.
    const xCabana = await prisma.produto.findFirst({ where: { lojaId: 1, nome: 'X-Bacon' } });
    const errado = await pedir(tk.anaOutra, xCabana.id);
    assert.equal(errado.status, 409);
    assert.equal(errado.corpo.erro.codigo, 'PRODUTO_INDISPONIVEL');

    // A Cabana não vê o pedido da outra loja (lista, cancelar, fila de impressão).
    const daCabana = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.cabana })).corpo.pedidos;
    assert.equal(daCabana.length, 0);
    assert.equal((await api('PATCH', `/equipe/pedidos/${r.corpo.pedido.id}/cancelar`, { token: tk.cabana })).status, 404);
    assert.equal((await api('POST', '/equipe/impressoes/reservar', { corpo: { agente: 'teste' }, token: tk.cabana })).corpo.trabalhos.length, 0);
    const fila = (await api('POST', '/equipe/impressoes/reservar', { corpo: { agente: 'teste' }, token: tk.anaOutra })).corpo;
    assert.equal(fila.restaurante.nome, 'Lanchonete Teste');
    assert.equal(fila.trabalhos.length, 1);

    // Um caixa aberto POR LOJA: as duas abrem ao mesmo tempo.
    assert.equal((await api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos: 0 }, token: tk.anaOutra })).status, 201);
    assert.equal((await api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos: 0 }, token: tk.cabana })).status, 201);
    assert.equal((await api('POST', '/equipe/caixa/abrir', { corpo: { valorInicialCentavos: 0 }, token: tk.cabana })).status, 409);
  });

  test('mesmo endereço em outra loja: taxa da loja; loja que não entrega no bairro = 422 BAIRRO_FORA_DA_AREA', async () => {
    const cliente = await prisma.cliente.create({ data: { nome: 'Cliente do Jardim', telefone: '43999990002' } });
    const noJardim = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua J', numero: '2', bairroId: bairro.jardim, principal: true },
    });
    const cat = await prisma.categoria.findFirst({ where: { lojaId: outra.id } });
    const suco = await prisma.produto.create({ data: { lojaId: outra.id, nome: 'Suco', categoriaId: cat.id, precoCentavos: 700 } });
    const fora = await api('POST', '/equipe/pedidos', {
      corpo: { clienteId: cliente.id, enderecoId: noJardim.id, itens: [{ produtoId: suco.id, quantidade: 1 }], formaPagamento: 'PIX' },
      token: tk.anaOutra,
    });
    assert.equal(fora.status, 422);
    assert.equal(fora.corpo.erro.codigo, 'BAIRRO_FORA_DA_AREA');
    assert.match(fora.corpo.erro.mensagem, /Lanchonete Teste não entrega no bairro Jardim/);
    // Nada baixado nem numerado.
    assert.equal(await prisma.pedido.count({ where: { clienteId: cliente.id } }), 0);
    // Na lista do PDV da outra loja o endereço aparece como "não entregamos"; na Cabana, com a taxa dela.
    const naOutra = (await api('GET', '/equipe/clientes?busca=Jardim', { token: tk.anaOutra })).corpo.clientes[0];
    assert.deepEqual(naOutra.enderecos[0].bairro, { id: bairro.jardim, nome: 'Jardim', taxaCentavos: null, ativo: false });
    const naCabana = (await api('GET', '/equipe/clientes?busca=Jardim', { token: tk.cabana })).corpo.clientes[0];
    assert.deepEqual(naCabana.enderecos[0].bairro, { id: bairro.jardim, nome: 'Jardim', taxaCentavos: 800, ativo: true });
    // Bairro desativado NA CIDADE: nenhuma loja entrega (some do site).
    await api('PATCH', `/plataforma/bairros/${bairro.jardim}`, { corpo: { ativo: false }, token: tk.admin });
    assert.deepEqual((await api('GET', '/publico/bairros')).corpo.bairros.map((b) => b.nome), ['Centro']);
    await api('PATCH', `/plataforma/bairros/${bairro.jardim}`, { corpo: { ativo: true }, token: tk.admin });
  });

  test('ADMIN: sem loja, passa onde o DONO passa na loja que informar (X-Loja)', async () => {
    const admin = await prisma.usuario.findUnique({ where: { email: 'admin@teste.test' } });
    assert.equal(admin.papel, 'ADMIN');
    assert.equal(admin.lojaId, null);
    const cfg = await api('GET', '/retaguarda/config', { token: tk.admin, cabecalhos: { 'x-loja': 'cabana-boemia' } });
    assert.equal(cfg.status, 200);
    assert.equal(cfg.corpo.config.nomeRestaurante, 'Cabana Boemia');
    assert.equal((await api('GET', '/equipe/caixa/atual', { token: tk.admin, cabecalhos: { 'x-loja': '1' } })).status, 200);
    assert.equal((await api('GET', '/equipe/caixa/atual', { token: tk.admin })).corpo.erro.codigo, 'LOJA_OBRIGATORIA');
    // Desfazer: volta a DONO da Cabana.
    await svc.voltarADono('admin@teste.test', 1);
    assert.equal((await prisma.usuario.findUnique({ where: { id: admin.id } })).papel, 'DONO');
    await svc.promoverAAdmin('admin@teste.test');
  });

  test('banco: DONO/ATENDENTE exigem loja e ADMIN não tem (CHECK)', async () => {
    const base = { nome: 'X', senhaHash: 'x' };
    await assert.rejects(prisma.usuario.create({ data: { ...base, email: 'a@x.test', papel: 'DONO' } }));
    await assert.rejects(prisma.usuario.create({ data: { ...base, email: 'b@x.test', papel: 'ADMIN', lojaId: 1 } }));
    await assert.rejects(prisma.loja.create({ data: { slug: 'Com Espaço', nome: 'X' } }));
    await assert.rejects(prisma.loja.create({ data: { slug: 'doc-ruim', nome: 'X', documento: '123' } }));
  });
});
