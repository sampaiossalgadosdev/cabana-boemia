import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordenadaParaTexto, lerCoordenada, mensagemDaBusca, pinDosCampos, pinMudou, pinParaApi } from '../src/lib/mapa.js';

const P = { latitude: -23.3049, longitude: -50.3133 };

test('mensagemDaBusca: achou, aproximado e cada motivo sem pino', () => {
  assert.equal(mensagemDaBusca({ pin: P, aproximado: false }).tipo, 'ok');
  assert.match(mensagemDaBusca({ pin: P, aproximado: true }).texto, /aproximada/);
  assert.match(mensagemDaBusca({ pin: null, motivo: 'NAO_ENCONTRADO' }).texto, /não encontrado/);
  assert.match(mensagemDaBusca({ pin: null, motivo: 'COTA' }).texto, /limite de hoje/);
  assert.match(mensagemDaBusca({ pin: null, motivo: 'DESLIGADO' }).texto, /não configurada/);
  assert.match(mensagemDaBusca({ pin: null, motivo: 'INDISPONIVEL' }).texto, /à mão/);
});

test('lerCoordenada e pinDosCampos: vírgula ou ponto; inválido = null', () => {
  assert.equal(lerCoordenada('-23,3049'), -23.3049);
  assert.equal(lerCoordenada(' -50.3133 '), -50.3133);
  assert.equal(lerCoordenada('abc'), null);
  assert.equal(lerCoordenada(''), null);
  assert.equal(lerCoordenada('-23,'), null);
  assert.deepEqual(pinDosCampos('-23,3049', '-50,3133'), P);
  assert.equal(pinDosCampos('-23,3049', ''), null);
  assert.equal(pinDosCampos('0', '0'), null);
  assert.equal(pinDosCampos('95', '10'), null);
});

test('coordenadaParaTexto, pinMudou (6 casas) e pinParaApi', () => {
  assert.equal(coordenadaParaTexto(-23.3049), '-23,304900');
  assert.equal(coordenadaParaTexto(null), '');
  assert.equal(pinMudou(P, { ...P }), false);
  assert.equal(pinMudou(P, { latitude: P.latitude + 0.0000001, longitude: P.longitude }), false);
  assert.equal(pinMudou(P, { latitude: P.latitude + 0.00001, longitude: P.longitude }), true);
  assert.equal(pinMudou(null, P), true);
  assert.equal(pinMudou(P, null), true);
  assert.equal(pinMudou(null, null), false);
  assert.deepEqual(pinParaApi(P), P);
  assert.deepEqual(pinParaApi(null), { latitude: null, longitude: null });
});
