import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularSplit, dividirTaxaEntrega } from '../src/split.js';
import { taxaPorKm } from '../src/taxaKm.js';

const FG_LOJA = { minimoCentavos: 3000 }; // frete grátis da loja a partir de R$ 30,00
const TAXA_KM = taxaPorKm(2000); // 2 km de ida: R$ 1,00 + 0,90 × 4 = R$ 4,60

const plataforma = (extra = {}) =>
  calcularSplit({ subtotalCentavos: 4000, modoEntrega: 'PLATAFORMA', taxaEntregaCentavos: TAXA_KM, origemTaxa: 'KM', ...extra });
const proprio = (extra = {}) =>
  calcularSplit({ subtotalCentavos: 4000, modoEntrega: 'PROPRIO', taxaEntregaCentavos: 500, origemTaxa: 'AREA', ...extra });

test('divisão 95/5: entregador meio para cima, plataforma com o resto, soma igual à taxa', () => {
  assert.deepEqual(dividirTaxaEntrega(460), { entregadorCentavos: 437, plataformaCentavos: 23 }); // 437,0
  assert.deepEqual(dividirTaxaEntrega(470), { entregadorCentavos: 447, plataformaCentavos: 23 }); // 446,5 → 447
  assert.deepEqual(dividirTaxaEntrega(469), { entregadorCentavos: 446, plataformaCentavos: 23 }); // 445,55 → 446
  assert.deepEqual(dividirTaxaEntrega(101), { entregadorCentavos: 96, plataformaCentavos: 5 }); // 95,95 → 96
  assert.deepEqual(dividirTaxaEntrega(10), { entregadorCentavos: 10, plataformaCentavos: 0 }); // 9,5 → 10
  assert.deepEqual(dividirTaxaEntrega(0), { entregadorCentavos: 0, plataformaCentavos: 0 });
  for (let t = 0; t <= 5000; t++) {
    const { entregadorCentavos: e, plataformaCentavos: p } = dividirTaxaEntrega(t);
    assert.equal(e + p, t);
    assert.ok(Math.abs(e - (t * 95) / 100) <= 0.5);
  }
  assert.throws(() => dividirTaxaEntrega(-1), RangeError);
  assert.throws(() => dividirTaxaEntrega(1.5), RangeError);
});

test('PLATAFORMA sem frete grátis: cliente paga a taxa e ela vai inteira no split', () => {
  assert.deepEqual(plataforma(), {
    taxaCheiaCentavos: 460,
    taxaCobradaCentavos: 460,
    valorCobradoCentavos: 4460,
    origemFreteGratis: 'NENHUM',
    consumirCampanha: false,
    origemTaxaEntrega: 'KM',
    valorEntregadorCentavos: 437,
    valorPlataformaEntregaCentavos: 23,
    devidoPelaLojaCentavos: 460,
    valorPlataformaSplitCentavos: 460,
    complementoLojaCentavos: 0,
    alertaAdmin: false,
    creditoLojaCentavos: 0,
  });
});

test('PLATAFORMA com frete grátis da loja: cliente não paga, a loja paga a taxa cheia no split', () => {
  const r = plataforma({ freteGratisLoja: FG_LOJA });
  assert.equal(r.origemFreteGratis, 'LOJA');
  assert.equal(r.taxaCobradaCentavos, 0);
  assert.equal(r.valorCobradoCentavos, 4000);
  assert.equal(r.devidoPelaLojaCentavos, 460);
  assert.equal(r.valorPlataformaSplitCentavos, 460);
  assert.equal(r.valorEntregadorCentavos, 437);
  assert.equal(r.consumirCampanha, false);
  assert.equal(r.creditoLojaCentavos, 0);
});

test('PLATAFORMA abaixo do mínimo do frete grátis da loja: paga a taxa normalmente', () => {
  const r = plataforma({ subtotalCentavos: 2999, freteGratisLoja: FG_LOJA });
  assert.equal(r.origemFreteGratis, 'NENHUM');
  assert.equal(r.taxaCobradaCentavos, 460);
});

test('PLATAFORMA com campanha: cliente não paga, split zero, entregador continua gravado', () => {
  const r = plataforma({ campanhaElegivel: true });
  assert.equal(r.origemFreteGratis, 'CAMPANHA');
  assert.equal(r.consumirCampanha, true);
  assert.equal(r.taxaCobradaCentavos, 0);
  assert.equal(r.valorCobradoCentavos, 4000);
  assert.equal(r.devidoPelaLojaCentavos, 0);
  assert.equal(r.valorPlataformaSplitCentavos, 0);
  assert.equal(r.valorEntregadorCentavos, 437);
  assert.equal(r.valorPlataformaEntregaCentavos, 23);
  assert.equal(r.creditoLojaCentavos, 0);
});

test('PLATAFORMA com os dois: vale o da loja e a campanha não é consumida', () => {
  const r = plataforma({ freteGratisLoja: FG_LOJA, campanhaElegivel: true });
  assert.equal(r.origemFreteGratis, 'LOJA');
  assert.equal(r.consumirCampanha, false);
  assert.equal(r.valorPlataformaSplitCentavos, 460);
  // Abaixo do mínimo da loja, a campanha entra.
  const abaixo = plataforma({ subtotalCentavos: 2000, freteGratisLoja: FG_LOJA, campanhaElegivel: true });
  assert.equal(abaixo.origemFreteGratis, 'CAMPANHA');
  assert.equal(abaixo.consumirCampanha, true);
});

test('PLATAFORMA no PDV sem pino: taxa da área como reserva, mesma divisão, origem AREA', () => {
  const r = plataforma({ taxaEntregaCentavos: 600, origemTaxa: 'AREA' });
  assert.equal(r.origemTaxaEntrega, 'AREA');
  assert.equal(r.valorEntregadorCentavos, 570);
  assert.equal(r.valorPlataformaEntregaCentavos, 30);
  assert.equal(r.devidoPelaLojaCentavos, 600);
});

test('PROPRIO sem frete grátis: taxa da loja, nada para a plataforma, sem entregador', () => {
  assert.deepEqual(proprio(), {
    taxaCheiaCentavos: 500,
    taxaCobradaCentavos: 500,
    valorCobradoCentavos: 4500,
    origemFreteGratis: 'NENHUM',
    consumirCampanha: false,
    origemTaxaEntrega: null,
    valorEntregadorCentavos: null,
    valorPlataformaEntregaCentavos: null,
    devidoPelaLojaCentavos: 0,
    valorPlataformaSplitCentavos: 0,
    complementoLojaCentavos: 0,
    alertaAdmin: false,
    creditoLojaCentavos: 0,
  });
});

test('PROPRIO com frete grátis da loja: nada muda para a plataforma', () => {
  const r = proprio({ freteGratisLoja: FG_LOJA });
  assert.equal(r.origemFreteGratis, 'LOJA');
  assert.equal(r.taxaCobradaCentavos, 0);
  assert.equal(r.valorPlataformaSplitCentavos, 0);
  assert.equal(r.creditoLojaCentavos, 0);
});

test('PROPRIO com campanha: cliente não paga e a taxa da área vira crédito da loja', () => {
  const r = proprio({ campanhaElegivel: true });
  assert.equal(r.origemFreteGratis, 'CAMPANHA');
  assert.equal(r.consumirCampanha, true);
  assert.equal(r.valorCobradoCentavos, 4000);
  assert.equal(r.creditoLojaCentavos, 500);
  assert.equal(r.valorPlataformaSplitCentavos, 0);
  assert.equal(r.valorEntregadorCentavos, null);
});

test('PROPRIO com os dois: vale o da loja, sem crédito e sem consumir a campanha', () => {
  const r = proprio({ freteGratisLoja: FG_LOJA, campanhaElegivel: true });
  assert.equal(r.origemFreteGratis, 'LOJA');
  assert.equal(r.consumirCampanha, false);
  assert.equal(r.creditoLojaCentavos, 0);
});

test('taxa zero: não há frete grátis a dar nem campanha a consumir', () => {
  const r = proprio({ taxaEntregaCentavos: 0, campanhaElegivel: true, freteGratisLoja: FG_LOJA });
  assert.equal(r.origemFreteGratis, 'NENHUM');
  assert.equal(r.consumirCampanha, false);
  assert.equal(r.creditoLojaCentavos, 0);
});

test('retirada no balcão: sem taxa, sem entregador, sem campanha', () => {
  const r = plataforma({ comEntrega: false, origemTaxa: undefined, campanhaElegivel: true });
  assert.equal(r.taxaCheiaCentavos, 0);
  assert.equal(r.origemTaxaEntrega, null);
  assert.equal(r.valorEntregadorCentavos, null);
  assert.equal(r.consumirCampanha, false);
  assert.equal(r.devidoPelaLojaCentavos, 0);
});

test('trava de 50%: o split leva no máximo metade do valor cobrado; o resto é complemento com alerta', () => {
  // Taxa de R$ 8,00 num pedido de R$ 5,00 sem frete grátis: cobrado R$ 13,00, metade R$ 6,50.
  const r = plataforma({ subtotalCentavos: 500, taxaEntregaCentavos: 800 });
  assert.equal(r.valorCobradoCentavos, 1300);
  assert.equal(r.devidoPelaLojaCentavos, 800);
  assert.equal(r.valorPlataformaSplitCentavos, 650);
  assert.equal(r.complementoLojaCentavos, 150);
  assert.equal(r.alertaAdmin, true);
  assert.equal(r.valorEntregadorCentavos, 760); // a divisão é sempre da taxa cheia

  // Frete grátis da loja com mínimo baixo: cobrado R$ 10,01, taxa R$ 8,00 → split R$ 5,00 (para baixo).
  const fg = plataforma({ subtotalCentavos: 1001, taxaEntregaCentavos: 800, freteGratisLoja: { minimoCentavos: 1000 } });
  assert.equal(fg.valorCobradoCentavos, 1001);
  assert.equal(fg.valorPlataformaSplitCentavos, 500);
  assert.equal(fg.complementoLojaCentavos, 300);
  assert.equal(fg.valorPlataformaSplitCentavos + fg.complementoLojaCentavos, fg.devidoPelaLojaCentavos);

  // Frete grátis da loja com taxa igual ao valor cobrado: só metade vai no split.
  const metade = plataforma({ subtotalCentavos: 800, taxaEntregaCentavos: 800, freteGratisLoja: { minimoCentavos: 800 } });
  assert.equal(metade.valorCobradoCentavos, 800);
  assert.equal(metade.valorPlataformaSplitCentavos, 400);
  assert.equal(metade.complementoLojaCentavos, 400);
  // Exatamente 50% do valor cobrado: não passa, sem complemento.
  const ok =plataforma({ subtotalCentavos: 800, taxaEntregaCentavos: 800 });
  assert.equal(ok.valorCobradoCentavos, 1600);
  assert.equal(ok.complementoLojaCentavos, 0);
  assert.equal(ok.alertaAdmin, false);
});

test('desconto da loja entra no valor cobrado (e na trava)', () => {
  const r = plataforma({ descontoCentavos: 1000 });
  assert.equal(r.valorCobradoCentavos, 3460);
  assert.equal(r.valorPlataformaSplitCentavos, 460);
  assert.throws(() => plataforma({ subtotalCentavos: 100, descontoCentavos: 1000 }), RangeError);
});

test('entradas inválidas são recusadas', () => {
  assert.throws(() => plataforma({ modoEntrega: 'LOJA' }), RangeError);
  assert.throws(() => plataforma({ origemTaxa: undefined }), RangeError);
  assert.throws(() => plataforma({ taxaEntregaCentavos: -1 }), RangeError);
  assert.throws(() => plataforma({ taxaEntregaCentavos: 4.6 }), RangeError);
  assert.throws(() => plataforma({ subtotalCentavos: -1 }), RangeError);
  // PROPRIO não exige a origem da taxa.
  assert.doesNotThrow(() => proprio({ origemTaxa: undefined }));
});
