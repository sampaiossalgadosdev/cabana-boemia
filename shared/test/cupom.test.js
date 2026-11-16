import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cupomParaTexto,
  formatarDataHora,
  formatarDinheiro,
  limparTexto,
  montarCupom,
  quebrar,
} from '../src/cupom.js';
import { cancelamentoWhatsapp, contaSalao, pedidoSite } from './fixtures/trabalhos.js';

// Snapshot em texto puro (legível no diff). Para regravar depois de mudar o
// layout de propósito: node --test --test-update-snapshots test/cupom.test.js
const comoTexto = [(v) => v];

describe('cupom.js', () => {
  for (const colunas of [48, 32]) {
    for (const [nome, trabalho] of [
      ['PEDIDO (site, dinheiro com troco)', pedidoSite],
      ['CANCELAMENTO (WhatsApp)', cancelamentoWhatsapp],
      ['CONTA (salão, por kg)', contaSalao],
    ]) {
      test(`snapshot ${nome} em ${colunas} colunas`, (t) => {
        const linhas = montarCupom(trabalho, { colunas, restaurante: 'Cabana Boemia' });
        for (const l of linhas) {
          assert.equal(l.texto.length, l.grande ? colunas / 2 : colunas, `largura exata: "${l.texto}"`);
        }
        t.assert.snapshot(cupomParaTexto(linhas, colunas), { serializers: comoTexto });
      });
    }
  }

  test('ordem do CLAUDE.md: restaurante, número/origem, cliente, itens, taxa/total, pagamento/troco, data', () => {
    const texto = cupomParaTexto(montarCupom(pedidoSite, { colunas: 48 }), 48);
    const posicoes = [
      'CABANA BOEMIA',
      'PEDIDO #12',
      'Site - Delivery',
      'Cliente: Maria',
      'Tel: (43) 99999-0000',
      'End: Rua Coronel',
      'X-Bacon',
      'Taxa de entrega',
      'TOTAL',
      'Pagamento',
      'Troco para',
      '14/11/2026 20:15',
    ].map((trecho) => {
      const i = texto.indexOf(trecho);
      assert.ok(i >= 0, `falta "${trecho}"`);
      return i;
    });
    assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b));
  });

  test('observação sai em negrito, em linha própria', () => {
    const linhas = montarCupom(pedidoSite, { colunas: 48 });
    const obs = linhas.filter((l) => l.texto.includes('OBS:'));
    assert.equal(obs.length, 1);
    assert.equal(obs[0].negrito, true);
    assert.match(obs[0].texto, /^ {3}OBS: sem cebola, "bem passado"\s*$/, 'aspas trocadas e emoji removido');
    const item = linhas.find((l) => l.texto.includes('X-Bacon'));
    assert.ok(!item.negrito, 'o item em si não é negrito');
  });

  test('observação longa quebra mantendo o negrito em todas as linhas', () => {
    const trabalho = structuredClone(pedidoSite);
    trabalho.pedido.itens[0].observacao = 'sem cebola, sem tomate, maionese à parte e pão bem tostadinho por favor';
    const linhas = montarCupom(trabalho, { colunas: 32 });
    const i = linhas.findIndex((l) => l.texto.includes('OBS:'));
    const bloco = linhas.slice(i, i + 3);
    assert.ok(bloco.every((l) => l.negrito), 'todas as linhas da observação em negrito');
    assert.ok(bloco.slice(1).every((l) => l.texto.startsWith(' '.repeat(8))), 'continuação alinhada após "OBS: "');
  });

  test('CANCELAMENTO: "PEDIDO CANCELADO" grande e em negrito, sem pagamento', () => {
    for (const colunas of [48, 32]) {
      const linhas = montarCupom(cancelamentoWhatsapp, { colunas });
      const titulo = linhas.find((l) => l.texto.trim() === 'PEDIDO CANCELADO');
      assert.ok(titulo?.grande && titulo.negrito, `título grande em ${colunas}`);
      assert.ok(linhas.some((l) => l.grande && l.texto.trim() === 'CANCELADO'), 'rodapé grande');
      assert.ok(!linhas.some((l) => l.texto.startsWith('Pagamento')));
      assert.ok(linhas.some((l) => l.texto.includes('Cancelado em 14/11/2026 20:40')));
    }
  });

  test('CONTA: mesa, peso, sem bloco de cliente nem pagamento', () => {
    const texto = cupomParaTexto(montarCupom(contaSalao, { colunas: 48 }), 48);
    assert.match(texto, /Salão - Mesa 4/);
    assert.match(texto, /0,455 kg Prato por kg +R\$ 27,25/);
    assert.match(texto, /R\$ 59,90\/kg/);
    assert.doesNotMatch(texto, /Cliente:|Pagamento|Taxa de entrega/);
    assert.match(texto, /Não é documento fiscal/);
  });

  test('pagamento sem troco: só a forma', () => {
    const trabalho = structuredClone(pedidoSite);
    Object.assign(trabalho.pedido, { formaPagamento: 'PIX', trocoParaCentavos: null });
    const texto = cupomParaTexto(montarCupom(trabalho, { colunas: 48 }), 48);
    assert.match(texto, /Pagamento +Pix/);
    assert.doesNotMatch(texto, /Troco/);
  });

  test('largura e tipo inválidos são recusados', () => {
    assert.throws(() => montarCupom(pedidoSite, { colunas: 40 }), /Largura inválida/);
    assert.throws(() => montarCupom({ ...pedidoSite, tipo: 'OUTRO' }), /Tipo de cupom inválido/);
  });

  test('auxiliares: dinheiro, data local, limpeza e quebra', () => {
    assert.equal(formatarDinheiro(123456), 'R$ 1.234,56');
    assert.equal(formatarDinheiro(5), 'R$ 0,05');
    assert.equal(formatarDinheiro(-2800), '-R$ 28,00');
    assert.equal(formatarDataHora('2026-11-15T02:59:00.000Z'), '14/11/2026 23:59', 'dia local de São Paulo');
    assert.equal(limparTexto(' a\n\tb – c… “d” 😀 '), 'a b - c... "d"');
    assert.deepEqual(quebrar('abc defgh ij', 5), ['abc', 'defgh', 'ij']);
    assert.deepEqual(quebrar('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  });
});
