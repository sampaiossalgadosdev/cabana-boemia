import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { CENTRO_PADRAO, criarClienteGoogle, lerCentro, lerConfigMapas } from '../src/lib/mapas.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SABADO_20H = local('2026-11-14T20:00'); // Lanches da Cabana (seed) aberto
const LOJA = { latitude: -23.3049, longitude: -50.3133 };
const CASA = { latitude: -23.3101, longitude: -50.3052 };
const CHAVE_FALSA = 'chave-do-servidor-de-teste';

/** fetch falso: devolve o que `responder(url, opcoes)` mandar (ou lança). */
function fetchFalso(responder) {
  const chamadas = [];
  const fn = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    const r = await responder(String(url), opcoes);
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, json: async () => r.corpo };
  };
  fn.chamadas = chamadas;
  return fn;
}

const silencioso = { info() {}, warn() {} };

describe('mapas: configuração (lib)', () => {
  test('padrões: limites 300/500, centro de Abatiá, raio de 60 km, taxa 100/90, sem chaves', () => {
    const c = lerConfigMapas({});
    assert.equal(c.chaveServidor, '');
    assert.equal(c.chaveWeb, '');
    assert.equal(c.limiteGeocodingDia, 300);
    assert.equal(c.limiteRotasDia, 500);
    assert.deepEqual(c.centro, CENTRO_PADRAO);
    assert.equal(c.raioAceitoM, 60_000);
    assert.deepEqual(c.taxaKm, { baseCentavos: 100, porKmCentavos: 90 });
  });

  test('valores do ambiente; inválidos voltam ao padrão', () => {
    const c = lerConfigMapas({
      GOOGLE_MAPS_SERVER_KEY: ' k ',
      MAPAS_LIMITE_GEOCODING_DIA: '10',
      MAPAS_LIMITE_ROTAS_DIA: 'abc',
      MAPAS_CENTRO: '-23.1, -50.2',
      TAXA_KM_BASE_CENTAVOS: '150',
      TAXA_KM_POR_KM_CENTAVOS: '-1',
    });
    assert.equal(c.chaveServidor, 'k');
    assert.equal(c.limiteGeocodingDia, 10);
    assert.equal(c.limiteRotasDia, 500);
    assert.deepEqual(c.centro, { latitude: -23.1, longitude: -50.2 });
    assert.deepEqual(c.taxaKm, { baseCentavos: 150, porKmCentavos: 90 });
    assert.deepEqual(lerCentro('0,0'), CENTRO_PADRAO);
    assert.deepEqual(lerCentro('x'), CENTRO_PADRAO);
  });
});

describe('mapas: cliente do Google (fetch simulado)', () => {
  test('geocoding: pino, aproximado e a chave só na URL do Google', async () => {
    const f = fetchFalso(() => ({
      corpo: { status: 'OK', results: [{ geometry: { location: { lat: -23.31, lng: -50.30 }, location_type: 'ROOFTOP' } }] },
    }));
    const g = criarClienteGoogle({ chave: CHAVE_FALSA, fetch: f });
    assert.deepEqual(await g.geocodificar('Rua A, 1 - Centro - Abatiá-PR'), { latitude: -23.31, longitude: -50.30, aproximado: false });
    const url = new URL(f.chamadas[0].url);
    assert.equal(url.host, 'maps.googleapis.com');
    assert.equal(url.searchParams.get('components'), 'country:BR');
    assert.equal(url.searchParams.get('key'), CHAVE_FALSA);

    const aprox = criarClienteGoogle({
      chave: 'k',
      fetch: fetchFalso(() => ({ corpo: { status: 'OK', results: [{ partial_match: true, geometry: { location: { lat: -23.3, lng: -50.3 }, location_type: 'ROOFTOP' } }] } })),
    });
    assert.equal((await aprox.geocodificar('x')).aproximado, true);
    const centroRua = criarClienteGoogle({
      chave: 'k',
      fetch: fetchFalso(() => ({ corpo: { status: 'OK', results: [{ geometry: { location: { lat: -23.3, lng: -50.3 }, location_type: 'GEOMETRIC_CENTER' } }] } })),
    });
    assert.equal((await centroRua.geocodificar('x')).aproximado, true);
  });

  test('geocoding: sem resultado = null; cota = COTA; outro erro, rede e tempo = INDISPONIVEL', async () => {
    const com = (r) => criarClienteGoogle({ chave: 'k', fetch: fetchFalso(r) });
    assert.equal(await com(() => ({ corpo: { status: 'ZERO_RESULTS', results: [] } })).geocodificar('x'), null);
    await assert.rejects(com(() => ({ corpo: { status: 'OVER_QUERY_LIMIT' } })).geocodificar('x'), { motivo: 'COTA' });
    await assert.rejects(com(() => ({ corpo: { status: 'REQUEST_DENIED' } })).geocodificar('x'), { motivo: 'INDISPONIVEL' });
    await assert.rejects(com(() => { throw new Error('rede'); }).geocodificar('x'), { motivo: 'INDISPONIVEL' });
    const lento = criarClienteGoogle({
      chave: 'k',
      fetch: (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))),
    });
    await assert.rejects(lento.geocodificar('x', { tempoMs: 20 }), { motivo: 'INDISPONIVEL', message: 'tempo esgotado' });
  });

  test('rotas: distância em metros; mesmo ponto = 0; sem rota = null; 429 = COTA; 500 = INDISPONIVEL', async () => {
    const f = fetchFalso(() => ({ corpo: { routes: [{ distanceMeters: 1834 }] } }));
    const g = criarClienteGoogle({ chave: CHAVE_FALSA, fetch: f });
    assert.equal(await g.distanciaPelasRuas(LOJA, CASA), 1834);
    const { opcoes } = f.chamadas[0];
    assert.equal(opcoes.headers['x-goog-api-key'], CHAVE_FALSA);
    assert.equal(opcoes.headers['x-goog-fieldmask'], 'routes.distanceMeters');
    assert.equal(JSON.parse(opcoes.body).travelMode, 'DRIVE');

    const com = (r) => criarClienteGoogle({ chave: 'k', fetch: fetchFalso(r) });
    assert.equal(await com(() => ({ corpo: { routes: [{}] } })).distanciaPelasRuas(LOJA, LOJA), 0);
    assert.equal(await com(() => ({ corpo: {} })).distanciaPelasRuas(LOJA, CASA), null);
    await assert.rejects(com(() => ({ status: 429, corpo: {} })).distanciaPelasRuas(LOJA, CASA), { motivo: 'COTA' });
    await assert.rejects(com(() => ({ status: 500, corpo: {} })).distanciaPelasRuas(LOJA, CASA), { motivo: 'INDISPONIVEL' });
  });
});

describe('mapas: serviço, endereço, pedido, loja e rotas (banco)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let criarServicoMapas;
  let gerarTokenCliente;
  let mapas;
  let google; // simulado: { geocodificar, distanciaPelasRuas }
  const tk = {};
  let lojaCabana;
  let cliente;
  let centro;
  let xBacon;

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

  /** Serviço de mapas com o Google simulado (troca o `google` a cada teste). */
  const servico = (config = {}) =>
    criarServicoMapas({
      config: { ...lerConfigMapas({ GOOGLE_MAPS_SERVER_KEY: CHAVE_FALSA, GOOGLE_MAPS_WEB_KEY: 'chave-web' }), ...config },
      google: {
        geocodificar: (...a) => google.geocodificar(...a),
        distanciaPelasRuas: (...a) => google.distanciaPelasRuas(...a),
      },
      log: silencioso,
    });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    ({ criarServicoMapas } = await import('../src/services/mapa.service.js'));
    ({ gerarTokenCliente } = await import('../src/lib/tokens.js'));
    const { criarApp } = await import('../src/app.js');
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@mapa.test', senha: 'senha-do-dono' });
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@mapa.test', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@mapa.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@mapa.test');

    mapas = servico();
    servidor = http.createServer(criarApp({ log: false, relogio: () => SABADO_20H, mapas }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.dono = await login('dono@mapa.test', 'senha-do-dono');
    tk.ana = await login('ana@mapa.test', 'senha-da-ana');
    tk.admin = await login('admin@mapa.test', 'senha-do-admin');

    lojaCabana = await prisma.loja.findUnique({ where: { slug: 'cabana-boemia' } });
    await prisma.produto.updateMany({ where: { lojaId: lojaCabana.id, controlaEstoque: true }, data: { estoque: 100 } });
    await prisma.insumo.updateMany({ where: { lojaId: lojaCabana.id }, data: { estoque: 100 } });
    xBacon = await prisma.produto.findUnique({ where: { lojaId_nome: { lojaId: lojaCabana.id, nome: 'X-Bacon' } } });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    cliente = await prisma.cliente.create({ data: { googleId: 'mapa-1', nome: 'Maria', telefone: '43999990000' } });
    tk.cliente = gerarTokenCliente(cliente);
  });

  beforeEach(() => {
    google = {
      geocodificar: async () => ({ ...CASA, aproximado: false }),
      distanciaPelasRuas: async () => 2100,
    };
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Limite diário, cache e fallback ─────────

  test('limite diário: atômico (10 ao mesmo tempo com limite 4 = 4 passam) e por dia/serviço', async () => {
    const { reservarChamada } = await import('../src/repositories/mapa.repository.js');
    const r = await Promise.all(Array.from({ length: 10 }, () => reservarChamada('2026-01-01', 'rotas', 4)));
    assert.deepEqual(r.filter((x) => x != null).sort(), [1, 2, 3, 4]);
    assert.equal(r.filter((x) => x == null).length, 6);
    assert.equal(await reservarChamada('2026-01-01', 'geocoding', 4), 1, 'outro serviço conta à parte');
    assert.equal(await reservarChamada('2026-01-02', 'rotas', 4), 1, 'outro dia conta à parte');
    assert.equal(await reservarChamada('2026-01-03', 'rotas', 0), null, 'limite 0 = nenhuma chamada');
  });

  test('distância: rota do Google, guardada no cache (30 dias) e reaproveitada com ~11 m de diferença', async () => {
    const s = servico();
    let chamadas = 0;
    google.distanciaPelasRuas = async () => {
      chamadas += 1;
      return 1850;
    };
    const agora = new Date('2026-03-01T15:00:00Z');
    const a = await s.distanciaDoPedido({ loja: LOJA, destino: CASA, agora });
    assert.deepEqual(a, {
      latitudeLoja: LOJA.latitude, longitudeLoja: LOJA.longitude,
      latitudeEntrega: CASA.latitude, longitudeEntrega: CASA.longitude,
      distanciaMetros: 1850, distanciaOrigem: 'ROTA',
    });
    // Mesmo destino arredondado em 4 casas: cache, sem chamar o Google.
    const perto = { latitude: CASA.latitude + 0.00003, longitude: CASA.longitude - 0.00003 };
    assert.equal((await s.distanciaDoPedido({ loja: LOJA, destino: perto, agora })).distanciaMetros, 1850);
    assert.equal(chamadas, 1);
    // 29 dias depois ainda vale; 31 dias depois chama de novo.
    await s.distanciaDoPedido({ loja: LOJA, destino: CASA, agora: new Date(agora.getTime() + 29 * 86_400_000) });
    assert.equal(chamadas, 1);
    await s.distanciaDoPedido({ loja: LOJA, destino: CASA, agora: new Date(agora.getTime() + 31 * 86_400_000) });
    assert.equal(chamadas, 2);
    // A limpeza apaga o vencido.
    const r = await s.limparCacheVencido(new Date(agora.getTime() + 62 * 86_400_000));
    assert.ok(r.count >= 1);
  });

  test('distância: Google fora, sem rota, cota do dia e sem chave = linha reta × 1,3 (ESTIMADA)', async () => {
    const { distanciaEstimada } = await import('@restaurante/shared/mapa');
    const esperado = distanciaEstimada(LOJA, CASA);
    const destino = (n) => ({ latitude: CASA.latitude + n * 0.001, longitude: CASA.longitude }); // fora do cache
    const agora = new Date('2026-04-01T15:00:00Z');

    google.distanciaPelasRuas = async () => {
      const { ErroMapa } = await import('../src/lib/mapas.js');
      throw new ErroMapa('INDISPONIVEL', 'tempo esgotado');
    };
    let r = await servico().distanciaDoPedido({ loja: LOJA, destino: CASA, agora });
    assert.deepEqual([r.distanciaMetros, r.distanciaOrigem], [esperado, 'ESTIMADA']);

    google.distanciaPelasRuas = async () => null;
    r = await servico().distanciaDoPedido({ loja: LOJA, destino: destino(1), agora });
    assert.equal(r.distanciaOrigem, 'ESTIMADA');

    google.distanciaPelasRuas = async () => 999;
    const comCota = servico({ limiteRotasDia: 1 });
    const outroDia = new Date('2026-04-02T15:00:00Z');
    assert.equal((await comCota.distanciaDoPedido({ loja: LOJA, destino: destino(2), agora: outroDia })).distanciaOrigem, 'ROTA');
    assert.equal((await comCota.distanciaDoPedido({ loja: LOJA, destino: destino(3), agora: outroDia })).distanciaOrigem, 'ESTIMADA', 'limite do dia');

    const semChave = criarServicoMapas({ config: lerConfigMapas({}), log: silencioso });
    assert.equal(semChave.ativo, false);
    assert.equal((await semChave.distanciaDoPedido({ loja: LOJA, destino: destino(4), agora })).distanciaOrigem, 'ESTIMADA');
  });

  test('distância: sem pino da loja ou do endereço = só as posições que existem, sem distância', async () => {
    const s = servico();
    const semLoja = await s.distanciaDoPedido({ loja: null, destino: CASA });
    assert.deepEqual(semLoja, {
      latitudeLoja: null, longitudeLoja: null, latitudeEntrega: CASA.latitude, longitudeEntrega: CASA.longitude,
      distanciaMetros: null, distanciaOrigem: null,
    });
    const semDestino = await s.distanciaDoPedido({ loja: LOJA, destino: null });
    assert.equal(semDestino.latitudeLoja, LOJA.latitude);
    assert.equal(semDestino.distanciaMetros, null);
  });

  test('geocoding: pino; fora do raio de 60 km = NAO_ENCONTRADO; cota, erro e sem chave = sem pino com o motivo', async () => {
    assert.deepEqual(await servico().geocodificar('Rua A, 1'), { pin: CASA, aproximado: false, motivo: null });
    google.geocodificar = async () => ({ latitude: -25.43, longitude: -49.27, aproximado: false }); // Curitiba
    assert.equal((await servico().geocodificar('Rua A, 1')).motivo, 'NAO_ENCONTRADO');
    google.geocodificar = async () => null;
    assert.equal((await servico().geocodificar('Rua A, 1')).motivo, 'NAO_ENCONTRADO');
    google.geocodificar = async () => {
      const { ErroMapa } = await import('../src/lib/mapas.js');
      throw new ErroMapa('COTA', 'x');
    };
    assert.equal((await servico().geocodificar('Rua A, 1')).motivo, 'COTA');
    assert.equal((await servico({ limiteGeocodingDia: 0 }).geocodificar('Rua A, 1')).motivo, 'COTA');
    const semChave = criarServicoMapas({ config: lerConfigMapas({}), log: silencioso });
    assert.deepEqual(await semChave.geocodificar('Rua A, 1'), { pin: null, aproximado: false, motivo: 'DESLIGADO' });
  });

  test('log só com contagens: nem o texto do endereço nem o pino nem a chave', async () => {
    const linhas = [];
    const log = { info: (m) => linhas.push(m), warn: (m) => linhas.push(m) };
    const s = criarServicoMapas({
      config: { ...lerConfigMapas({ GOOGLE_MAPS_SERVER_KEY: CHAVE_FALSA }), limiteGeocodingDia: 1 },
      google: { geocodificar: async () => ({ ...CASA, aproximado: false }), distanciaPelasRuas: async () => 10 },
      log,
    });
    const agora = new Date('2026-05-05T15:00:00Z');
    await s.geocodificar('Rua Secreta, 77', { agora });
    await s.geocodificar('Rua Secreta, 77', { agora });
    await s.geocodificar('Rua Secreta, 77', { agora });
    assert.deepEqual(linhas, ['[mapas] 2026-05-05 geocoding: 1/1', '[mapas] 2026-05-05 geocoding: limite diário de 1 atingido']);
    const tudo = linhas.join('\n');
    assert.ok(!tudo.includes('Secreta') && !tudo.includes(String(CASA.latitude)) && !tudo.includes(CHAVE_FALSA));
  });

  // ───────── Endereço do cliente ─────────

  test('endereço: cria com pino; só um dos dois = 400; longe da cidade = 422 PINO_INVALIDO; sem pino continua valendo', async () => {
    const criar = (corpo) => api('POST', '/cliente/enderecos', { token: tk.cliente, corpo: { rua: 'Rua A', numero: '10', bairroId: centro.id, ...corpo } });
    const com = await criar({ latitude: CASA.latitude, longitude: CASA.longitude });
    assert.equal(com.status, 201, JSON.stringify(com.corpo));
    assert.equal(com.corpo.endereco.latitude, CASA.latitude);
    assert.equal(com.corpo.endereco.longitude, CASA.longitude);
    assert.equal((await criar({ latitude: CASA.latitude })).status, 400);
    const longe = await criar({ latitude: -25.43, longitude: -49.27 });
    assert.equal(longe.status, 422);
    assert.equal(longe.corpo.erro.codigo, 'PINO_INVALIDO');
    assert.equal((await criar({ latitude: 0, longitude: 0 })).corpo.erro.codigo, 'PINO_INVALIDO');
    const sem = await criar({});
    assert.equal(sem.status, 201);
    assert.equal(sem.corpo.endereco.latitude, null);
    await prisma.endereco.deleteMany({ where: { clienteId: cliente.id } });
  });

  test('endereço (PUT): sem pino mantém; rua, número ou bairro mudando sem pino apaga; null apaga; pino novo troca', async () => {
    const outro = await criarBairro(prisma, { nome: 'Vila Nova', taxaCentavos: 700 });
    const dados = { rua: 'Rua B', numero: '20', complemento: 'casa', bairroId: centro.id };
    const e = (await api('POST', '/cliente/enderecos', { token: tk.cliente, corpo: { ...dados, ...CASA } })).corpo.endereco;
    const put = (corpo) => api('PUT', `/cliente/enderecos/${e.id}`, { token: tk.cliente, corpo });
    const pino = async () => (await prisma.endereco.findUnique({ where: { id: e.id } }));

    // Site/PDV/app sem mapa: só o complemento mudou → o pino fica.
    assert.equal((await put({ ...dados, complemento: 'fundos', numero: ' 20 ' })).status, 200);
    assert.equal((await pino()).latitude, CASA.latitude);
    for (const mudanca of [{ rua: 'Rua C' }, { numero: '21' }, { bairroId: outro.id }]) {
      await put({ ...dados, ...CASA });
      assert.equal((await pino()).latitude, CASA.latitude);
      await put({ ...dados, ...mudanca });
      assert.equal((await pino()).latitude, null, `mudou ${Object.keys(mudanca)[0]}: pino apagado`);
    }
    // Mudou a rua COM pino novo: grava o novo.
    const novo = { latitude: -23.3091, longitude: CASA.longitude };
    await put({ ...dados, rua: 'Rua D', ...novo });
    assert.equal((await pino()).latitude, novo.latitude);
    await put({ ...dados, rua: 'Rua D', latitude: null, longitude: null });
    assert.equal((await pino()).latitude, null);
    await prisma.endereco.deleteMany({ where: { clienteId: cliente.id } });
  });

  test('busca no mapa do cliente: rua + número + bairro → pino (texto com a cidade); bairro inválido = 422; sem token = 401', async () => {
    let texto;
    google.geocodificar = async (t) => {
      texto = t;
      return { ...CASA, aproximado: true };
    };
    const r = await api('POST', '/cliente/mapa/geocodificar', { token: tk.cliente, corpo: { rua: 'Rua A', numero: '10', bairroId: centro.id } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo, { pin: CASA, aproximado: true, motivo: null });
    assert.equal(texto, 'Rua A, 10 - Centro - Abatiá-PR - Brasil');
    assert.ok(!JSON.stringify(r.corpo).includes(CHAVE_FALSA));
    assert.equal((await api('POST', '/cliente/mapa/geocodificar', { token: tk.cliente, corpo: { rua: 'Rua A', numero: '10', bairroId: 99999 } })).status, 422);
    assert.equal((await api('POST', '/cliente/mapa/geocodificar', { corpo: { rua: 'Rua A', numero: '10', bairroId: centro.id } })).status, 401);
  });

  // ───────── Loja ─────────

  test('pino da loja: DONO no perfil (null apaga, longe = 422), ADMIN pelas lojas; atendente = 403', async () => {
    const definir = (token, corpo) => api('PUT', '/retaguarda/perfil/localizacao', { token, corpo });
    assert.equal((await definir(tk.ana, LOJA)).status, 403);
    const r = await definir(tk.dono, LOJA);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.perfil.latitude, LOJA.latitude);
    assert.equal((await api('GET', '/retaguarda/perfil', { token: tk.dono })).corpo.perfil.longitude, LOJA.longitude);
    assert.equal((await definir(tk.dono, { latitude: -25.43, longitude: -49.27 })).corpo.erro.codigo, 'PINO_INVALIDO');
    assert.equal((await definir(tk.dono, { latitude: null, longitude: null })).corpo.perfil.latitude, null);
    assert.equal((await definir(tk.dono, {})).status, 400);

    const admin = await api('PATCH', `/plataforma/lojas/${lojaCabana.id}`, { token: tk.admin, corpo: LOJA });
    assert.equal(admin.status, 200, JSON.stringify(admin.corpo));
    assert.equal(admin.corpo.loja.latitude, LOJA.latitude);
    assert.equal((await api('PATCH', `/plataforma/lojas/${lojaCabana.id}`, { token: tk.admin, corpo: { latitude: 1 } })).status, 400);
    // Editar outro campo não mexe no pino.
    await api('PATCH', `/plataforma/lojas/${lojaCabana.id}`, { token: tk.admin, corpo: { descricao: 'Lanches' } });
    assert.equal((await prisma.loja.findUnique({ where: { id: lojaCabana.id } })).latitude, LOJA.latitude);
  });

  test('config do mapa da retaguarda: só a chave web, nunca a do servidor; busca da loja em texto', async () => {
    const c = await api('GET', '/retaguarda/mapa/config', { token: tk.dono });
    assert.deepEqual(c.corpo, { chaveWeb: 'chave-web', centro: CENTRO_PADRAO, busca: true });
    const p = await api('GET', '/plataforma/mapas/config', { token: tk.admin });
    assert.equal(p.corpo.chaveWeb, 'chave-web');
    assert.ok(!JSON.stringify([c.corpo, p.corpo]).includes(CHAVE_FALSA));
    const g = await api('POST', '/retaguarda/mapa/geocodificar', { token: tk.dono, corpo: { texto: 'Rua X, 1, Abatiá' } });
    assert.deepEqual(g.corpo.pin, CASA);
    assert.equal((await api('POST', '/plataforma/mapas/geocodificar', { token: tk.admin, corpo: { texto: 'Rua X, 1' } })).status, 200);
    assert.equal((await api('POST', '/retaguarda/mapa/geocodificar', { token: tk.dono, corpo: { texto: '' } })).status, 400);
  });

  test('uso dos mapas: só o ADMIN, por dia, com os limites', async () => {
    assert.equal((await api('GET', '/plataforma/mapas/uso', { token: tk.dono })).status, 403);
    const r = await api('GET', '/plataforma/mapas/uso', { token: tk.admin });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.ativo, true);
    assert.deepEqual(r.corpo.limites, { geocoding: 300, rotas: 500 });
    assert.ok(Array.isArray(r.corpo.dias));
    const { uso } = mapas;
    const u = await uso({ agora: new Date('2026-05-05T15:00:00Z'), dias: 1 });
    assert.deepEqual(u.dias, [{ dia: '2026-05-05', geocoding: 1, rotas: 0 }]);
  });

  // ───────── Pedido ─────────

  test('pedido do app: copia o pino, calcula a distância (rota) e a equipe vê link e distância; o cliente não', async () => {
    await prisma.loja.update({ where: { id: lojaCabana.id }, data: LOJA });
    const e = await prisma.endereco.create({ data: { clienteId: cliente.id, rua: 'Rua A', numero: '1', bairroId: centro.id, principal: true, ...CASA } });
    google.distanciaPelasRuas = async () => 2345;
    const r = await api('POST', '/cliente/pedidos', {
      token: tk.cliente,
      corpo: { enderecoId: e.id, formaPagamento: 'PIX', chaveIdempotencia: randomUUID(), itens: [{ produtoId: xBacon.id, quantidade: 1 }], totalEsperadoCentavos: xBacon.precoCentavos + 500 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.taxaEntregaCentavos, 500, 'a taxa continua a da área de entrega');
    assert.ok(!('distanciaMetros' in r.corpo.pedido) && !('linkMapa' in r.corpo.pedido), 'o cliente não recebe');
    const banco = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.deepEqual(
      [banco.latitudeEntrega, banco.longitudeEntrega, banco.latitudeLoja, banco.longitudeLoja, banco.distanciaMetros, banco.distanciaOrigem],
      [CASA.latitude, CASA.longitude, LOJA.latitude, LOJA.longitude, 2345, 'ROTA'],
    );
    // O endereço mudar depois não muda o pedido (foto do momento da compra).
    await prisma.endereco.update({ where: { id: e.id }, data: { latitude: CASA.latitude + 0.01 } });
    const daEquipe = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.dono })).corpo.pedidos.find((p) => p.id === r.corpo.pedido.id);
    assert.equal(daEquipe.linkMapa, `https://www.google.com/maps/search/?api=1&query=${CASA.latitude},${CASA.longitude}`);
    assert.equal(daEquipe.distanciaMetros, 2345);
    assert.equal(daEquipe.distanciaEstimada, false);
    // Cupom (fila de impressão) leva o link para o QR.
    const fila = (await api('POST', '/equipe/impressoes/reservar', { token: tk.dono, corpo: { agente: 'pdv-mapa' } })).corpo.trabalhos;
    const t = fila.find((x) => x.pedidoId === r.corpo.pedido.id);
    assert.equal(t.pedido.linkMapa, daEquipe.linkMapa);
    assert.equal(t.pedido.distanciaMetros, 2345);
  });

  test('pedido com o Google fora: criado na hora com distância estimada (o tempo limite de 1,5 s é testado no cliente do Google)', async () => {
    const e = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua F', numero: '2', bairroId: centro.id, latitude: CASA.latitude + 0.002, longitude: CASA.longitude },
    });
    google.distanciaPelasRuas = async () => {
      throw new Error('fora do ar');
    };
    const r = await api('POST', '/cliente/pedidos', {
      token: tk.cliente,
      corpo: { enderecoId: e.id, formaPagamento: 'PIX', chaveIdempotencia: randomUUID(), itens: [{ produtoId: xBacon.id, quantidade: 1 }], totalEsperadoCentavos: xBacon.precoCentavos + 500 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const banco = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.equal(banco.distanciaOrigem, 'ESTIMADA');
    assert.ok(banco.distanciaMetros > 0);
  });

  test('pedido do PDV com endereço sem pino: sem distância; sem pino da loja também; comanda não calcula', async () => {
    const semPino = await prisma.endereco.create({ data: { clienteId: cliente.id, rua: 'Rua G', numero: '3', bairroId: centro.id } });
    const pedir = () =>
      api('POST', '/equipe/pedidos', {
        token: tk.ana,
        corpo: { clienteId: cliente.id, enderecoId: semPino.id, formaPagamento: 'DINHEIRO', chaveIdempotencia: randomUUID(), itens: [{ produtoId: xBacon.id, quantidade: 1 }] },
      });
    const r = await pedir();
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const b = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.deepEqual([b.latitudeEntrega, b.distanciaMetros, b.distanciaOrigem, b.latitudeLoja], [null, null, null, LOJA.latitude]);
    const naLista = (await api('GET', '/equipe/pedidos?status=todos', { token: tk.ana })).corpo.pedidos.find((p) => p.id === b.id);
    assert.deepEqual([naLista.linkMapa, naLista.distanciaMetros, naLista.distanciaEstimada], [null, null, false]);

    await prisma.loja.update({ where: { id: lojaCabana.id }, data: { latitude: null, longitude: null } });
    await prisma.endereco.update({ where: { id: semPino.id }, data: CASA });
    const b2 = await prisma.pedido.findUnique({ where: { id: (await pedir()).corpo.pedido.id } });
    assert.deepEqual([b2.latitudeEntrega, b2.latitudeLoja, b2.distanciaMetros], [CASA.latitude, null, null]);

    const comanda = await api('POST', '/equipe/comandas', { token: tk.ana, corpo: { nomeCliente: 'Mesa' } });
    const bc = await prisma.pedido.findUnique({ where: { id: comanda.corpo.comanda?.id ?? comanda.corpo.pedido?.id } });
    assert.equal(bc.distanciaMetros, null);
  });

  test('excluir a conta apaga o pino e a distância dos pedidos (a posição da loja fica)', async () => {
    const outro = await prisma.cliente.create({ data: { googleId: 'mapa-excluir', nome: 'Zé', telefone: '43999990001' } });
    const e = await prisma.endereco.create({ data: { clienteId: outro.id, rua: 'Rua H', numero: '4', bairroId: centro.id, principal: true, ...CASA } });
    await prisma.loja.update({ where: { id: lojaCabana.id }, data: LOJA });
    const r = await api('POST', '/cliente/pedidos', {
      token: gerarTokenCliente(outro),
      corpo: { enderecoId: e.id, formaPagamento: 'PIX', chaveIdempotencia: randomUUID(), itens: [{ produtoId: xBacon.id, quantidade: 1 }], totalEsperadoCentavos: xBacon.precoCentavos + 500 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    await prisma.pedido.update({ where: { id: r.corpo.pedido.id }, data: { status: 'FINALIZADO', finalizadoEm: SABADO_20H } });
    const excluir = await api('DELETE', '/cliente/me', { token: gerarTokenCliente(outro), corpo: {} });
    assert.equal(excluir.status, 200, JSON.stringify(excluir.corpo));
    const p = await prisma.pedido.findUnique({ where: { id: r.corpo.pedido.id } });
    assert.deepEqual(
      [p.nomeCliente, p.latitudeEntrega, p.longitudeEntrega, p.distanciaMetros, p.distanciaOrigem, p.latitudeLoja],
      ['Cliente excluído', null, null, null, null, LOJA.latitude],
    );
  });

  test('banco: CHECKs do pino (os dois ou nenhum, faixas) e da distância (exige as posições e a origem)', async () => {
    await assert.rejects(prisma.endereco.create({ data: { clienteId: cliente.id, rua: 'R', numero: '1', bairroId: centro.id, latitude: -23 } }));
    await assert.rejects(prisma.loja.update({ where: { id: lojaCabana.id }, data: { latitude: 91, longitude: 0 } }));
    const p = await prisma.pedido.findFirst({ where: { distanciaMetros: null, canal: 'WHATSAPP' } });
    await assert.rejects(prisma.pedido.update({ where: { id: p.id }, data: { distanciaMetros: 10, distanciaOrigem: 'ROTA' } }), 'sem posições');
    await assert.rejects(prisma.pedido.update({ where: { id: p.id }, data: { latitudeEntrega: 1 } }), 'par incompleto');
  });
});
