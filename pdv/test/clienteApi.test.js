import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteApi, expiracaoDoJwt } from '../src/main/clienteApi.js';

const AGORA = 1_800_000_000_000;

/** JWT de mentira com `exp` (a assinatura não é verificada no PDV). */
function jwt(expMs, sub = 1) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub, exp: Math.floor(expMs / 1000) })}.assinatura`;
}

function armazemFalso(inicial = null) {
  return {
    valor: inicial,
    async ler() {
      return this.valor;
    },
    async guardar(t) {
      this.valor = t;
    },
    async apagar() {
      this.valor = null;
    },
  };
}

const resposta = (status, corpo) => new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });

/** Servidor falso: conta chamadas por rota e responde com `rotas[rota](req)`. */
function servidorFalso(rotas) {
  const chamadas = [];
  const fetch = async (url, init) => {
    const rota = `${init.method} ${new URL(url).pathname}`;
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ rota, corpo, auth: init.headers.authorization });
    // Resposta assíncrona, para chamadas simultâneas se sobreporem.
    await new Promise((r) => setTimeout(r, 5));
    const h = rotas[rota];
    if (!h) return resposta(404, { erro: { mensagem: 'nada', codigo: 'NAO_ENCONTRADO' } });
    return h({ corpo, auth: init.headers.authorization });
  };
  return { fetch, chamadas, contar: (rota) => chamadas.filter((c) => c.rota === rota).length };
}

describe('clienteApi (main)', () => {
  test('expiracaoDoJwt lê o exp e tolera lixo', () => {
    assert.equal(expiracaoDoJwt(jwt(AGORA + 60_000)), AGORA + 60_000);
    assert.equal(expiracaoDoJwt('lixo'), 0);
  });

  test('login guarda o refresh no armazém e usa o access nas requisições', async () => {
    const armazem = armazemFalso();
    const access = jwt(AGORA + 15 * 60_000);
    const s = servidorFalso({
      'POST /auth/login': () => resposta(200, { accessToken: access, refreshToken: 'r1', usuario: { id: 1, nome: 'Ana' } }),
      'GET /equipe/pedidos': ({ auth }) => resposta(auth === `Bearer ${access}` ? 200 : 401, { pedidos: [] }),
    });
    const api = criarClienteApi({ apiUrl: () => 'http://api', armazem, fetch: s.fetch, agora: () => AGORA });
    assert.deepEqual(await api.entrar('ana@x.com', 'senha'), { id: 1, nome: 'Ana' });
    assert.equal(armazem.valor, 'r1');
    assert.deepEqual(await api.requisitar('GET', '/equipe/pedidos'), { pedidos: [] });
    assert.equal(s.contar('POST /auth/refresh'), 0);
  });

  test('renovação é single-flight: chamadas simultâneas usam UM refresh (a API revoga reuso)', async () => {
    const armazem = armazemFalso('r1');
    let gerados = 0;
    const s = servidorFalso({
      'POST /auth/refresh': ({ corpo }) => {
        if (corpo.refreshToken !== armazem.valor) return resposta(401, { erro: { codigo: 'REFRESH_REUTILIZADO' } });
        gerados += 1;
        return resposta(200, { accessToken: jwt(AGORA + 15 * 60_000, gerados), refreshToken: `r${gerados + 1}` });
      },
      'GET /x': () => resposta(200, { ok: true }),
    });
    const api = criarClienteApi({ apiUrl: () => 'http://api', armazem, fetch: s.fetch, agora: () => AGORA });
    await Promise.all([api.requisitar('GET', '/x'), api.requisitar('GET', '/x'), api.accessToken()]);
    assert.equal(s.contar('POST /auth/refresh'), 1);
    assert.equal(armazem.valor, 'r2', 'refresh rotacionado salvo');
  });

  test('access perto de vencer é renovado antes da requisição', async () => {
    const armazem = armazemFalso();
    let agora = AGORA;
    const s = servidorFalso({
      'POST /auth/login': () => resposta(200, { accessToken: jwt(AGORA + 15 * 60_000), refreshToken: 'r1', usuario: {} }),
      'POST /auth/refresh': () => resposta(200, { accessToken: jwt(agora + 15 * 60_000), refreshToken: 'r2' }),
      'GET /x': () => resposta(200, {}),
    });
    const api = criarClienteApi({ apiUrl: () => 'http://api', armazem, fetch: s.fetch, agora: () => agora });
    await api.entrar('a@x.com', 's');
    agora = AGORA + 14.5 * 60_000; // faltam 30 s
    await api.requisitar('GET', '/x');
    assert.equal(s.contar('POST /auth/refresh'), 1);
  });

  test('401 na requisição renova e repete uma vez', async () => {
    const armazem = armazemFalso('r1');
    let aceita = null;
    const s = servidorFalso({
      'POST /auth/refresh': () => {
        aceita = jwt(AGORA + 15 * 60_000, Math.random());
        return resposta(200, { accessToken: aceita, refreshToken: 'r-novo' });
      },
      'GET /x': ({ auth }) => resposta(auth === `Bearer ${aceita}` ? 200 : 401, { ok: true }),
    });
    const api = criarClienteApi({ apiUrl: () => 'http://api', armazem, fetch: s.fetch, agora: () => AGORA });
    await api.accessToken();
    aceita = 'outro'; // ex.: segredo trocado no servidor
    assert.deepEqual(await api.requisitar('GET', '/x'), { ok: true });
    assert.equal(s.contar('GET /x'), 2);
  });

  test('refresh recusado: apaga a sessão local e avisa "sessão expirou"', async () => {
    const armazem = armazemFalso('r-revogado');
    const avisos = [];
    const s = servidorFalso({
      'POST /auth/refresh': () => resposta(401, { erro: { mensagem: 'Sessão inválida', codigo: 'REFRESH_INVALIDO' } }),
    });
    const api = criarClienteApi({
      apiUrl: () => 'http://api', armazem, fetch: s.fetch, agora: () => AGORA,
      aoSessaoExpirar: (e) => avisos.push(e.codigo),
    });
    assert.equal(await api.restaurar(), null);
    assert.equal(armazem.valor, null);
    assert.deepEqual(avisos, ['REFRESH_INVALIDO']);
  });

  test('sem rede: mantém o refresh (tenta de novo depois)', async () => {
    const armazem = armazemFalso('r1');
    const api = criarClienteApi({
      apiUrl: () => 'http://api', armazem, agora: () => AGORA,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await assert.rejects(api.restaurar(), { codigo: 'SEM_CONEXAO' });
    assert.equal(armazem.valor, 'r1');
  });

  test('sair apaga o local mesmo se a API não responder', async () => {
    const armazem = armazemFalso('r1');
    const api = criarClienteApi({
      apiUrl: () => 'http://api', armazem, agora: () => AGORA,
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await api.sair();
    assert.equal(armazem.valor, null);
    assert.equal(api.logado(), false);
  });

  test('erro da API vira ErroApi com mensagem, código e status', async () => {
    const s = servidorFalso({
      'POST /auth/login': () => resposta(401, { erro: { mensagem: 'Email ou senha inválidos', codigo: 'CREDENCIAIS_INVALIDAS' } }),
    });
    const api = criarClienteApi({ apiUrl: () => 'http://api', armazem: armazemFalso(), fetch: s.fetch });
    await assert.rejects(api.entrar('a@x.com', 'errada'), {
      message: 'Email ou senha inválidos', codigo: 'CREDENCIAIS_INVALIDAS', status: 401,
    });
  });

  test('sem servidor configurado: SEM_SERVIDOR', async () => {
    const api = criarClienteApi({ apiUrl: () => null, armazem: armazemFalso(), fetch: async () => assert.fail() });
    await assert.rejects(api.entrar('a@x.com', 's'), { codigo: 'SEM_SERVIDOR' });
  });
});
