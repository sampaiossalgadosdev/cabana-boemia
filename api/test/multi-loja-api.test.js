import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as conectarSocket } from 'socket.io-client';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { digitoVerificador, problemaNaChave } from '../src/lib/nfce.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // Lanches da Cabana (seed) aberto

/** Chave de NFC-e válida (modelo 65) com o número da nota dado. */
function chaveNfce(numero) {
  // cUF 41 + AAMM 2611 + CNPJ + modelo 65 + série 001 + nNF (9) + tpEmis 1 + cNF (8)
  const sem = `4126111234567800019065001${String(numero).padStart(9, '0')}112345678`;
  assert.equal(sem.length, 43);
  return sem + digitoVerificador(sem);
}

describe('NFC-e: validação da chave (função pura)', () => {
  test('44 números, modelo 65 e dígito verificador', () => {
    const boa = chaveNfce(1);
    assert.equal(problemaNaChave(boa), null);
    assert.match(problemaNaChave('123'), /44 números/);
    const modelo55 = `${boa.slice(0, 20)}55${boa.slice(22, 43)}`;
    assert.match(problemaNaChave(modelo55 + digitoVerificador(modelo55)), /modelo 65/);
    const dvErrado = boa.slice(0, 43) + ((Number(boa[43]) + 1) % 10);
    assert.match(problemaNaChave(dvErrado), /inválida/);
  });
});

describe('API multi-loja: vitrine, pedido por loja, ADMIN, tempo real, impressão, NFC-e e plataforma', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = SABADO_20H;
  let gerarTokenCliente;
  const tk = {};
  const loja = {}; // { cabana, ze }
  const produto = {};
  let cliente;
  let endereco;

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

  async function conectar(token, auth = {}) {
    const socket = conectarSocket(new URL(base).origin, {
      path: '/api/socket.io',
      auth: { token, ...auth },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
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
    ({ gerarTokenCliente } = await import('../src/lib/tokens.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarTempoReal } = await import('../src/lib/tempoReal.js');
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarDono({ nome: 'Dono Cabana', email: 'dono@cabana.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');

    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    criarTempoReal(servidor);
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.cabana = await login('dono@cabana.test', 'senha-do-dono');
    tk.admin = await login('admin@teste.test', 'senha-do-admin');
    loja.cabana = await prisma.loja.findUnique({ where: { slug: 'cabana-boemia' } });

    // Itens da Cabana com preço, disponíveis e com saldo.
    await prisma.insumo.updateMany({ where: { lojaId: loja.cabana.id }, data: { estoque: 100 } });
    await prisma.produto.updateMany({ where: { lojaId: loja.cabana.id, controlaEstoque: true }, data: { estoque: 100 } });
    produto.xBacon = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: loja.cabana.id, nome: 'X-Bacon' } } });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Plataforma: lojas e dono ─────────

  test('ADMIN cria loja (com turnos), edita e cria o DONO; slug repetido = 409; dono comum = 403', async () => {
    assert.equal((await api('GET', '/plataforma/lojas', { token: tk.cabana })).status, 403);
    const r = await api('POST', '/plataforma/lojas', {
      token: tk.admin,
      corpo: {
        slug: 'lanchonete-do-ze',
        nome: 'Lanchonete do Zé',
        documento: '12.345.678/0001-90',
        whatsapp: '(43) 99999-1111',
        corPrimaria: '#123456',
        logoUrl: 'https://exemplo.com/ze.png',
        turnos: ['Noite'],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.loja.documento, '12345678000190');
    assert.equal(r.corpo.loja.whatsapp, '5543999991111');
    loja.ze = r.corpo.loja;
    assert.equal(await prisma.turno.count({ where: { lojaId: loja.ze.id, nome: 'Noite' } }), 1);

    assert.equal((await api('POST', '/plataforma/lojas', { token: tk.admin, corpo: { slug: 'lanchonete-do-ze', nome: 'X' } })).corpo.erro.codigo, 'SLUG_EM_USO');
    assert.equal((await api('POST', '/plataforma/lojas', { token: tk.admin, corpo: { slug: 'Com Espaço', nome: 'X' } })).status, 400);
    assert.equal((await api('POST', '/plataforma/lojas', { token: tk.admin, corpo: { slug: 'cor-ruim', nome: 'X', corFundo: 'vermelho' } })).status, 400);

    const ed = await api('PATCH', `/plataforma/lojas/${loja.ze.id}`, { token: tk.admin, corpo: { descricao: 'Lanches na chapa', ordem: 2 } });
    assert.equal(ed.corpo.loja.descricao, 'Lanches na chapa');
    const fixo = await api('PATCH', `/plataforma/lojas/${loja.cabana.id}`, { token: tk.admin, corpo: { slug: 'cabana' } });
    assert.equal(fixo.corpo.erro.codigo, 'SLUG_FIXO');
    assert.equal((await api('PATCH', '/plataforma/lojas/99999', { token: tk.admin, corpo: { nome: 'X' } })).status, 404);

    const dono = await api('POST', `/plataforma/lojas/${loja.ze.id}/dono`, {
      token: tk.admin,
      corpo: { nome: 'Zé', email: 'ze@ze.test', senha: 'senha-do-ze' },
    });
    assert.equal(dono.status, 201);
    assert.equal(dono.corpo.usuario.lojaId, loja.ze.id);
    tk.ze = await login('ze@ze.test', 'senha-do-ze');
    assert.equal((await api('GET', '/retaguarda/config', { token: tk.ze })).corpo.config.nomeRestaurante, 'Lanchonete do Zé');
    const lista = (await api('GET', '/plataforma/lojas', { token: tk.admin })).corpo.lojas;
    assert.deepEqual(lista.map((l) => l.slug), ['cabana-boemia', 'lanchonete-do-ze']);
    assert.equal(lista[1].usuarios, 1);
  });

  test('turnos por loja: a outra loja pode abrir no mesmo horário; dentro da loja continua recusando', async () => {
    const turno = (await api('GET', '/retaguarda/turnos', { token: tk.ze })).corpo.turnos[0];
    const horarios = [{ diaSemana: 6, inicio: '19:00', fim: '23:00' }]; // cruza com Lanches da Cabana
    const r = await api('PUT', `/retaguarda/turnos/${turno.id}/horarios`, { token: tk.ze, corpo: { horarios } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const dup = await api('PUT', `/retaguarda/turnos/${turno.id}/horarios`, {
      token: tk.ze,
      corpo: { horarios: [...horarios, { diaSemana: 6, inicio: '22:00', fim: '23:30' }] },
    });
    assert.equal(dup.corpo.erro.codigo, 'HORARIO_SOBREPOSTO');

    // Cardápio do Zé: categoria, produto e área de entrega.
    const cat = (await api('POST', '/retaguarda/categorias', { token: tk.ze, corpo: { nome: 'Lanches' } })).corpo.categoria;
    const p = await api('POST', '/retaguarda/produtos', {
      token: tk.ze,
      corpo: { nome: 'X-Zé', categoriaId: cat.id, tipoPreco: 'UNIDADE', precoCentavos: 2500, ativo: true, turnoIds: [turno.id], insumos: [] },
    });
    assert.equal(p.status, 201, JSON.stringify(p.corpo));
    produto.xZe = p.corpo.produto;
    const centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 }); // Cabana: R$ 5
    await prisma.areaEntrega.create({ data: { lojaId: loja.ze.id, bairroId: centro.id, taxaCentavos: 300 } }); // Zé: R$ 3
    cliente = await prisma.cliente.create({ data: { googleId: 'multi-1', nome: 'Maria', telefone: '43999990000' } });
    endereco = await prisma.endereco.create({ data: { clienteId: cliente.id, rua: 'Rua A', numero: '1', bairroId: centro.id, principal: true } });
  });

  // ───────── Vitrine e rotas por slug ─────────

  test('GET /publico/lojas: ativas, com identidade, aberta e próxima abertura de cada uma', async () => {
    agora = local('2026-11-14T18:00'); // sábado: as duas fechadas, abrem às 19:00
    let lojas = (await api('GET', '/publico/lojas')).corpo.lojas;
    assert.deepEqual(lojas.map((l) => [l.slug, l.aberta]), [['cabana-boemia', false], ['lanchonete-do-ze', false]]);
    const ze = lojas[1];
    assert.equal(ze.nome, 'Lanchonete do Zé');
    assert.equal(ze.logoUrl, 'https://exemplo.com/ze.png');
    assert.equal(ze.corPrimaria, '#123456');
    assert.equal(ze.proximaAbertura.turno.nome, 'Noite');
    assert.equal(ze.proximaAbertura.inicio, '19:00');
    assert.equal(ze.razaoSocial, undefined, 'cadastro interno não vaza');

    agora = local('2026-11-14T23:30'); // Zé já fechou (23:00); Cabana aberta até meia-noite
    lojas = (await api('GET', '/publico/lojas')).corpo.lojas;
    assert.deepEqual(lojas.map((l) => [l.slug, l.aberta]), [['cabana-boemia', true], ['lanchonete-do-ze', false]]);

    await api('PATCH', `/plataforma/lojas/${loja.ze.id}`, { token: tk.admin, corpo: { ativa: false } });
    assert.deepEqual((await api('GET', '/publico/lojas')).corpo.lojas.map((l) => l.slug), ['cabana-boemia']);
    assert.equal((await api('GET', '/publico/lojas/lanchonete-do-ze/cardapio')).status, 404);
    await api('PATCH', `/plataforma/lojas/${loja.ze.id}`, { token: tk.admin, corpo: { ativa: true } });
    agora = SABADO_20H;
  });

  test('rotas por slug: cardápio, bairros e config da loja; antigas continuam na Cabana', async () => {
    const card = (await api('GET', '/publico/lojas/lanchonete-do-ze/cardapio')).corpo;
    assert.equal(card.aberto, true);
    assert.deepEqual(card.categorias.flatMap((c) => c.produtos.map((p) => p.nome)), ['X-Zé']);
    assert.deepEqual((await api('GET', '/publico/lojas/lanchonete-do-ze/bairros')).corpo.bairros.map((b) => b.taxaCentavos), [300]);
    const cfg = (await api('GET', '/publico/lojas/lanchonete-do-ze/config')).corpo;
    assert.equal(cfg.nome, 'Lanchonete do Zé');
    assert.equal(cfg.slug, 'lanchonete-do-ze');
    assert.equal((await api('GET', '/publico/lojas/nao-existe/cardapio')).corpo.erro.codigo, 'LOJA_NAO_ENCONTRADA');

    assert.equal((await api('GET', '/publico/config')).corpo.nome, 'Cabana Boemia');
    assert.deepEqual((await api('GET', '/publico/bairros')).corpo.bairros.map((b) => b.taxaCentavos), [500]);
    assert.ok((await api('GET', '/publico/cardapio')).corpo.categorias.flatMap((c) => c.produtos).some((p) => p.nome === 'X-Bacon'));
  });

  // ───────── Configuração por loja ─────────

  test('frete grátis, tempo estimado e virada do dia são da loja', async () => {
    await prisma.loja.update({ where: { id: loja.ze.id }, data: { freteGratisAtivo: true, freteGratisMinimoCentavos: 2000, tempoEstimadoPadraoMin: 25 } });
    const ze = (await api('GET', '/publico/lojas/lanchonete-do-ze/cardapio')).corpo;
    const cabana = (await api('GET', '/publico/cardapio')).corpo;
    assert.deepEqual(ze.freteGratis, { minimoCentavos: 2000 });
    assert.equal(cabana.freteGratis, null);
    assert.equal(ze.tempoEstimadoMin, 25);
    assert.equal(cabana.tempoEstimadoMin, 40);
    // Tempo manual do PDV do Zé não mexe na Cabana.
    await api('PUT', '/equipe/config/tempo-estimado', { token: tk.ze, corpo: { minutos: 15 } });
    assert.equal((await api('GET', '/publico/lojas/lanchonete-do-ze/cardapio')).corpo.tempoEstimadoMin, 15);
    assert.equal((await api('GET', '/publico/cardapio')).corpo.tempoEstimadoMin, 40);
  });

  // ───────── Pedido do cliente por loja ─────────

  test('pedido com lojaSlug: preço, taxa, frete grátis e número do dia da loja; histórico e último trazem a loja', async () => {
    const token = gerarTokenCliente(cliente);
    const pedir = (corpo) =>
      api('POST', '/cliente/pedidos', {
        token,
        corpo: { enderecoId: endereco.id, formaPagamento: 'PIX', chaveIdempotencia: randomUUID(), ...corpo },
      });
    // Zé: 1 × 25,00 ≥ 20,00 → frete grátis.
    const ze = await pedir({ lojaSlug: 'lanchonete-do-ze', itens: [{ produtoId: produto.xZe.id, quantidade: 1 }], totalEsperadoCentavos: 2500 });
    assert.equal(ze.status, 201, JSON.stringify(ze.corpo));
    assert.equal(ze.corpo.pedido.numeroDia, 1);
    assert.equal(ze.corpo.pedido.taxaEntregaCentavos, 0);
    assert.deepEqual(ze.corpo.pedido.loja, { nome: 'Lanchonete do Zé', slug: 'lanchonete-do-ze', logoUrl: 'https://exemplo.com/ze.png' });
    assert.equal(ze.corpo.pedido.tempoEstimadoMin, 15);
    // Sem lojaSlug = Cabana (site atual), com a numeração dela.
    const cab = await pedir({ itens: [{ produtoId: produto.xBacon.id, quantidade: 1 }], totalEsperadoCentavos: produto.xBacon.precoCentavos + 500 });
    assert.equal(cab.status, 201, JSON.stringify(cab.corpo));
    assert.equal(cab.corpo.pedido.numeroDia, 1, 'cada loja numera o seu dia');
    assert.equal(cab.corpo.pedido.loja.slug, 'cabana-boemia');
    // Produto de outra loja.
    const errado = await pedir({ lojaSlug: 'lanchonete-do-ze', itens: [{ produtoId: produto.xBacon.id, quantidade: 1 }], totalEsperadoCentavos: 0 });
    assert.equal(errado.corpo.erro.codigo, 'PRODUTO_INDISPONIVEL');
    assert.equal((await pedir({ lojaSlug: 'nao-existe', itens: [{ produtoId: produto.xZe.id, quantidade: 1 }], totalEsperadoCentavos: 0 })).status, 404);

    const hist = (await api('GET', '/cliente/pedidos', { token })).corpo.pedidos;
    assert.deepEqual(hist.map((p) => p.loja.slug), ['cabana-boemia', 'lanchonete-do-ze']);
    const soZe = (await api('GET', '/cliente/pedidos?lojaSlug=lanchonete-do-ze', { token })).corpo.pedidos;
    assert.deepEqual(soZe.map((p) => p.id), [ze.corpo.pedido.id]);
    assert.equal((await api('GET', '/cliente/pedidos/ultimo', { token })).corpo.pedido.id, cab.corpo.pedido.id, 'sem loja: o da Cabana');
    const ultimoZe = (await api('GET', '/cliente/pedidos/ultimo?lojaSlug=lanchonete-do-ze', { token })).corpo.pedido;
    assert.equal(ultimoZe.id, ze.corpo.pedido.id);
    assert.equal(ultimoZe.loja.nome, 'Lanchonete do Zé');
  });

  // ───────── Equipe: loja do usuário; ADMIN informa ─────────

  test('equipe: cada um vê a própria loja; ADMIN escolhe pelo X-Loja; dono com X-Loja de outra loja = 403', async () => {
    const doZe = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.ze })).corpo.pedidos;
    const daCabana = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.cabana })).corpo.pedidos;
    assert.equal(doZe.length, 1);
    assert.equal(daCabana.length, 1);
    assert.notEqual(doZe[0].id, daCabana[0].id);

    const admZe = await api('GET', '/equipe/pedidos?status=todos', { token: tk.admin, cabecalhos: { 'x-loja': 'lanchonete-do-ze' } });
    assert.deepEqual(admZe.corpo.pedidos.map((p) => p.id), [doZe[0].id]);
    const admId = await api('GET', '/retaguarda/config', { token: tk.admin, cabecalhos: { 'x-loja': String(loja.ze.id) } });
    assert.equal(admId.corpo.config.nomeRestaurante, 'Lanchonete do Zé');
    // Sem X-Loja o ADMIN não cai mais na Cabana (a compatibilidade com o PDV antigo saiu).
    for (const rota of ['/retaguarda/config', '/equipe/pedidos', '/equipe/caixa/atual', '/usuarios']) {
      const semLoja = await api('GET', rota, { token: tk.admin });
      assert.equal(semLoja.status, 400, rota);
      assert.equal(semLoja.corpo.erro.codigo, 'LOJA_OBRIGATORIA', rota);
    }
    // Identidade da loja escolhida (tema do PDV).
    const idZe = await api('GET', '/equipe/loja', { token: tk.admin, cabecalhos: { 'x-loja': 'lanchonete-do-ze' } });
    assert.equal(idZe.corpo.loja.nome, 'Lanchonete do Zé');
    assert.equal(idZe.corpo.loja.corPrimaria, '#123456');
    assert.equal(idZe.corpo.loja.corTexto, '#FFFFFF');
    assert.equal((await api('GET', '/equipe/loja', { token: tk.cabana })).corpo.loja.slug, 'cabana-boemia');
    assert.equal((await api('GET', '/equipe/pedidos', { token: tk.admin, cabecalhos: { 'x-loja': 'nao-existe' } })).corpo.erro.codigo, 'LOJA_NAO_ENCONTRADA');

    const proibido = await api('GET', '/equipe/pedidos', { token: tk.cabana, cabecalhos: { 'x-loja': 'lanchonete-do-ze' } });
    assert.equal(proibido.status, 403);
    assert.equal(proibido.corpo.erro.codigo, 'LOJA_PROIBIDA');
    assert.equal((await api('GET', '/equipe/pedidos', { token: tk.cabana, cabecalhos: { 'x-loja': 'cabana-boemia' } })).status, 200);
  });

  test('isolamento: o dono da Cabana não vê nem altera nada do Zé (e vice-versa)', async () => {
    const pedidoZe = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.ze })).corpo.pedidos[0];
    for (const [metodo, rota, corpo] of [
      ['PATCH', `/equipe/pedidos/${pedidoZe.id}/finalizar`, { formaPagamento: 'PIX' }],
      ['PATCH', `/equipe/pedidos/${pedidoZe.id}/cancelar`],
      ['PATCH', `/equipe/pedidos/${pedidoZe.id}/status`, { status: 'EM_PREPARO' }],
      ['POST', `/equipe/pedidos/${pedidoZe.id}/reimprimir`],
      ['PATCH', `/equipe/pedidos/${pedidoZe.id}/nfce`, { chaveNfce: chaveNfce(99) }],
      ['GET', `/retaguarda/produtos/${produto.xZe.id}`],
      ['PATCH', `/retaguarda/produtos/${produto.xZe.id}/disponivel-hoje`, { disponivelHoje: false }],
    ]) {
      const r = await api(metodo, rota, { token: tk.cabana, corpo });
      assert.equal(r.status, 404, `${metodo} ${rota} → ${r.status}`);
    }
    const trabalhoZe = await prisma.trabalhoImpressao.findFirst({ where: { lojaId: loja.ze.id } });
    assert.equal((await api('POST', `/equipe/impressoes/${trabalhoZe.id}/confirmar`, { token: tk.cabana, corpo: { agente: 'pdv-cabana' } })).status, 404);
    assert.equal((await prisma.trabalhoImpressao.findUnique({ where: { id: trabalhoZe.id } })).status, 'PENDENTE');
    assert.equal((await prisma.pedido.findUnique({ where: { id: pedidoZe.id } })).status, 'CONFIRMADO');
    // Caixa e comandas de cada loja.
    await api('POST', '/equipe/caixa/abrir', { token: tk.ze, corpo: { valorInicialCentavos: 0 } });
    assert.equal((await api('GET', '/equipe/caixa/atual', { token: tk.cabana })).corpo.caixa, null);
    await api('POST', '/equipe/comandas', { token: tk.ze, corpo: { nomeCliente: 'Mesa do Zé' } });
    assert.equal((await api('GET', '/equipe/comandas', { token: tk.cabana })).corpo.comandas.length, 0);
    assert.equal((await api('GET', '/equipe/comandas', { token: tk.ze })).corpo.comandas.length, 1);
  });

  // ───────── Tempo real ─────────

  test('Socket.IO: sala equipe:<lojaId> (sem sala legada); ADMIN escolhe com auth.loja (obrigatória)', async () => {
    const cab = await conectar(tk.cabana);
    const ze = await conectar(tk.ze);
    const admZe = await conectar(tk.admin, { loja: 'lanchonete-do-ze' });
    const recebidos = { cab: [], ze: [], admZe: [] };
    cab.on('pedido:novo', (p) => recebidos.cab.push(p.nomeCliente));
    ze.on('pedido:novo', (p) => recebidos.ze.push(p.nomeCliente));
    admZe.on('pedido:novo', (p) => recebidos.admZe.push(p.nomeCliente));
    try {
      await api('POST', '/equipe/comandas', { token: tk.ze, corpo: { nomeCliente: 'Só do Zé' } });
      await api('POST', '/equipe/comandas', { token: tk.cabana, corpo: { nomeCliente: 'Só da Cabana' } });
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(recebidos.cab, ['Só da Cabana'], 'uma vez só');
      assert.deepEqual(recebidos.ze, ['Só do Zé']);
      assert.deepEqual(recebidos.admZe, ['Só do Zé']);
      await assert.rejects(conectar(tk.cabana, { loja: 'lanchonete-do-ze' }), /LOJA_PROIBIDA/);
      await assert.rejects(conectar(tk.admin), /LOJA_OBRIGATORIA/);
    } finally {
      cab.close();
      ze.close();
      admZe.close();
    }
  });

  // ───────── Impressão com reserva ─────────

  test('impressão: dois agentes reservando ao mesmo tempo nunca pegam o mesmo trabalho', async () => {
    // Fila do Zé: 5 cupons de reimpressão.
    const pedidoZe = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.ze })).corpo.pedidos[0];
    for (let i = 0; i < 5; i++) await api('POST', `/equipe/pedidos/${pedidoZe.id}/reimprimir`, { token: tk.ze });
    const pendentes = await prisma.trabalhoImpressao.count({ where: { lojaId: loja.ze.id, status: 'PENDENTE' } });

    const [a, b] = await Promise.all([
      api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: 'pdv-a' } }),
      api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: 'pdv-b' } }),
    ]);
    const idsA = a.corpo.trabalhos.map((t) => t.id);
    const idsB = b.corpo.trabalhos.map((t) => t.id);
    assert.equal(idsA.filter((id) => idsB.includes(id)).length, 0, 'nenhum trabalho nos dois');
    assert.equal(idsA.length + idsB.length, pendentes);
    assert.equal(a.corpo.restaurante.nome, 'Lanchonete do Zé');
    assert.ok(a.corpo.trabalhos.every((t) => t.reservadoPor === 'pdv-a'));

    const deB = idsB[0] ?? idsA[0];
    const dono = idsB.length ? 'pdv-b' : 'pdv-a';
    const outro = dono === 'pdv-a' ? 'pdv-b' : 'pdv-a';
    // Outro agente não confirma nem falha o reservado, nem o recebe ao reservar.
    const conf = await api('POST', `/equipe/impressoes/${deB}/confirmar`, { token: tk.ze, corpo: { agente: outro } });
    assert.equal(conf.corpo.erro?.codigo, 'TRABALHO_RESERVADO', JSON.stringify({ deB, dono, outro, idsA, idsB, conf: conf.corpo }));
    assert.equal((await api('POST', `/equipe/impressoes/${deB}/falha`, { token: tk.ze, corpo: { agente: outro, erro: 'x' } })).corpo.erro.codigo, 'TRABALHO_RESERVADO');
    // Reservar de novo (o mesmo agente) renova os dele; o outro não pega nada.
    assert.equal((await api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: outro } })).corpo.trabalhos.some((t) => t.id === deB), false);
    // Falha libera: o trabalho volta para a fila.
    await api('POST', `/equipe/impressoes/${deB}/falha`, { token: tk.ze, corpo: { agente: dono, erro: 'sem papel' } });
    assert.ok((await api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: dono } })).corpo.trabalhos.some((t) => t.id === deB));
    // Qual agente ficou com trabalhos (a corrida decide: pode ser só um deles).
    const meu = idsA.length ? { ids: idsA, agente: 'pdv-a' } : { ids: idsB, agente: 'pdv-b' };
    // Confirmar e falhar exigem o agente (a rota do PDV antigo, sem reserva, saiu).
    assert.equal((await api('POST', `/equipe/impressoes/${meu.ids[0]}/confirmar`, { token: tk.ze, corpo: {} })).status, 400);
    assert.equal((await api('POST', `/equipe/impressoes/${meu.ids[0]}/falha`, { token: tk.ze, corpo: { erro: 'x' } })).status, 400);
    assert.equal((await api('GET', '/equipe/impressoes/pendentes', { token: tk.ze })).status, 404);
    // Confirmar limpa a reserva.
    const ok = await api('POST', `/equipe/impressoes/${meu.ids[0]}/confirmar`, { token: tk.ze, corpo: { agente: meu.agente } });
    assert.equal(ok.corpo.trabalho?.status, 'IMPRESSO', JSON.stringify({ idsA, idsB, deB, ok: ok.corpo }));
    assert.equal(ok.corpo.trabalho.reservadoPor, null);

    // Reserva vencida (agente caiu): outro agente pega.
    const resto = meu.ids.slice(1);
    if (resto.length) {
      await prisma.trabalhoImpressao.updateMany({ where: { id: { in: resto } }, data: { reservadoAte: new Date(agora.getTime() - 1000) } }); // relógio da API no teste
      const pegou = (await api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: 'pdv-c' } })).corpo.trabalhos.map((t) => t.id);
      assert.ok(resto.every((id) => pegou.includes(id)));
    }
    // Muitos agentes ao mesmo tempo, 2 trabalhos por vez: nenhum trabalho repetido.
    await prisma.trabalhoImpressao.updateMany({ where: { lojaId: loja.ze.id }, data: { status: 'PENDENTE', reservadoPor: null, reservadoAte: null } });
    const total = await prisma.trabalhoImpressao.count({ where: { lojaId: loja.ze.id, status: 'PENDENTE' } });
    const lotes = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: { agente: `pdv-${i}`, limite: 2 } }),
      ),
    );
    const todos = lotes.flatMap((l) => l.corpo.trabalhos.map((t) => t.id));
    assert.equal(new Set(todos).size, todos.length, `repetido: ${todos}`);
    assert.equal(todos.length, Math.min(total, 12));
    assert.ok(lotes.every((l) => l.corpo.trabalhos.length <= 2));

    // A fila da Cabana não aparece para o Zé, nem a do Zé para a Cabana.
    const daCabana = (await api('POST', '/equipe/impressoes/reservar', { token: tk.cabana, corpo: { agente: 'pdv-a' } })).corpo.trabalhos;
    assert.ok(daCabana.length > 0);
    assert.ok(daCabana.every((t) => !idsA.includes(t.id) && !idsB.includes(t.id)));
    assert.equal((await api('POST', '/equipe/impressoes/reservar', { token: tk.ze, corpo: {} })).status, 400);
  });

  // ───────── NFC-e ─────────

  test('NFC-e: equipe grava a chave (validada); repetida = 409; cancelado = 409; null apaga', async () => {
    const pedidoZe = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.ze })).corpo.pedidos[0];
    const chave = chaveNfce(1234);
    const comEspacos = chave.replace(/(\d{4})/g, '$1 ').trim();
    const r = await api('PATCH', `/equipe/pedidos/${pedidoZe.id}/nfce`, { token: tk.ze, corpo: { chaveNfce: comEspacos } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.chaveNfce, chave);
    assert.equal((await api('GET', '/equipe/pedidos?status=todos', { token: tk.ze })).corpo.pedidos[0].chaveNfce, chave);
    // O cliente não vê a chave.
    const doCliente = (await api('GET', '/cliente/pedidos', { token: gerarTokenCliente(cliente) })).corpo.pedidos;
    assert.ok(doCliente.every((p) => !('chaveNfce' in p)));

    const dvErrado = chave.slice(0, 43) + ((Number(chave[43]) + 1) % 10);
    const invalida = await api('PATCH', `/equipe/pedidos/${pedidoZe.id}/nfce`, { token: tk.ze, corpo: { chaveNfce: dvErrado } });
    assert.equal(invalida.status, 400);
    const pedidoCabana = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.cabana })).corpo.pedidos[0];
    const repetida = await api('PATCH', `/equipe/pedidos/${pedidoCabana.id}/nfce`, { token: tk.cabana, corpo: { chaveNfce: chave } });
    assert.equal(repetida.corpo.erro.codigo, 'CHAVE_NFCE_EM_USO');

    assert.equal((await api('PATCH', `/equipe/pedidos/${pedidoZe.id}/nfce`, { token: tk.ze, corpo: { chaveNfce: null } })).corpo.pedido.chaveNfce, null);
    await api('PATCH', `/equipe/pedidos/${pedidoCabana.id}/cancelar`, { token: tk.cabana });
    assert.equal((await api('PATCH', `/equipe/pedidos/${pedidoCabana.id}/nfce`, { token: tk.cabana, corpo: { chaveNfce: chave } })).corpo.erro.codigo, 'PEDIDO_CANCELADO');
  });
});
