import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  abertoAntesDeHoje,
  acoesDoPendente,
  avisoCaixaEsquecido,
  diaOperacional,
  descreverPendente,
  lerValorCaixa,
  removerPendente,
} from '../src/renderer/src/lib/caixa.js';

describe('caixa no PDV', () => {
  test('lerValorCaixa: reais → centavos; vazio, negativo, zero (quando mínimo 1) e texto são recusados', () => {
    assert.deepEqual(lerValorCaixa('150'), { centavos: 15000, erro: null });
    assert.deepEqual(lerValorCaixa('R$ 1.234,56'), { centavos: 123456, erro: null });
    assert.deepEqual(lerValorCaixa('0'), { centavos: 0, erro: null }, 'fundo de troco pode ser zero');
    assert.equal(lerValorCaixa('').erro, 'Informe o valor');
    assert.equal(lerValorCaixa('0', { minimo: 1 }).erro, 'O valor precisa ser maior que zero');
    assert.equal(lerValorCaixa('abc').erro, 'Valor inválido');
    assert.equal(lerValorCaixa('-5').erro, 'Valor inválido');
    assert.equal(lerValorCaixa('100000,01').erro, 'Valor alto demais');
  });

  test('caixa esquecido: aviso só se aberto num dia OPERACIONAL anterior (vira às 04:00)', () => {
    const agora = new Date('2026-11-15T13:00:00-03:00');
    assert.equal(abertoAntesDeHoje('2026-11-15T04:00:00-03:00', agora), false);
    // 00:30 do dia 15 ainda é o expediente do dia 14.
    assert.equal(abertoAntesDeHoje('2026-11-15T00:30:00-03:00', agora), true);
    assert.equal(abertoAntesDeHoje('2026-11-14T23:50:00-03:00', agora), true);
    // Aberto às 19:00 e agora é 00:30 do dia seguinte: mesmo expediente, NÃO é "de outro dia".
    assert.equal(abertoAntesDeHoje('2026-11-14T19:00:00-03:00', new Date('2026-11-15T00:30:00-03:00')), false);
    assert.equal(abertoAntesDeHoje('2026-11-14T19:00:00-03:00', new Date('2026-11-15T04:00:00-03:00')), true);
    // Virada 0 = dia civil.
    assert.equal(abertoAntesDeHoje('2026-11-14T23:50:00-03:00', new Date('2026-11-15T00:30:00-03:00'), 0), true);
    assert.equal(diaOperacional('2026-11-15T03:59:00-03:00'), '2026-11-14');
    assert.equal(diaOperacional('2026-11-15T04:00:00-03:00'), '2026-11-15');
    assert.equal(avisoCaixaEsquecido({ abertoEm: '2026-11-14T19:02:00-03:00' }, agora), 'Caixa aberto desde 14/11 às 19:02');
    assert.equal(avisoCaixaEsquecido({ abertoEm: '2026-11-15T10:00:00-03:00' }, agora), null);
    assert.equal(avisoCaixaEsquecido(null, agora), null);
  });

  test('lista do 409 PEDIDOS_ABERTOS: descrição e atalhos por pedido', () => {
    const comanda = { id: 1, canal: 'SALAO', numeroDia: 3, nomeCliente: 'Maria', mesaRotulo: '2', quantidadeItens: 2 };
    const vazia = { ...comanda, id: 2, quantidadeItens: 0 };
    const zap = { id: 3, canal: 'WHATSAPP', numeroDia: 5, nomeCliente: 'João', mesaRotulo: null };
    assert.equal(descreverPendente(comanda), 'Comanda #3 · Maria (Mesa 2)');
    assert.equal(descreverPendente(zap), 'WhatsApp #5 · João');
    assert.deepEqual(acoesDoPendente(comanda), {
      finalizar: true,
      rotuloFinalizar: 'Fechar conta',
      rotuloCancelar: 'Cancelar',
      avisoCancelar: 'O estoque dos itens volta.',
    });
    assert.equal(acoesDoPendente(vazia).finalizar, false, 'comanda vazia só exclui');
    assert.equal(acoesDoPendente(vazia).rotuloCancelar, 'Excluir');
    assert.equal(acoesDoPendente(zap).rotuloFinalizar, 'Finalizar');
    assert.match(acoesDoPendente(zap).avisoCancelar, /cupom de cancelamento/);
    assert.deepEqual(removerPendente([comanda, zap], 1), [zap]);
  });
});
