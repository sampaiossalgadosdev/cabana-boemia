import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTRO_CIDADE, corpoDoEndereco, mapaDisponivel, mensagemDaBusca, mensagemDaLocalizacao, mudouOLugar,
  pinDoEndereco, precisaConfirmarPino, regiaoDoMapa,
} from '../src/logica/mapa.js';

const P = { latitude: -23.3101, longitude: -50.3052 };

test('pinDoEndereco e precisaConfirmarPino: endereço antigo (sem pino) pede confirmação', () => {
  assert.deepEqual(pinDoEndereco({ ...P, rua: 'A' }), P);
  assert.equal(pinDoEndereco({ latitude: null, longitude: null }), null);
  assert.equal(precisaConfirmarPino({ rua: 'A' }), true, 'campos ausentes (API antiga)');
  assert.equal(precisaConfirmarPino({ latitude: null, longitude: null }), true);
  assert.equal(precisaConfirmarPino(P), false);
  assert.equal(precisaConfirmarPino(null), false);
});

test('regiaoDoMapa: perto com pino, mais aberta se aproximado, cidade sem pino', () => {
  assert.equal(regiaoDoMapa(P).latitudeDelta, 0.003);
  assert.equal(regiaoDoMapa(P, { aproximado: true }).latitudeDelta, 0.008);
  const semPino = regiaoDoMapa(null);
  assert.equal(semPino.latitude, CENTRO_CIDADE.latitude);
  assert.equal(semPino.latitudeDelta, 0.03);
});

test('mudouOLugar: rua, número ou bairro (espaços não contam); complemento não', () => {
  const a = { rua: 'Rua A', numero: '10', bairroId: 1, complemento: 'x' };
  assert.equal(mudouOLugar(a, { ...a, complemento: 'y' }), false);
  assert.equal(mudouOLugar(a, { ...a, rua: ' Rua A ' }), false);
  assert.equal(mudouOLugar(a, { ...a, rua: 'Rua B' }), true);
  assert.equal(mudouOLugar(a, { ...a, numero: '11' }), true);
  assert.equal(mudouOLugar(a, { ...a, bairroId: 2 }), true);
  assert.equal(mudouOLugar(null, a), false);
});

test('corpoDoEndereco: o texto + o pino (sem pino = os dois null)', () => {
  const dados = { rua: 'Rua A', numero: '10', bairroId: 1 };
  assert.deepEqual(corpoDoEndereco(dados, P), { ...dados, ...P });
  assert.deepEqual(corpoDoEndereco(dados, null), { ...dados, latitude: null, longitude: null });
  assert.deepEqual(corpoDoEndereco(dados, { latitude: 0, longitude: 0 }), { ...dados, latitude: null, longitude: null });
});

test('mensagens da busca e da localização', () => {
  assert.equal(mensagemDaBusca({ pin: P, aproximado: false }).tipo, 'ok');
  assert.match(mensagemDaBusca({ pin: P, aproximado: true }).texto, /região/);
  for (const motivo of ['NAO_ENCONTRADO', 'COTA', 'DESLIGADO', 'INDISPONIVEL', undefined]) {
    assert.match(mensagemDaBusca({ pin: null, motivo }).texto, /Toque no mapa/);
  }
  assert.match(mensagemDaLocalizacao('negada'), /permissão/);
  assert.match(mensagemDaLocalizacao('erro'), /agora/);
});

test('mapaDisponivel: precisa da chave do build (ou o Expo Go); web nunca', () => {
  assert.equal(mapaDisponivel({ plataforma: 'android', extra: { mapa: { android: true, ios: false } } }), true);
  assert.equal(mapaDisponivel({ plataforma: 'ios', extra: { mapa: { android: true, ios: false } } }), false);
  assert.equal(mapaDisponivel({ plataforma: 'android', extra: {} }), false);
  assert.equal(mapaDisponivel({ plataforma: 'android', extra: {}, emExpoGo: true }), true);
  assert.equal(mapaDisponivel({ plataforma: 'web', extra: { mapa: { android: true } }, emExpoGo: true }), false);
});
