import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAVE_SACOLA,
  CHAVE_SACOLA_ANTIGA,
  carregarSacola,
  coresDaLoja,
  enderecoInicialNaLoja,
  filtrarLojas,
  formatarDocumento,
  identificacaoLegal,
  lerLojasSalvas,
  precisaEsvaziar,
  salvarLojas,
  salvarSacola,
  situacaoDaLoja,
  taxaNaLoja,
  urlDaImagem,
} from '../src/logica/lojas.js';
import { chaveCardapioDaLoja, lerCardapioDaLoja, salvarCardapioDaLoja } from '../src/logica/cardapio.js';
import { interpretarErroDoEnvio } from '../src/logica/checkout.js';
import { corpoDoPedido } from '../src/logica/pedido.js';

function storageFalso(inicial = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    getItem: async (k) => dados.get(k) ?? null,
    setItem: async (k, v) => void dados.set(k, v),
    removeItem: async (k) => void dados.delete(k),
  };
}

const LOJAS = [
  { slug: 'cabana-boemia', nome: 'Cabana Boêmia', descricao: 'Lanches e pizzas', aberta: false, proximaAbertura: { em: '2026-11-21T22:00:00Z' } },
  { slug: 'lanchonete-teste', nome: 'Lanchonete Teste', descricao: null, aberta: true },
  { slug: 'acai-do-ze', nome: 'Açaí do Zé', descricao: 'Açaí e sorvete', aberta: false, proximaAbertura: null },
];

test('vitrine: busca sem acento (nome e descrição), abertas primeiro', () => {
  assert.deepEqual(filtrarLojas(LOJAS).map((l) => l.slug), ['lanchonete-teste', 'cabana-boemia', 'acai-do-ze']);
  assert.deepEqual(filtrarLojas(LOJAS, 'boemia').map((l) => l.slug), ['cabana-boemia']);
  assert.deepEqual(filtrarLojas(LOJAS, '  ACAI ').map((l) => l.slug), ['acai-do-ze']);
  assert.deepEqual(filtrarLojas(LOJAS, 'pizza').map((l) => l.slug), ['cabana-boemia']);
  assert.deepEqual(filtrarLojas(LOJAS, 'xyz'), []);
});

test('situação: aberta, fechada com a próxima abertura, fechada sem horário', () => {
  assert.equal(situacaoDaLoja(LOJAS[1]), 'Aberta');
  assert.equal(situacaoDaLoja(LOJAS[0], new Date('2026-11-21T15:00:00Z')), 'Fechada · abre hoje às 19:00');
  assert.equal(situacaoDaLoja(LOJAS[2]), 'Fechada');
});

test('vitrine salva no aparelho; dado corrompido = nada', async () => {
  const s = storageFalso();
  assert.equal(await lerLojasSalvas(s), null);
  await salvarLojas(LOJAS, 500, s);
  assert.deepEqual(await lerLojasSalvas(s), { lojas: LOJAS, salvoEm: 500 });
  s.dados.set('delivery-abatia:lojas:v1', '{"salvoEm":1,"lojas":[{"nome":3}]}');
  assert.equal(await lerLojasSalvas(s), null);
});

test('logo: caminho da API vira endereço absoluto; link https passa; outra coisa = null', () => {
  assert.equal(urlDaImagem('/api/publico/imagens/3', 'https://x.com.br/api'), 'https://x.com.br/api/publico/imagens/3');
  assert.equal(urlDaImagem('https://cdn.x/logo.png', 'https://x.com.br/api'), 'https://cdn.x/logo.png');
  assert.equal(urlDaImagem(null, 'https://x.com.br/api'), null);
  assert.equal(urlDaImagem('data:image/png;base64,AAA', 'https://x.com.br/api'), null);
});

test('identificação legal: razão social, CNPJ/CPF formatado, endereço; o que falta aparece como não informado', () => {
  assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatarDocumento('12345678901'), '123.456.789-01');
  assert.deepEqual(identificacaoLegal({ nome: 'Zé', razaoSocial: 'Zé Lanches LTDA', documento: '11222333000181', endereco: 'Rua A, 1' }), [
    'Razão social: Zé Lanches LTDA',
    'CNPJ: 11.222.333/0001-81',
    'Endereço: Rua A, 1',
  ]);
  assert.deepEqual(identificacaoLegal({ nome: 'Zé', documento: '12345678901' }), ['Razão social: Zé', 'CPF: 123.456.789-01']);
  assert.deepEqual(identificacaoLegal({ nome: 'Zé' }), ['Razão social: Zé', 'CNPJ/CPF: não informado']);
});

test('cores da loja: cor primária nos destaques com o texto da API; cor ilegível = tema base', () => {
  const base = { acao: '#C8102E', cabecalho: '#C8102E', textoAcao: '#FFFFFF', textoInverso: '#FBF3E8', preco: '#9E0B22', fundo: '#FBF3E8' };
  const verde = coresDaLoja({ corPrimaria: '#1E7B3C', corTexto: '#FFFFFF' }, base);
  assert.equal(verde.acao, '#1E7B3C');
  assert.equal(verde.cabecalho, '#1E7B3C');
  assert.equal(verde.textoAcao, '#FFFFFF');
  assert.equal(verde.fundo, '#FBF3E8', 'base neutra continua');
  assert.equal(coresDaLoja({ corPrimaria: '#3B82F6', corTexto: '#111111' }, base).textoInverso, '#111111');
  assert.equal(coresDaLoja({ corPrimaria: '#FFFF00' }, base), base);
  assert.equal(coresDaLoja(null, base), base);
});

test('sacola presa a uma loja: só pede para esvaziar com itens de OUTRA loja', () => {
  const sacola = { loja: { slug: 'cabana-boemia', nome: 'Cabana' }, itens: [{ id: '1:', produtoId: 1, quantidade: 1 }] };
  assert.equal(precisaEsvaziar(sacola, 'lanchonete-teste'), true);
  assert.equal(precisaEsvaziar(sacola, 'cabana-boemia'), false);
  assert.equal(precisaEsvaziar({ loja: null, itens: [] }, 'lanchonete-teste'), false);
});

test('sacola salva com a loja; a sacola antiga (v1) vira da Cabana; vazia = sem loja', async () => {
  const antiga = storageFalso({ [CHAVE_SACOLA_ANTIGA]: JSON.stringify([{ produtoId: 7, nome: 'X-Bacon', precoCentavos: 1600, quantidade: 2 }]) });
  const migrada = await carregarSacola(antiga);
  assert.deepEqual(migrada.loja, { slug: 'cabana-boemia', nome: 'Cabana Boemia' });
  assert.equal(migrada.itens[0].quantidade, 2);

  const s = storageFalso();
  await salvarSacola({ loja: { slug: 'lanchonete-teste', nome: 'Lanchonete Teste', extra: 1 }, itens: migrada.itens }, s);
  assert.deepEqual(JSON.parse(s.dados.get(CHAVE_SACOLA)).loja, { slug: 'lanchonete-teste', nome: 'Lanchonete Teste' });
  assert.equal((await carregarSacola(s)).loja.slug, 'lanchonete-teste');
  await salvarSacola({ loja: { slug: 'x', nome: 'X' }, itens: [] }, s);
  assert.deepEqual(await carregarSacola(s), { loja: null, itens: [] });
  s.dados.set(CHAVE_SACOLA, '{quebrado');
  assert.deepEqual(await carregarSacola(s), { loja: null, itens: [] });
});

test('cardápio salvo por loja (com a configuração dela)', async () => {
  const s = storageFalso();
  const cardapio = { aberto: true, categorias: [{ id: 1, nome: 'Lanches', produtos: [] }] };
  await salvarCardapioDaLoja('lanchonete-teste', { cardapio, config: { nome: 'Lanchonete Teste' } }, 900, s);
  assert.deepEqual(await lerCardapioDaLoja('lanchonete-teste', s), { dados: cardapio, config: { nome: 'Lanchonete Teste' }, salvoEm: 900 });
  assert.equal(await lerCardapioDaLoja('cabana-boemia', s), null, 'cada loja o seu');
  assert.notEqual(chaveCardapioDaLoja('a'), chaveCardapioDaLoja('b'));
});

test('taxa pela área da loja; endereço fora da área não vem escolhido', () => {
  const bairros = [{ id: 1, nome: 'Centro', taxaCentavos: 400 }];
  const enderecos = [
    { id: 10, principal: true, bairro: { id: 2, nome: 'Vila' } },
    { id: 11, principal: false, bairro: { id: 1, nome: 'Centro' } },
  ];
  assert.equal(taxaNaLoja(enderecos[1], bairros), 400);
  assert.equal(taxaNaLoja(enderecos[0], bairros), null);
  assert.equal(enderecoInicialNaLoja(enderecos, bairros).id, 11);
  assert.equal(enderecoInicialNaLoja([enderecos[0]], bairros), null);
});

test('pedido vai com a loja; BAIRRO_FORA_DA_AREA pede para trocar o endereço com a mensagem da API', () => {
  const corpo = corpoDoPedido([{ produtoId: 1, quantidade: 1 }], { enderecoId: 3, formaPagamento: 'PIX', lojaSlug: 'lanchonete-teste' });
  assert.equal(corpo.lojaSlug, 'lanchonete-teste');
  const erro = Object.assign(new Error('Lanchonete Teste não entrega no bairro Vila. Escolha outro endereço.'), {
    status: 422,
    codigo: 'BAIRRO_FORA_DA_AREA',
  });
  assert.deepEqual(interpretarErroDoEnvio(erro, { itens: [] }), { acao: 'endereco', mensagem: erro.message });
});
