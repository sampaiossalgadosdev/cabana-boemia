import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDaApi, requisitar, buscarCardapio, ErroApi, ehErroDeRede, BASE, SERVIDOR_PADRAO } from '../src/lib/api.js';

/** fetch falso que guarda a chamada e devolve a resposta. */
function fetchFalso(status, corpo, chamadas = []) {
  const texto = corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return { ok: status >= 200 && status < 300, status, text: async () => texto };
  };
}

test('base absoluta: padrão é produção; aceita barra final e /api digitado', () => {
  assert.equal(SERVIDOR_PADRAO, 'https://cabana.managerpix.com.br');
  assert.equal(BASE, 'https://cabana.managerpix.com.br/api', 'sem EXPO_PUBLIC_API_URL no teste');
  assert.equal(baseDaApi(''), 'https://cabana.managerpix.com.br/api');
  assert.equal(baseDaApi(undefined), 'https://cabana.managerpix.com.br/api');
  assert.equal(baseDaApi('http://192.168.0.10:3000/'), 'http://192.168.0.10:3000/api');
  assert.equal(baseDaApi(' https://x.com.br/api/ '), 'https://x.com.br/api');
});

test('erro da API vira ErroApi com mensagem, código, status e detalhes', async () => {
  const f = fetchFalso(409, { erro: { mensagem: 'Preço mudou', codigo: 'PRECO_ALTERADO', detalhes: { totalCentavos: 1 } } });
  const erro = await requisitar('POST', '/cliente/pedidos', { corpo: {}, fetch: f }).catch((e) => e);
  assert.ok(erro instanceof ErroApi);
  assert.equal(erro.status, 409);
  assert.equal(erro.codigo, 'PRECO_ALTERADO');
  assert.equal(erro.message, 'Preço mudou');
  assert.deepEqual(erro.detalhes, { totalCentavos: 1 });
  assert.equal(ehErroDeRede(erro), false);
});

test('corpo não-JSON (proxy fora do ar) vira ErroApi genérico', async () => {
  const erro = await requisitar('GET', '/publico/config', { fetch: fetchFalso(502, '<html>Bad gateway</html>') }).catch((e) => e);
  assert.ok(erro instanceof ErroApi);
  assert.equal(erro.message, 'Erro 502');
});

test('URL absoluta, token no Authorization, JSON no corpo', async () => {
  const chamadas = [];
  const r = await requisitar('PUT', '/cliente/me', { token: 'abc', corpo: { nome: 'A' }, fetch: fetchFalso(200, { ok: 1 }, chamadas) });
  assert.deepEqual(r, { ok: 1 });
  assert.equal(chamadas[0].url, 'https://cabana.managerpix.com.br/api/cliente/me');
  assert.equal(chamadas[0].opcoes.headers.authorization, 'Bearer abc');
  assert.equal(chamadas[0].opcoes.body, '{"nome":"A"}');
});

test('cardápio: recarga normal usa o cache de 15 s; forçada pede sem cache', async () => {
  const chamadas = [];
  const f = fetchFalso(200, { aberto: true, categorias: [] }, chamadas);
  await buscarCardapio(undefined, { fetch: f });
  await buscarCardapio(undefined, { forcar: true, fetch: f });
  assert.equal(chamadas[0].opcoes.cache, undefined);
  assert.equal(chamadas[0].opcoes.headers['cache-control'], undefined);
  assert.equal(chamadas[1].opcoes.cache, 'no-cache');
  assert.equal(chamadas[1].opcoes.headers['cache-control'], 'no-cache');
});

test('falha de rede e tempo esgotado são erro de rede; cancelamento não', async () => {
  const semRede = async () => {
    throw new TypeError('Network request failed');
  };
  const e1 = await requisitar('GET', '/x', { fetch: semRede }).catch((e) => e);
  assert.equal(ehErroDeRede(e1), true);

  const pendurado = (url, { signal }) =>
    new Promise((_, rejeitar) => {
      signal.addEventListener('abort', () => rejeitar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    });
  const e2 = await requisitar('GET', '/x', { fetch: pendurado, tempoLimiteMs: 20 }).catch((e) => e);
  assert.equal(ehErroDeRede(e2), true, 'tempo esgotado = sem conexão');

  const controle = new AbortController();
  const p = requisitar('GET', '/x', { fetch: pendurado, signal: controle.signal });
  controle.abort();
  const e3 = await p.catch((e) => e);
  assert.equal(e3.name, 'AbortError');
  assert.equal(ehErroDeRede(e3), false);
});
