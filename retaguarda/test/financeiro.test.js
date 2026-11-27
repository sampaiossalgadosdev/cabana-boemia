import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nomeDaSemana,
  nomeDoPedido,
  pedeLembreteDeAjuste,
  pedirAjuste,
  pegarAjustePedido,
  progressoCampanha,
  textoDoSaldo,
  textoDoSaldoAdmin,
  valorComSinal,
  valorDoAjuste,
  valorParaLoja,
} from '../src/lib/financeiro.js';

const r = (s) => s.replace(/ /g, ' ');

test('saldo em linguagem simples (loja e ADMIN)', () => {
  assert.equal(r(textoDoSaldo(1250)), 'Você deve ao Taaki R$ 12,50');
  assert.equal(r(textoDoSaldo(-600)), 'O Taaki deve a você R$ 6,00');
  assert.equal(textoDoSaldo(0), 'Nenhum valor a acertar com o Taaki');
  assert.equal(r(textoDoSaldoAdmin(1250, 'Cabana')), 'Cabana deve R$ 12,50 ao Taaki');
  assert.equal(r(textoDoSaldoAdmin(-600, 'Cabana')), 'O Taaki deve R$ 6,00 a Cabana');
  assert.equal(textoDoSaldoAdmin(0, 'Cabana'), 'Saldo zero');
});

test('valores de lançamento, semana e pedido', () => {
  assert.equal(r(valorParaLoja(500)), 'Você deve R$ 5,00');
  assert.equal(r(valorParaLoja(-500)), 'A receber R$ 5,00');
  assert.equal(r(valorComSinal(500)), '+R$ 5,00');
  assert.equal(r(valorComSinal(-500)), '−R$ 5,00');
  assert.equal(nomeDaSemana('2026-11-23', '2026-11-29'), '23/11 a 29/11');
  assert.equal(nomeDoPedido({ id: 9, numeroDia: 12, dataRef: '2026-11-23' }), 'nº 12 de 23/11');
  assert.equal(nomeDoPedido({ id: 9, numeroDia: null, dataRef: '2026-11-23' }), 'código 9');
  assert.equal(nomeDoPedido(null), '—');
});

test('campanha contra o orçamento', () => {
  const p = progressoCampanha({ totalCentavos: 17500, orcamentoCentavos: 70000 });
  assert.equal(p.porcentagem, 25);
  assert.equal(r(p.texto), 'R$ 175,00 de R$ 700,00');
  assert.equal(p.estourou, false);
  const passou = progressoCampanha({ totalCentavos: 80000, orcamentoCentavos: 70000 });
  assert.equal(passou.porcentagem, 100);
  assert.equal(passou.estourou, true);
});

test('ajuste manual: direção vira o sinal; atalho guardado uma vez', () => {
  assert.equal(valorDoAjuste('LOJA_DEVE', 300), 300);
  assert.equal(valorDoAjuste('TAAKI_DEVE', 300), -300);
  pedirAjuste({ lojaId: 1, pedidoId: 2 });
  assert.deepEqual(pegarAjustePedido(), { lojaId: 1, pedidoId: 2 });
  assert.equal(pegarAjustePedido(), null);
});

test('lembrete do ajuste: só pedido finalizado com entrega pelo Taaki', () => {
  assert.equal(pedeLembreteDeAjuste({ status: 'FINALIZADO', origemTaxaEntrega: 'KM' }), true);
  assert.equal(pedeLembreteDeAjuste({ status: 'FINALIZADO', origemTaxaEntrega: null }), false);
  assert.equal(pedeLembreteDeAjuste({ status: 'CONFIRMADO', origemTaxaEntrega: 'KM' }), false);
});

test('menus: "Fechamento" para toda loja e "Financeiro" na plataforma; alerta novo com nome', () => {
  // rotas.js usa import.meta.env (Vite): lido como texto.
  const rotas = readFileSync(new URL('../src/lib/rotas.js', import.meta.url), 'utf8');
  assert.match(rotas, /caminho: 'fechamento', titulo: 'Fechamento'[\s\S]*TELAS_PLATAFORMA/);
  assert.match(rotas, /TELAS_PLATAFORMA[\s\S]*caminho: 'financeiro', titulo: 'Financeiro'/);
  const alertas = readFileSync(new URL('../src/telas/TelaAlertas.jsx', import.meta.url), 'utf8');
  assert.match(alertas, /FECHAMENTO_ATRASADO: 'Fechamento atrasado'/);
});
