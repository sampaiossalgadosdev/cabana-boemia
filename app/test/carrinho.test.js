import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  adicionar,
  editar,
  remover,
  conciliar,
  mensagensDaConciliacao,
  totalCentavos,
  totalItens,
  carregarCarrinho,
  salvarCarrinho,
  CHAVE_STORAGE,
  QUANTIDADE_MAX,
  OBSERVACAO_MAX,
} from '../src/logica/carrinho.js';

const XBACON = { id: 6, nome: 'X-Bacon', precoCentavos: 1600 };
const COCA = { id: 23, nome: 'Coca-Cola 1L', precoCentavos: 900 };

/** Storage em memória com a mesma interface do localStorage. */
function storageFalso(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    dados,
  };
}

describe('adicionar', () => {
  test('mesmo produto com a mesma observação soma na mesma linha', () => {
    let itens = adicionar([], XBACON, 1, 'sem cebola');
    itens = adicionar(itens, XBACON, 2, '  Sem   CEBOLA ');
    assert.equal(itens.length, 1);
    assert.equal(itens[0].quantidade, 3);
    assert.equal(itens[0].observacao, 'sem cebola');
  });

  test('mesmo produto com observação diferente vira outra linha', () => {
    let itens = adicionar([], XBACON, 1, 'sem cebola');
    itens = adicionar(itens, XBACON, 1, '');
    assert.equal(itens.length, 2);
  });

  test('quantidade fica entre 1 e o máximo; observação é cortada no limite', () => {
    const itens = adicionar([], XBACON, 999, 'x'.repeat(500));
    assert.equal(itens[0].quantidade, QUANTIDADE_MAX);
    assert.equal(itens[0].observacao.length, OBSERVACAO_MAX);
    assert.equal(adicionar([], XBACON, 0)[0].quantidade, 1);
  });

  test('totais somam preço × quantidade de todas as linhas', () => {
    let itens = adicionar([], XBACON, 2);
    itens = adicionar(itens, COCA, 1);
    assert.equal(totalItens(itens), 3);
    assert.equal(totalCentavos(itens), 2 * 1600 + 900);
  });
});

describe('editar e remover', () => {
  test('editar troca quantidade e observação da linha', () => {
    const [linha] = adicionar([], XBACON, 1, 'sem cebola');
    const itens = editar([linha], linha.id, { quantidade: 4, observacao: 'bem passado' });
    assert.equal(itens.length, 1);
    assert.equal(itens[0].quantidade, 4);
    assert.equal(itens[0].observacao, 'bem passado');
    assert.notEqual(itens[0].id, linha.id);
  });

  test('editar a observação para igual à de outra linha junta as duas', () => {
    let itens = adicionar([], XBACON, 1, 'sem cebola');
    itens = adicionar(itens, XBACON, 2, '');
    const semObs = itens.find((i) => i.observacao === '');
    itens = editar(itens, semObs.id, { quantidade: 2, observacao: 'SEM CEBOLA' });
    assert.equal(itens.length, 1);
    assert.equal(itens[0].quantidade, 3);
  });

  test('remover tira só a linha indicada', () => {
    let itens = adicionar([], XBACON, 1);
    itens = adicionar(itens, COCA, 1);
    itens = remover(itens, itens[0].id);
    assert.deepEqual(itens.map((i) => i.nome), ['Coca-Cola 1L']);
  });
});

describe('conciliar com o cardápio atualizado', () => {
  const cardapio = (...produtos) => [{ id: 1, nome: 'Tudo', produtos }];

  test('produto que sumiu do cardápio sai do carrinho e é avisado', () => {
    let itens = adicionar([], XBACON, 1, 'sem cebola');
    itens = adicionar(itens, XBACON, 1);
    itens = adicionar(itens, COCA, 1);
    const r = conciliar(itens, cardapio(COCA));
    assert.equal(r.mudou, true);
    assert.deepEqual(r.itens.map((i) => i.nome), ['Coca-Cola 1L']);
    assert.deepEqual(r.removidos, ['X-Bacon'], 'nome aparece uma vez só');
    assert.deepEqual(mensagensDaConciliacao(r), [
      'X-Bacon saiu do cardápio e foi removido da sua sacola.',
    ]);
  });

  test('vários removidos viram uma frase só', () => {
    const itens = adicionar(adicionar([], XBACON, 1), COCA, 1);
    const r = conciliar(itens, cardapio());
    assert.deepEqual(mensagensDaConciliacao(r), [
      'X-Bacon e Coca-Cola 1L saíram do cardápio e foram removidos da sua sacola.',
    ]);
  });

  test('preço alterado é atualizado no carrinho e avisado', () => {
    const itens = adicionar([], XBACON, 2);
    const r = conciliar(itens, cardapio({ ...XBACON, precoCentavos: 1700 }));
    assert.equal(r.itens[0].precoCentavos, 1700);
    assert.deepEqual(r.precosAlterados, [{ nome: 'X-Bacon', de: 1600, para: 1700 }]);
    const [msg] = mensagensDaConciliacao(r);
    assert.match(msg, /^O preço de X-Bacon mudou de R\$\s16,00 para R\$\s17,00\.$/);
  });

  test('sem mudança devolve o mesmo array (não dispara re-render nem aviso)', () => {
    const itens = adicionar([], XBACON, 1);
    const r = conciliar(itens, cardapio(XBACON, COCA));
    assert.equal(r.mudou, false);
    assert.equal(r.itens, itens);
    assert.deepEqual(mensagensDaConciliacao(r), []);
  });
});

describe('persistência no AsyncStorage', () => {
  test('salva e carrega o mesmo carrinho', async () => {
    const storage = storageFalso();
    const itens = adicionar(adicionar([], XBACON, 2, 'sem cebola'), COCA, 1);
    assert.equal(await salvarCarrinho(itens, storage), true);
    assert.deepEqual(await carregarCarrinho(storage), itens);
  });

  test('JSON corrompido ou formato errado vira carrinho vazio', async () => {
    assert.deepEqual(await carregarCarrinho(storageFalso({ [CHAVE_STORAGE]: '{quebrado' })), []);
    assert.deepEqual(await carregarCarrinho(storageFalso({ [CHAVE_STORAGE]: '{"a":1}' })), []);
    assert.deepEqual(await carregarCarrinho(storageFalso()), []);
  });

  test('linhas inválidas são descartadas e as válidas ficam', async () => {
    const salvo = JSON.stringify([
      { produtoId: 6, nome: 'X-Bacon', precoCentavos: 1600, quantidade: 2, observacao: 'sem cebola' },
      { produtoId: 'x', nome: 'Hack', precoCentavos: 1 },
      { produtoId: 7, nome: 'Sem preço' },
      null,
    ]);
    const itens = await carregarCarrinho(storageFalso({ [CHAVE_STORAGE]: salvo }));
    assert.deepEqual(itens.map((i) => [i.nome, i.quantidade]), [['X-Bacon', 2]]);
  });

  test('storage que lança erro ou rejeita (disco cheio) não quebra', async () => {
    const quebrado = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    assert.deepEqual(await carregarCarrinho(quebrado), []);
    assert.equal(await salvarCarrinho(adicionar([], XBACON), quebrado), false);
    const rejeita = { getItem: async () => { throw new Error('io'); }, setItem: async () => { throw new Error('io'); } };
    assert.deepEqual(await carregarCarrinho(rejeita), []);
    assert.equal(await salvarCarrinho(adicionar([], XBACON), rejeita), false);
  });

  test('com o formato do AsyncStorage (Promise) e sem storage nenhum', async () => {
    const dados = new Map();
    const assincrono = { getItem: async (k) => dados.get(k) ?? null, setItem: async (k, v) => void dados.set(k, v) };
    const itens = adicionar([], COCA, 3);
    assert.equal(await salvarCarrinho(itens, assincrono), true);
    assert.deepEqual(await carregarCarrinho(assincrono), itens);
    assert.deepEqual(await carregarCarrinho(null), []);
    assert.equal(await salvarCarrinho(itens, null), false);
  });
});
