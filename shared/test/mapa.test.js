import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arredondar4, distanciaEmLinhaReta, distanciaEstimada, formatarDistancia, linkDoMapa, pinDe, pinValido,
} from '../src/mapa.js';

const ABATIA = { latitude: -23.3049, longitude: -50.3131 };

test('pinValido: números finitos nas faixas; 0,0, texto e faltando recusados', () => {
  assert.equal(pinValido(ABATIA), true);
  assert.equal(pinValido({ latitude: 0, longitude: 0 }), false);
  assert.equal(pinValido({ latitude: 91, longitude: 0 }), false);
  assert.equal(pinValido({ latitude: 10, longitude: -181 }), false);
  assert.equal(pinValido({ latitude: '-23', longitude: -50 }), false);
  assert.equal(pinValido({ latitude: NaN, longitude: -50 }), false);
  assert.equal(pinValido({ latitude: -23 }), false);
  assert.equal(pinValido(null), false);
});

test('pinDe: lê do registro, com nomes de campo próprios', () => {
  assert.deepEqual(pinDe({ latitude: -23.3, longitude: -50.3 }), { latitude: -23.3, longitude: -50.3 });
  assert.equal(pinDe({ latitude: null, longitude: null }), null);
  assert.deepEqual(pinDe({ latitudeLoja: 1, longitudeLoja: 2 }, { lat: 'latitudeLoja', lng: 'longitudeLoja' }), { latitude: 1, longitude: 2 });
});

test('distância em linha reta e estimada (× 1,3)', () => {
  assert.equal(distanciaEmLinhaReta(ABATIA, ABATIA), 0);
  // 0,01° de latitude ≈ 1112 m.
  const norte = { latitude: ABATIA.latitude + 0.01, longitude: ABATIA.longitude };
  assert.ok(Math.abs(distanciaEmLinhaReta(ABATIA, norte) - 1112) < 2);
  assert.equal(distanciaEstimada(ABATIA, norte), Math.round(distanciaEmLinhaReta(ABATIA, norte) * 1.3));
  assert.equal(distanciaEstimada(ABATIA, ABATIA), 0);
});

test('arredondar4: inteiro ×10⁴', () => {
  assert.equal(arredondar4(-23.30494), -233049);
  assert.equal(arredondar4(-23.30496), -233050);
  assert.equal(arredondar4(-50.31313), -503131);
});

test('linkDoMapa: Google Maps com até 6 casas; sem pino = null', () => {
  assert.equal(linkDoMapa(ABATIA), 'https://www.google.com/maps/search/?api=1&query=-23.3049,-50.3131');
  assert.equal(linkDoMapa({ latitude: -23.123456789, longitude: -50.1 }), 'https://www.google.com/maps/search/?api=1&query=-23.123457,-50.1');
  assert.equal(linkDoMapa(null), null);
});

test('formatarDistancia', () => {
  assert.equal(formatarDistancia(0), '0 m');
  assert.equal(formatarDistancia(850), '850 m');
  assert.equal(formatarDistancia(1000), '1,0 km');
  assert.equal(formatarDistancia(3249), '3,2 km');
  assert.equal(formatarDistancia(12600), '13 km');
  assert.equal(formatarDistancia(null), '');
  assert.equal(formatarDistancia(-1), '');
});
