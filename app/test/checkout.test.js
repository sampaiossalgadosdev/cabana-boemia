import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoEndereco,
  enderecoInicial,
  errosPorCampo,
  validarEndereco,
  trocoDoCheckout,
  interpretarErroDoEnvio,
  ERRO_GENERICO_ENVIO,
} from '../src/logica/checkout.js';
import { repetirComSaldo, avisosDaRepeticaoComSaldo } from '../src/logica/cardapio.js';
import { adicionar } from '../src/logica/carrinho.js';

const XBACON = { id: 6, nome: 'X-Bacon', precoCentavos: 1600, maxSacola: 3 };
const COCA = { id: 23, nome: 'Coca-Cola 1L', precoCentavos: 900, maxSacola: 20 };
const centro = { id: 1, nome: 'Centro', taxaCentavos: 500, ativo: true };
const sitio = { id: 2, nome: 'Sítio', taxaCentavos: 1500, ativo: false };

class ErroApiFalso extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    Object.assign(this, { status, codigo, detalhes });
  }
}

test('textoEndereco com e sem complemento', () => {
  assert.equal(textoEndereco({ rua: 'Rua A', numero: '10' }), 'Rua A, 10');
  assert.equal(textoEndereco({ rua: 'Rua A', numero: '10', complemento: 'Casa 2' }), 'Rua A, 10 - Casa 2');
});

test('enderecoInicial: principal ativo; senão o primeiro ativo; nenhum ativo = null', () => {
  const a = { id: 1, principal: false, bairro: centro };
  const b = { id: 2, principal: true, bairro: centro };
  const c = { id: 3, principal: true, bairro: sitio };
  assert.equal(enderecoInicial([a, b]).id, 2);
  assert.equal(enderecoInicial([c, a]).id, 1, 'principal num bairro desativado não vale');
  assert.equal(enderecoInicial([c]), null);
  assert.equal(enderecoInicial([]), null);
});

test('validarEndereco e errosPorCampo (detalhes da API ou mensagem geral)', () => {
  assert.deepEqual(validarEndereco({ rua: ' ', numero: '', bairroId: null }), {
    rua: 'Informe a rua',
    numero: 'Informe o número',
    bairroId: 'Escolha o bairro',
  });
  assert.deepEqual(validarEndereco({ rua: 'A', numero: '1', bairroId: 3 }), {});
  assert.deepEqual(errosPorCampo(new ErroApiFalso(400, 'VALIDACAO', 'x', [{ campo: 'telefone', mensagem: 'Celular inválido' }])), {
    telefone: 'Celular inválido',
  });
  assert.deepEqual(errosPorCampo(new ErroApiFalso(422, 'BAIRRO_INVALIDO', 'Bairro inválido')), { geral: 'Bairro inválido' });
  assert.match(errosPorCampo(new TypeError('Network request failed')).geral, /conexão/);
});

test('troco: só em dinheiro com "Preciso de troco"; valor maior que o total', () => {
  const base = { forma: 'DINHEIRO', precisaTroco: true, totalCentavos: 4600 };
  assert.deepEqual(trocoDoCheckout({ ...base, forma: 'PIX', texto: '50' }), { trocoParaCentavos: null, erro: null });
  assert.deepEqual(trocoDoCheckout({ ...base, precisaTroco: false, texto: '50' }), { trocoParaCentavos: null, erro: null });
  assert.deepEqual(trocoDoCheckout({ ...base, texto: '' }), { trocoParaCentavos: null, erro: 'Informe o valor, ex.: 100' });
  assert.match(trocoDoCheckout({ ...base, texto: '40' }).erro, /maior que o total/);
  assert.deepEqual(trocoDoCheckout({ ...base, texto: '100' }), { trocoParaCentavos: 10000, erro: null });
});

test('erro do envio: 401 sai; rede = genérico; API = a mensagem dela', () => {
  const ctx = { itens: [], taxaBairroCentavos: 500, taxaEntregaCentavos: 500 };
  assert.deepEqual(interpretarErroDoEnvio(new ErroApiFalso(401, 'TOKEN_EXPIRADO', 'x'), ctx), { acao: 'sair' });
  assert.deepEqual(interpretarErroDoEnvio(new TypeError('Network request failed'), ctx), { acao: 'mensagem', mensagem: ERRO_GENERICO_ENVIO });
  assert.deepEqual(interpretarErroDoEnvio(new ErroApiFalso(400, 'TROCO_INVALIDO', 'Troco inválido'), ctx), {
    acao: 'mensagem',
    mensagem: 'Troco inválido',
  });
});

test('erro do envio: estoque, produto ou loja = recarregar o cardápio', () => {
  const ctx = { itens: [], taxaBairroCentavos: 500, taxaEntregaCentavos: 500 };
  for (const codigo of ['ESTOQUE_INSUFICIENTE', 'PRODUTO_INDISPONIVEL', 'LOJA_FECHADA']) {
    assert.deepEqual(interpretarErroDoEnvio(new ErroApiFalso(409, codigo, `msg ${codigo}`), ctx), { acao: 'cardapio', mensagem: `msg ${codigo}` });
  }
});

test('erro do envio: PRECO_ALTERADO aplica preços, taxa e frete grátis novos e pede novo toque', () => {
  const itens = adicionar(adicionar([], XBACON, 2), COCA, 1);
  const erro = new ErroApiFalso(409, 'PRECO_ALTERADO', 'Preço mudou', {
    taxaEntregaCentavos: 0,
    taxaBairroCentavos: 600,
    freteGratis: { minimoCentavos: 4000 },
    itens: [
      { produtoId: 6, nome: 'X-Bacon', precoUnitarioCentavos: 1800 },
      { produtoId: 23, nome: 'Coca-Cola 1L', precoUnitarioCentavos: 900 },
    ],
  });
  const r = interpretarErroDoEnvio(erro, { itens, taxaBairroCentavos: 500, taxaEntregaCentavos: 500 });
  assert.equal(r.acao, 'preco');
  assert.equal(r.itens.find((i) => i.produtoId === 6).precoCentavos, 1800);
  assert.equal(r.taxaBairroCentavos, 600);
  assert.deepEqual(r.freteGratis, { valor: { minimoCentavos: 4000 } });
  assert.match(r.mensagem, /O preço de X-Bacon mudou/);
  assert.match(r.mensagem, /ganhou frete grátis/);
  assert.match(r.mensagem, /toque em "Enviar pedido"/);

  // Sem nada que mudou de fato (só a regra): itens null, taxa null, texto padrão
  const s = interpretarErroDoEnvio(new ErroApiFalso(409, 'PRECO_ALTERADO', 'x', { taxaEntregaCentavos: 500, taxaBairroCentavos: 500, itens: [] }), {
    itens,
    taxaBairroCentavos: 500,
    taxaEntregaCentavos: 500,
  });
  assert.equal(s.itens, null);
  assert.equal(s.taxaBairroCentavos, null);
  assert.equal(s.freteGratis, null);
  assert.match(s.mensagem, /^Os preços mudaram\./);
});

test('repetir com saldo: preço de agora, observação mantida, nunca passa do maxSacola', () => {
  const categorias = [{ id: 1, nome: 'Lanches', produtos: [XBACON, COCA] }];
  const pedido = {
    itens: [
      { produtoId: 6, nome: 'X-Bacon', quantidade: 5, observacao: 'sem cebola' },
      { produtoId: 23, nome: 'Coca-Cola 1L', quantidade: 1 },
      { produtoId: 99, nome: 'Pastel', quantidade: 1 },
    ],
  };
  const r = repetirComSaldo(adicionar([], XBACON, 1), pedido, categorias);
  const xbacon = r.itens.filter((i) => i.produtoId === 6).reduce((s, i) => s + i.quantidade, 0);
  assert.equal(xbacon, 3, '1 já na sacola + 2 que cabiam');
  assert.equal(r.itens.find((i) => i.produtoId === 6 && i.observacao === 'sem cebola').quantidade, 2);
  assert.equal(r.adicionados, 3);
  assert.deepEqual(r.indisponiveis, ['Pastel']);
  assert.deepEqual(r.limitados, ['X-Bacon']);
  const { mensagens, abrirSacola } = avisosDaRepeticaoComSaldo(r);
  assert.equal(abrirSacola, true);
  assert.equal(mensagens.length, 3);
  assert.match(mensagens[2], /Entrou só a quantidade disponível de: X-Bacon/);

  const cheio = repetirComSaldo(adicionar([], XBACON, 3), { itens: [{ produtoId: 6, nome: 'X-Bacon', quantidade: 1 }] }, categorias);
  assert.equal(cheio.adicionados, 0);
  assert.deepEqual(cheio.indisponiveis, ['X-Bacon']);
  assert.equal(avisosDaRepeticaoComSaldo(cheio).abrirSacola, false);
});
