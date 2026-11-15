import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POR_LINHA,
  adicionarProduto,
  alterarQuantidade,
  atualizarPrecos,
  avaliarTroco,
  consolidar,
  definirObservacao,
  estadoDoProduto,
  itensParaApi,
  lerReais,
  pareceTelefone,
  totais,
} from '../src/renderer/src/lib/lancamento.js';

const produto = (extra = {}) => ({
  id: 1,
  nome: 'X-Burguer',
  precoCentavos: 1200,
  disponivelHoje: true,
  esgotado: false,
  saldo: null,
  ...extra,
});

describe('grade do lançamento (PDV)', () => {
  test('item esgotado aparece desabilitado na grade', () => {
    const e = estadoDoProduto(produto({ esgotado: true, saldo: 0 }));
    assert.equal(e.desabilitado, true);
    assert.equal(e.motivo, 'Esgotado');
    assert.deepEqual(adicionarProduto([], produto({ esgotado: true, saldo: 0 })), [], 'tocar não adiciona');
  });

  test('com saldo: desabilita quando o carrinho já tem tudo; mostra quantos restam', () => {
    const p = produto({ saldo: 2 });
    let linhas = adicionarProduto([], p);
    assert.equal(estadoDoProduto(p, linhas).restam, 1);
    linhas = adicionarProduto(linhas, p);
    assert.deepEqual(estadoDoProduto(p, linhas), { desabilitado: true, motivo: 'Sem mais saldo', foraDeHoje: false });
    assert.equal(adicionarProduto(linhas, p), linhas);
    assert.equal(alterarQuantidade(linhas, linhas[0].chave, +1, p), linhas);
  });

  test('fora de "disponível hoje" ganha aviso, mas pode ser lançado', () => {
    const e = estadoDoProduto(produto({ disponivelHoje: false }));
    assert.equal(e.desabilitado, false);
    assert.equal(e.foraDeHoje, true);
  });
});

describe('carrinho do lançamento', () => {
  test('tocar soma na linha sem observação; com observação vira outra linha', () => {
    const p = produto();
    let linhas = adicionarProduto([], p);
    linhas = adicionarProduto(linhas, p);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].quantidade, 2);
    linhas = consolidar(definirObservacao(linhas, linhas[0].chave, '  sem cebola '));
    linhas = adicionarProduto(linhas, p);
    assert.deepEqual(
      linhas.map((l) => [l.quantidade, l.observacao]),
      [
        [2, 'sem cebola'],
        [1, ''],
      ],
    );
  });

  test('mesma observação junta ao consolidar; −1 até zero remove', () => {
    const p = produto();
    let linhas = adicionarProduto([], p);
    linhas = definirObservacao(linhas, linhas[0].chave, 'sem cebola');
    linhas = adicionarProduto(linhas, p);
    linhas = definirObservacao(linhas, linhas[1].chave, 'Sem cebola'.toLowerCase());
    linhas = consolidar(linhas);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].quantidade, 2);
    linhas = alterarQuantidade(linhas, linhas[0].chave, -1);
    linhas = alterarQuantidade(linhas, linhas[0].chave, -1);
    assert.deepEqual(linhas, []);
  });

  test(`limite de ${MAX_POR_LINHA} por linha`, () => {
    const p = produto();
    let linhas = [];
    for (let i = 0; i < MAX_POR_LINHA + 3; i++) linhas = adicionarProduto(linhas, p);
    assert.equal(linhas[0].quantidade, MAX_POR_LINHA);
  });

  test('itens para a API: só produto, quantidade e observação (sem preço)', () => {
    const p = produto();
    let linhas = adicionarProduto(adicionarProduto([], p), p);
    linhas = definirObservacao(linhas, linhas[0].chave, '');
    assert.deepEqual(itensParaApi(linhas), [{ produtoId: 1, quantidade: 2, observacao: null }]);
  });

  test('totais com a taxa do bairro; atualizarPrecos muda o preço sem tirar item de outro turno', () => {
    const a = produto();
    const b = produto({ id: 2, nome: 'Coca', precoCentavos: 900 });
    let linhas = adicionarProduto(adicionarProduto(adicionarProduto([], a), a), b);
    assert.deepEqual(totais(linhas, 500), { subtotalCentavos: 3300, taxaEntregaCentavos: 500, totalCentavos: 3800 });
    linhas = atualizarPrecos(linhas, new Map([[1, { ...a, precoCentavos: 1300 }]]));
    assert.deepEqual(linhas.map((l) => [l.produtoId, l.precoCentavos]), [[1, 1300], [2, 900]]);
  });
});

describe('busca de cliente', () => {
  test('pareceTelefone: só dígitos e formatação vão para o campo telefone do cadastro', () => {
    assert.equal(pareceTelefone('43 98877'), true);
    assert.equal(pareceTelefone('(43) 98877-6655'), true);
    assert.equal(pareceTelefone('Maria 43'), false);
    assert.equal(pareceTelefone('123'), false);
  });
});

describe('pagamento do lançamento', () => {
  test('lerReais aceita vírgula e R$', () => {
    assert.equal(lerReais('50'), 5000);
    assert.equal(lerReais('R$ 50,5'), 5050);
    assert.equal(lerReais('1.000,00'), 100000);
    assert.equal(lerReais(''), null);
    assert.ok(Number.isNaN(lerReais('abc')));
  });

  test('troco só em dinheiro, maior que o total; calcula quanto levar', () => {
    assert.deepEqual(avaliarTroco('PIX', '100', 3800), { trocoParaCentavos: null, erro: null, levarCentavos: null });
    assert.deepEqual(avaliarTroco('DINHEIRO', '', 3800), { trocoParaCentavos: null, erro: null, levarCentavos: null });
    assert.deepEqual(avaliarTroco('DINHEIRO', '50', 3800), { trocoParaCentavos: 5000, erro: null, levarCentavos: 1200 });
    assert.ok(avaliarTroco('DINHEIRO', '38', 3800).erro);
    assert.ok(avaliarTroco('DINHEIRO', 'x', 3800).erro);
  });
});
