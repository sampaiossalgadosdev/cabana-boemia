import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { acharSobreposicao } from '../src/services/turno.service.js';
import { normalizarWhatsapp } from '../src/services/configuracao.service.js';
import { conferirRegras } from '../src/services/produto.service.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SEXTA_20H = local('2026-11-13T20:00'); // Lanches aberto (seed: sexta 19:00–00:00)

// ───────── Funções puras ─────────

const item = (id, diaSemana, inicio, fim) => ({ turno: { id, nome: `T${id}` }, horario: { diaSemana, inicio, fim } });

test('acharSobreposicao: mesmo dia, entre turnos, virada da meia-noite e de sábado para domingo', () => {
  assert.equal(acharSobreposicao([item(1, 1, '11:00', '14:00'), item(2, 1, '19:00', '23:00')]), null);
  assert.equal(acharSobreposicao([item(1, 1, '11:00', '14:00'), item(2, 1, '14:00', '15:00')]), null, 'fim é aberto');
  assert.ok(acharSobreposicao([item(1, 1, '11:00', '14:00'), item(2, 1, '13:59', '15:00')]));
  assert.ok(acharSobreposicao([item(1, 1, '11:00', '14:00'), item(1, 1, '12:00', '13:00')]), 'mesmo turno também');
  assert.ok(acharSobreposicao([item(1, 5, '19:00', '02:00'), item(2, 6, '01:00', '03:00')]), 'sexta 19–02 cruza sábado 01–03');
  assert.equal(acharSobreposicao([item(1, 5, '19:00', '00:00'), item(2, 6, '00:00', '03:00')]), null, '00:00 = fim do dia');
  assert.ok(acharSobreposicao([item(1, 6, '22:00', '02:00'), item(2, 0, '01:00', '05:00')]), 'sábado → domingo');
});

test('normalizarWhatsapp: aceita formatação, põe o 55, recusa o que não é número BR', () => {
  assert.equal(normalizarWhatsapp('(43) 99999-0000'), '5543999990000');
  assert.equal(normalizarWhatsapp('+55 43 3555-1234'), '554335551234');
  assert.equal(normalizarWhatsapp('043 99999-0000'), '5543999990000');
  assert.equal(normalizarWhatsapp('5543999990000'), '5543999990000');
  for (const ruim of ['', '123', '99999-0000', '(03) 99999-0000', '1243999990000', 'abc']) {
    assert.equal(normalizarWhatsapp(ruim), null, ruim);
  }
});

test('conferirRegras do produto: por kg sem estoque/insumos; ativo exige preço', () => {
  const base = { tipoPreco: 'UNIDADE', controlaEstoque: false, insumos: [], ativo: true, precoCentavos: 100 };
  assert.equal(conferirRegras(base), null);
  assert.equal(conferirRegras({ ...base, tipoPreco: 'POR_KG', controlaEstoque: true }).codigo, 'POR_KG_SEM_ESTOQUE');
  assert.equal(conferirRegras({ ...base, tipoPreco: 'POR_KG', insumos: [{ insumoId: 1, quantidade: 1 }] }).codigo, 'POR_KG_SEM_ESTOQUE');
  assert.equal(conferirRegras({ ...base, precoCentavos: 0 }).codigo, 'PRECO_OBRIGATORIO');
  assert.equal(conferirRegras({ ...base, precoCentavos: 0, ativo: false }), null, 'inativo pode ficar sem preço');
});

// ───────── API ─────────

describe('retaguarda: catálogo, cardápio do dia, turnos, bairros e configurações', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tkDono;
  let tkAtendente;
  let eventos = [];
  let pararEventos;
  const turnos = {};
  const cat = {};
  const p = {};

  async function api(metodo, rota, corpo, tk = tkDono) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }
  const publico = async (rota) => (await fetch(`${base}${rota}`)).json();
  const nomesDoSite = async () =>
    (await publico('/publico/cardapio')).categorias.flatMap((c) => c.produtos.map((x) => x.nome));
  const nomesDoPdv = async (turnoId) =>
    (await api('GET', `/equipe/cardapio?turnoId=${turnoId}`, undefined, tkAtendente)).corpo.categorias.flatMap((c) =>
      c.produtos.map((x) => x.nome),
    );
  const soCardapio = () => eventos.filter((e) => e.evento === 'cardapio:atualizado');

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente, criarDono } = await import('../src/services/usuario.service.js');
    const { aoEmitirParaEquipe } = await import('../src/lib/eventos.js');
    pararEventos = aoEmitirParaEquipe((evento, dados) => eventos.push({ evento, dados }));

    for (const t of await prisma.turno.findMany()) turnos[t.nome] = t;
    for (const c of await prisma.categoria.findMany()) cat[c.nome] = c;
    for (const prod of await prisma.produto.findMany()) p[prod.nome] = prod;
    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });

    servidor = http.createServer(criarApp({ log: false, relogio: () => SEXTA_20H }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = async (email, senha) =>
      (
        await (
          await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, senha }),
          })
        ).json()
      ).accessToken;
    tkDono = await login('dono@teste.com', 'senha-do-dono');
    tkAtendente = await login('ana@teste.com', 'senha-da-ana');
  });

  beforeEach(() => {
    eventos = [];
  });

  after(async () => {
    pararEventos?.();
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Categorias ─────────

  test('categorias: lista (com inativas e contagem), cria, renomeia, ordena; nome repetido = 409; sem excluir', async () => {
    const lista = await api('GET', '/retaguarda/categorias');
    assert.equal(lista.status, 200);
    assert.ok(lista.corpo.categorias.every((c) => typeof c.quantidadeProdutos === 'number'));

    const nova = await api('POST', '/retaguarda/categorias', { nome: '  Sobremesas ', ordem: 50 });
    assert.equal(nova.status, 201, JSON.stringify(nova.corpo));
    assert.deepEqual(
      { nome: nova.corpo.categoria.nome, ordem: nova.corpo.categoria.ordem, ativo: nova.corpo.categoria.ativo },
      { nome: 'Sobremesas', ordem: 50, ativo: true },
    );
    const id = nova.corpo.categoria.id;
    const ren = await api('PATCH', `/retaguarda/categorias/${id}`, { nome: 'Doces', ordem: 2 });
    assert.equal(ren.corpo.categoria.nome, 'Doces');
    assert.equal(ren.corpo.categoria.ordem, 2);

    const rep = await api('POST', '/retaguarda/categorias', { nome: 'Doces' });
    assert.equal(rep.status, 409);
    assert.equal(rep.corpo.erro.codigo, 'NOME_EM_USO');
    assert.equal((await api('PATCH', `/retaguarda/categorias/${id}`, {})).status, 400);
    assert.equal((await api('PATCH', '/retaguarda/categorias/999999', { ativo: false })).status, 404);
    assert.equal((await api('DELETE', `/retaguarda/categorias/${id}`)).status, 404, 'não existe excluir');
    assert.equal(soCardapio().length, 2);
    assert.ok(soCardapio().every((e) => e.dados.origem === 'categorias'));
  });

  test('categoria desativada some do site e do PDV; reativada volta', async () => {
    const lanches = Object.values(cat).find((c) => c.nome === 'Lanches') ?? cat[Object.keys(cat)[0]];
    const umLanche = Object.values(p).find((x) => x.categoriaId === lanches.id && x.ativo);
    await prisma.produto.updateMany({ where: { categoriaId: lanches.id, controlaEstoque: false }, data: { disponivelHoje: true } });
    await prisma.insumo.updateMany({ data: { estoque: 100 } });
    assert.ok((await nomesDoSite()).includes(umLanche.nome), 'antes aparece no site');
    assert.ok((await nomesDoPdv(turnos.Lanches.id)).includes(umLanche.nome), 'antes aparece no PDV');

    assert.equal((await api('PATCH', `/retaguarda/categorias/${lanches.id}`, { ativo: false })).status, 200);
    assert.equal((await nomesDoSite()).includes(umLanche.nome), false, 'some do site');
    assert.equal((await nomesDoPdv(turnos.Lanches.id)).includes(umLanche.nome), false, 'some do PDV');

    await api('PATCH', `/retaguarda/categorias/${lanches.id}`, { ativo: true });
    assert.ok((await nomesDoSite()).includes(umLanche.nome), 'volta');
  });

  // ───────── Produtos ─────────

  const novoProduto = (extra = {}) => ({
    nome: 'X-Teste',
    descricao: 'Pão, carne e queijo',
    categoriaId: Object.values(cat)[0].id,
    tipoPreco: 'UNIDADE',
    precoCentavos: 2500,
    ativo: true,
    vendidoNoSite: true,
    controlaEstoque: false,
    estoqueMinimo: null,
    ordem: 3,
    turnoIds: [turnos.Lanches.id],
    insumos: [],
    ...extra,
  });

  test('produto: cria com turnos e insumos, nasce disponível hoje; edita trocando turnos/receita', async () => {
    const pao = await prisma.insumo.findFirst();
    const r = await api('POST', '/retaguarda/produtos', novoProduto({ insumos: [{ insumoId: pao.id, quantidade: 2 }] }));
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const prod = r.corpo.produto;
    assert.equal(prod.disponivelHoje, true);
    assert.equal(prod.estoque, null);
    assert.deepEqual(prod.turnos, [{ id: turnos.Lanches.id, nome: 'Lanches' }]);
    assert.deepEqual(prod.insumos, [{ insumoId: pao.id, nome: pao.nome, quantidade: 2 }]);
    assert.deepEqual(soCardapio(), [{ evento: 'cardapio:atualizado', dados: { origem: 'produtos' } }]);

    const ed = await api(
      'PUT',
      `/retaguarda/produtos/${prod.id}`,
      novoProduto({ nome: 'X-Teste Duplo', precoCentavos: 3200, turnoIds: [turnos.Almoço.id, turnos.Lanches.id], insumos: [] }),
    );
    assert.equal(ed.status, 200, JSON.stringify(ed.corpo));
    assert.equal(ed.corpo.produto.nome, 'X-Teste Duplo');
    assert.equal(ed.corpo.produto.precoCentavos, 3200);
    assert.equal(prod.sugerirNaSacola, false, 'nasce sem sugestão');
    assert.equal(ed.corpo.produto.sugerirNaSacola, false);
    const sug = await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo', sugerirNaSacola: true }));
    assert.equal(sug.corpo.produto.sugerirNaSacola, true);
    assert.equal((await api('GET', `/retaguarda/produtos/${prod.id}`)).corpo.produto.sugerirNaSacola, true);
    assert.equal((await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo', sugerirNaSacola: 'sim' }))).status, 400);
    soCardapio();

    // Foto: link https gravado; ausente não mexe; vazio apaga; não-https recusado.
    assert.equal(prod.imagemUrl, null, 'nasce sem foto');
    const foto = 'https://exemplo.com/fotos/x-teste.jpg?w=600';
    const comFoto = await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo', imagemUrl: `  ${foto} ` }));
    assert.equal(comFoto.status, 200, JSON.stringify(comFoto.corpo));
    assert.equal(comFoto.corpo.produto.imagemUrl, foto);
    const semCampo = await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo' }));
    assert.equal(semCampo.corpo.produto.imagemUrl, foto, 'ausente não apaga');
    for (const ruim of ['http://exemplo.com/a.jpg', 'javascript:alert(1)', 'https://', `https://exemplo.com/${'a'.repeat(500)}`]) {
      const r = await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo', imagemUrl: ruim }));
      assert.equal(r.status, 400, ruim);
    }
    const vazio = await api('PUT', `/retaguarda/produtos/${prod.id}`, novoProduto({ nome: 'X-Teste Duplo', imagemUrl: '' }));
    assert.equal(vazio.corpo.produto.imagemUrl, null);
    soCardapio();
    assert.equal(ed.corpo.produto.turnos.length, 2);
    assert.deepEqual(ed.corpo.produto.insumos, []);
    assert.equal(await prisma.produtoInsumo.count({ where: { produtoId: prod.id } }), 0);

    const lista = await api('GET', '/retaguarda/produtos');
    assert.ok(lista.corpo.produtos.some((x) => x.id === prod.id));
    assert.ok(lista.corpo.produtos.some((x) => !x.ativo), 'lista inclui inativos (marmitas do seed)');
    assert.equal((await api('GET', `/retaguarda/produtos/${prod.id}`)).corpo.produto.nome, 'X-Teste Duplo');
    assert.equal((await api('GET', '/retaguarda/produtos/999999')).status, 404);
  });

  test('produto: ligar controle de estoque começa em 0; o formulário não mexe no saldo nem no disponivelHoje', async () => {
    const r = await api('POST', '/retaguarda/produtos', novoProduto({ nome: 'Água 500ml', controlaEstoque: true, estoqueMinimo: 6 }));
    assert.equal(r.corpo.produto.estoque, 0);
    const id = r.corpo.produto.id;
    await prisma.produto.update({ where: { id }, data: { estoque: 12, disponivelHoje: false } });
    const ed = await api('PUT', `/retaguarda/produtos/${id}`, {
      ...novoProduto({ nome: 'Água 500ml', controlaEstoque: true, estoqueMinimo: 4 }),
      estoque: 999,
      disponivelHoje: true,
    });
    assert.equal(ed.status, 200);
    assert.equal(ed.corpo.produto.estoque, 12);
    assert.equal(ed.corpo.produto.disponivelHoje, false);
    assert.equal(ed.corpo.produto.estoqueMinimo, 4);
  });

  test('produto: validações (por kg com estoque, ativo sem preço, categoria/turno/insumo inexistente, nome repetido)', async () => {
    const casos = [
      [novoProduto({ nome: 'K1', tipoPreco: 'POR_KG', controlaEstoque: true }), 422, 'POR_KG_SEM_ESTOQUE'],
      [novoProduto({ nome: 'K2', precoCentavos: 0 }), 422, 'PRECO_OBRIGATORIO'],
      [novoProduto({ nome: 'K3', categoriaId: 999999 }), 422, 'CATEGORIA_INVALIDA'],
      [novoProduto({ nome: 'K4', turnoIds: [999999] }), 422, 'TURNO_INVALIDO'],
      [novoProduto({ nome: 'K5', insumos: [{ insumoId: 999999, quantidade: 1 }] }), 422, 'INSUMO_INVALIDO'],
      [novoProduto({ nome: 'K6', turnoIds: [turnos.Lanches.id, turnos.Lanches.id] }), 400, 'VALIDACAO'],
      [novoProduto({ nome: 'K7', precoCentavos: 12.5 }), 400, 'VALIDACAO'],
      [novoProduto({ nome: 'X-Teste Duplo' }), 409, 'NOME_EM_USO'],
    ];
    for (const [corpo, status, codigo] of casos) {
      const r = await api('POST', '/retaguarda/produtos', corpo);
      assert.equal(r.status, status, `${corpo.nome}: ${JSON.stringify(r.corpo)}`);
      assert.equal(r.corpo.erro.codigo, codigo, corpo.nome);
    }
    assert.equal(await prisma.produto.count({ where: { nome: { startsWith: 'K' } } }), 0);
  });

  // ───────── Cardápio do dia ─────────

  test('cardápio do dia: turno ativo por padrão; só ativos de categoria ativa; interruptor e descrição', async () => {
    const r = await api('GET', '/retaguarda/cardapio-do-dia');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.turno.nome, 'Lanches');
    assert.equal(r.corpo.turnoAtivo.nome, 'Lanches');
    assert.ok(r.corpo.produtos.length > 0);
    assert.ok(r.corpo.produtos.every((x) => x.ativo && x.categoria.ativo));
    assert.ok(r.corpo.produtos.every((x) => x.turnos.some((t) => t.id === turnos.Lanches.id)));

    const alvo = r.corpo.produtos[0];
    const off = await api('PATCH', `/retaguarda/produtos/${alvo.id}/disponivel-hoje`, { disponivelHoje: false });
    assert.equal(off.corpo.produto.disponivelHoje, false);
    const desc = await api('PATCH', `/retaguarda/produtos/${alvo.id}/descricao`, { descricao: '  Arroz, feijão e bife acebolado ' });
    assert.equal(desc.corpo.produto.descricao, 'Arroz, feijão e bife acebolado');
    assert.equal((await api('PATCH', `/retaguarda/produtos/${alvo.id}/disponivel-hoje`, { disponivelHoje: 'sim' })).status, 400);
    assert.equal((await api('PATCH', '/retaguarda/produtos/999999/descricao', { descricao: 'x' })).status, 404);
    assert.deepEqual(
      soCardapio().map((e) => e.dados.origem),
      ['cardapio-do-dia', 'cardapio-do-dia'],
    );

    const almoco = await api('GET', `/retaguarda/cardapio-do-dia?turnoId=${turnos.Almoço.id}`);
    assert.equal(almoco.corpo.turno.nome, 'Almoço');
    assert.equal((await api('GET', '/retaguarda/cardapio-do-dia?turnoId=999999')).status, 404);
  });

  test('"Liberar tudo" liga disponivelHoje dos ativos do turno (e só deles)', async () => {
    await prisma.produto.updateMany({ data: { disponivelHoje: false } });
    const r = await api('POST', '/retaguarda/cardapio-do-dia/liberar-tudo', { turnoId: turnos.Lanches.id });
    assert.equal(r.status, 200);
    const doTurno = await prisma.produto.findMany({ where: { ativo: true, turnos: { some: { turnoId: turnos.Lanches.id } } } });
    assert.equal(r.corpo.liberados, doTurno.length);
    assert.ok(doTurno.every((x) => x.disponivelHoje));
    const soAlmoco = await prisma.produto.findMany({
      where: { turnos: { some: { turnoId: turnos.Almoço.id }, none: { turnoId: turnos.Lanches.id } } },
    });
    assert.ok(soAlmoco.every((x) => !x.disponivelHoje), 'outro turno não muda');
    assert.equal(await prisma.produto.count({ where: { ativo: false, disponivelHoje: true } }), 0, 'inativos não mudam');
    assert.equal((await api('POST', '/retaguarda/cardapio-do-dia/liberar-tudo', {})).status, 400);
    assert.equal((await api('POST', '/retaguarda/cardapio-do-dia/liberar-tudo', { turnoId: 999999 })).status, 404);
  });

  // ───────── Turnos ─────────

  test('turnos: troca os horários do turno; sobreposição com outro turno = 422 HORARIO_SOBREPOSTO', async () => {
    const lista = await api('GET', '/retaguarda/turnos');
    assert.equal(lista.status, 200);
    assert.equal(lista.corpo.turnos.find((t) => t.nome === 'Lanches').horarios.length, 4);

    const almoco = [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio: '11:00', fim: '14:30' }));
    const r = await api('PUT', `/retaguarda/turnos/${turnos.Almoço.id}/horarios`, { horarios: almoco });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.turno.horarios.length, 6);
    assert.deepEqual(soCardapio(), [{ evento: 'cardapio:atualizado', dados: { origem: 'turnos' } }]);

    // Sexta 19:00–00:00 é dos Lanches.
    const cruza = await api('PUT', `/retaguarda/turnos/${turnos.Almoço.id}/horarios`, {
      horarios: [...almoco, { diaSemana: 5, inicio: '18:00', fim: '20:00' }],
    });
    assert.equal(cruza.status, 422);
    assert.equal(cruza.corpo.erro.codigo, 'HORARIO_SOBREPOSTO');
    assert.match(cruza.corpo.erro.mensagem, /Lanches/);
    assert.equal(await prisma.horarioTurno.count({ where: { turnoId: turnos.Almoço.id } }), 6, 'nada gravado');

    for (const h of [
      { diaSemana: 7, inicio: '11:00', fim: '14:00' },
      { diaSemana: 1, inicio: '24:00', fim: '14:00' },
      { diaSemana: 1, inicio: '11:00', fim: '11:00' },
      { diaSemana: 1, inicio: '9:00', fim: '11:00' },
    ]) {
      assert.equal((await api('PUT', `/retaguarda/turnos/${turnos.Almoço.id}/horarios`, { horarios: [h] })).status, 400, JSON.stringify(h));
    }
    assert.equal((await api('PUT', '/retaguarda/turnos/999999/horarios', { horarios: [] })).status, 404);
  });

  test('turnos: horário novo vale na hora para o site (loja abre/fecha)', async () => {
    // Sexta 20:00: Lanches abertos. Sem horários, a loja fecha.
    const lanches = (await api('GET', '/retaguarda/turnos')).corpo.turnos.find((t) => t.nome === 'Lanches');
    await api('PUT', `/retaguarda/turnos/${turnos.Lanches.id}/horarios`, { horarios: [] });
    assert.equal((await publico('/publico/cardapio')).aberto, false);
    const devolver = lanches.horarios.map(({ diaSemana, inicio, fim }) => ({ diaSemana, inicio, fim }));
    assert.equal((await api('PUT', `/retaguarda/turnos/${turnos.Lanches.id}/horarios`, { horarios: devolver })).status, 200);
    assert.equal((await publico('/publico/cardapio')).aberto, true);
  });

  // ───────── Bairros ─────────

  test('bairros: escolhe da lista da cidade, muda taxa, desativa (some do site); repetido = 409; nome é do ADMIN', async () => {
    const vila = await prisma.bairro.create({ data: { nome: 'Vila Nova' } }); // lista da cidade (ADMIN)
    const opcoes = (await api('GET', '/retaguarda/bairros/cidade')).corpo.bairros;
    assert.ok(opcoes.some((b) => b.id === vila.id));
    const r = await api('POST', '/retaguarda/bairros', { bairroId: vila.id, taxaCentavos: 500 });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const id = r.corpo.bairro.id;
    assert.equal(id, vila.id);
    assert.equal(r.corpo.bairro.nome, 'Vila Nova');
    assert.equal((await api('GET', '/retaguarda/bairros/cidade')).corpo.bairros.some((b) => b.id === vila.id), false);
    assert.ok((await publico('/publico/bairros')).bairros.some((b) => b.id === id));

    const taxa = await api('PATCH', `/retaguarda/bairros/${id}`, { taxaCentavos: 700 });
    assert.equal(taxa.corpo.bairro.taxaCentavos, 700);
    await api('PATCH', `/retaguarda/bairros/${id}`, { ativo: false });
    assert.equal((await publico('/publico/bairros')).bairros.some((b) => b.id === id), false);
    assert.ok((await api('GET', '/retaguarda/bairros')).corpo.bairros.some((b) => b.id === id && !b.ativo));

    assert.equal((await api('POST', '/retaguarda/bairros', { bairroId: vila.id, taxaCentavos: 1 })).corpo.erro.codigo, 'BAIRRO_JA_NA_AREA');
    assert.equal((await api('POST', '/retaguarda/bairros', { bairroId: vila.id, taxaCentavos: -1 })).status, 400);
    assert.equal((await api('POST', '/retaguarda/bairros', { bairroId: 999999, taxaCentavos: 100 })).corpo.erro.codigo, 'BAIRRO_INVALIDO');
    assert.equal((await api('PATCH', '/retaguarda/bairros/999999', { ativo: true })).status, 404);
    // O dono não renomeia nem cria bairro da cidade (só a taxa e o ativo da área).
    assert.equal((await api('PATCH', `/retaguarda/bairros/${id}`, { nome: 'Outro' })).status, 400);
    assert.equal((await api('GET', '/plataforma/bairros')).status, 403);
    assert.equal(soCardapio().length, 3);
  });

  // ───────── Configurações ─────────

  test('configurações: nome, WhatsApp (com 55) e tempo padrão; refletem no site e no tempo vigente', async () => {
    const r = await api('PUT', '/retaguarda/config', {
      nomeRestaurante: 'Cabana Boemia',
      whatsappNumero: '(43) 99999-0000',
      tempoEstimadoPadraoMin: 50,
      horaViradaDia: 4,
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.config, {
      nomeRestaurante: 'Cabana Boemia',
      whatsappNumero: '5543999990000',
      tempoEstimadoPadraoMin: 50,
      horaViradaDia: 4,
      freteGratisAtivo: false,
      freteGratisMinimoCentavos: null,
      freteGratisWhatsapp: true,
    });
    assert.equal((await publico('/publico/config')).whatsapp, '5543999990000');
    assert.equal((await publico('/publico/cardapio')).tempoEstimadoMin, 50);
    assert.deepEqual((await api('GET', '/retaguarda/config')).corpo.config, r.corpo.config);
    assert.deepEqual(soCardapio(), [{ evento: 'cardapio:atualizado', dados: { origem: 'config' } }]);

    for (const corpo of [
      { nomeRestaurante: '', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 40 },
      { nomeRestaurante: 'X', whatsappNumero: '123', tempoEstimadoPadraoMin: 40 },
      { nomeRestaurante: 'X', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 0 },
      { nomeRestaurante: 'X', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 241 },
      { nomeRestaurante: 'X', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 40, horaViradaDia: 13 },
      { nomeRestaurante: 'X', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 40, horaViradaDia: -1 },
    ]) {
      assert.equal((await api('PUT', '/retaguarda/config', corpo)).status, 400, JSON.stringify(corpo));
    }
  });

  test('frete grátis: liga com mínimo, desliga guardando o mínimo; ligado sem mínimo ou mínimo 0 = 400', async () => {
    const base = { nomeRestaurante: 'Cabana Boemia', whatsappNumero: '43999990000', tempoEstimadoPadraoMin: 40, horaViradaDia: 4 };
    soCardapio();
    const liga = await api('PUT', '/retaguarda/config', { ...base, freteGratisAtivo: true, freteGratisMinimoCentavos: 6900 });
    assert.equal(liga.status, 200, JSON.stringify(liga.corpo));
    assert.equal(liga.corpo.config.freteGratisAtivo, true);
    assert.equal(liga.corpo.config.freteGratisMinimoCentavos, 6900);
    assert.deepEqual((await publico('/publico/config')).freteGratis, { minimoCentavos: 6900 });
    assert.deepEqual(soCardapio(), [{ evento: 'cardapio:atualizado', dados: { origem: 'config' } }]);

    // Sem os campos: não mexe (cliente antigo).
    const semCampos = await api('PUT', '/retaguarda/config', base);
    assert.equal(semCampos.corpo.config.freteGratisAtivo, true);

    // "Vale também para o WhatsApp": padrão true; desmarcar persiste e não mexe no site.
    const soSite = await api('PUT', '/retaguarda/config', { ...base, freteGratisAtivo: true, freteGratisMinimoCentavos: 6900, freteGratisWhatsapp: false });
    assert.equal(soSite.corpo.config.freteGratisWhatsapp, false);
    assert.deepEqual((await publico('/publico/config')).freteGratis, { minimoCentavos: 6900 });
    assert.equal((await api('PUT', '/retaguarda/config', { ...base, freteGratisWhatsapp: 'nao' })).status, 400);
    await api('PUT', '/retaguarda/config', { ...base, freteGratisWhatsapp: true });

    const desliga = await api('PUT', '/retaguarda/config', { ...base, freteGratisAtivo: false, freteGratisMinimoCentavos: 6900 });
    assert.equal(desliga.corpo.config.freteGratisAtivo, false);
    assert.equal(desliga.corpo.config.freteGratisMinimoCentavos, 6900);
    assert.equal((await publico('/publico/config')).freteGratis, null);

    for (const extra of [
      { freteGratisAtivo: true, freteGratisMinimoCentavos: null },
      { freteGratisAtivo: true },
      { freteGratisAtivo: true, freteGratisMinimoCentavos: 0 },
      { freteGratisAtivo: false, freteGratisMinimoCentavos: -100 },
      { freteGratisAtivo: false, freteGratisMinimoCentavos: 69.5 },
      { freteGratisAtivo: 'sim', freteGratisMinimoCentavos: 6900 },
      { freteGratisMinimoCentavos: null },
    ]) {
      const r = await api('PUT', '/retaguarda/config', { ...base, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
    await api('PUT', '/retaguarda/config', { ...base, freteGratisAtivo: false, freteGratisMinimoCentavos: null });
  });
});
