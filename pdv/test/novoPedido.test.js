import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  adicionarQuantidade,
  avaliarAgendamento,
  buscarProdutos,
  clienteParaForm,
  dataHoraLocal,
  definirQuantidade,
  enderecoParaEnvio,
  enderecoParaForm,
  ENDERECO_VAZIO,
  etapasDoPedido,
  lerQuantidade,
  planoDeGravacao,
  sugestaoDeHorario,
  totaisDoPedido,
  validarCliente,
  manterPedidoAoVoltar,
} from '../src/renderer/src/lib/novoPedido.js';
import { diaOperacional } from '../src/renderer/src/lib/caixa.js';

const bairros = [
  { id: 1, nome: 'Centro', taxaCentavos: 500, ativo: true },
  { id: 2, nome: 'Longe', taxaCentavos: 900, ativo: false },
];

const cliente = {
  id: 7,
  nome: 'Lilian',
  telefone: '43999990001',
  email: null,
  observacao: null,
  enderecos: [
    { id: 70, rua: 'Rua A', numero: '10', complemento: null, referencia: null, cep: null, cidade: null, estado: null, bairro: bairros[0] },
  ],
};

describe('novo pedido', () => {
  test('etapas: a encomenda agenda na etapa do cliente (sem etapa própria)', () => {
    assert.deepEqual(etapasDoPedido('delivery'), ['tipo', 'cliente', 'produtos']);
    assert.deepEqual(etapasDoPedido('encomenda'), ['tipo', 'cliente', 'produtos']);
  });

  test('voltou para o tipo: menos de 5 s mantém o pedido; 5 s ou mais começa do zero', () => {
    assert.equal(manterPedidoAoVoltar(null, 99_999), true);
    assert.equal(manterPedidoAoVoltar(10_000, 14_999), true);
    assert.equal(manterPedidoAoVoltar(10_000, 15_000), false);
    assert.equal(manterPedidoAoVoltar(10_000, 60_000), false);
  });

  test('validação do cliente: nome, telefone, e-mail e endereço (retirada dispensa endereço)', () => {
    const vazio = validarCliente(clienteParaForm(null), ENDERECO_VAZIO, { bairros });
    assert.deepEqual(Object.keys(vazio).sort(), ['bairroId', 'nome', 'numero', 'rua', 'telefone']);
    const retirada = validarCliente({ nome: 'A', telefone: '(43) 99999-0001', email: '', observacao: '' }, ENDERECO_VAZIO, {
      retirarNoBalcao: true,
      bairros,
    });
    assert.deepEqual(retirada, {});
    const ruins = validarCliente(
      { nome: 'A', telefone: '43999990001', email: 'sem-arroba' },
      { ...ENDERECO_VAZIO, rua: 'R', numero: '1', bairroId: '2', cep: '123' },
      { bairros },
    );
    assert.deepEqual(Object.keys(ruins).sort(), ['bairroId', 'cep', 'email']);
    assert.equal(ruins.bairroId, 'Não entregamos mais neste bairro');
  });

  test('formulário ↔ cadastro: padrões de cidade/estado e envio com bairro numérico', () => {
    const f = enderecoParaForm(cliente.enderecos[0]);
    assert.equal(f.cidade, 'Abatiá');
    assert.equal(f.estado, 'Paraná');
    assert.equal(f.bairroId, '1');
    assert.deepEqual(enderecoParaEnvio({ ...f, cep: '86460-000' }), {
      rua: 'Rua A', numero: '10', bairroId: 1, complemento: '', referencia: '', cep: '86460000', cidade: 'Abatiá', estado: 'Paraná',
    });
  });

  test('plano de gravação: cria, atualiza só o que mudou, endereço novo ou editado', () => {
    const form = clienteParaForm(cliente);
    const end = enderecoParaForm(cliente.enderecos[0]);
    assert.deepEqual(planoDeGravacao({ cliente: null, form, endereco: end, enderecoId: null, retirarNoBalcao: false }),
      [{ tipo: 'criar', comEndereco: true }]);
    // Telefone com formatação diferente não conta como mudança.
    assert.deepEqual(
      planoDeGravacao({ cliente, form: { ...form, telefone: '(43) 99999-0001' }, endereco: end, enderecoId: 70, retirarNoBalcao: false }),
      [],
    );
    assert.deepEqual(
      planoDeGravacao({ cliente, form: { ...form, observacao: 'portão azul' }, endereco: { ...end, numero: '12' }, enderecoId: 70, retirarNoBalcao: false }),
      [{ tipo: 'atualizarCliente' }, { tipo: 'atualizarEndereco', enderecoId: 70 }],
    );
    assert.deepEqual(planoDeGravacao({ cliente, form, endereco: ENDERECO_VAZIO, enderecoId: null, retirarNoBalcao: false }),
      [{ tipo: 'adicionarEndereco' }]);
    assert.deepEqual(planoDeGravacao({ cliente, form, endereco: ENDERECO_VAZIO, enderecoId: null, retirarNoBalcao: true }), []);
  });

  test('agendamento: futuro e no mesmo dia operacional (virada às 4h)', () => {
    const agora = new Date('2026-11-14T23:00:00Z'); // sábado 20:00 em Brasília
    const dia = (i) => diaOperacional(i, 4);
    assert.equal(avaliarAgendamento('2026-11-14', '22:30', agora, dia).erro, null);
    assert.equal(avaliarAgendamento('2026-11-14', '22:30', agora, dia).instante.toISOString(), '2026-11-15T01:30:00.000Z');
    assert.equal(avaliarAgendamento('2026-11-15', '01:00', agora, dia).erro, null, 'depois da meia-noite ainda é hoje');
    assert.match(avaliarAgendamento('2026-11-15', '05:00', agora, dia).erro, /expediente de hoje/);
    assert.match(avaliarAgendamento('2026-11-14', '19:00', agora, dia).erro, /já passou/);
    assert.match(avaliarAgendamento('', '19:00', agora, dia).erro, /Informe/);
  });

  test('horário local e sugestão (próximos 15 min depois de 1 h)', () => {
    assert.deepEqual(dataHoraLocal('2026-11-15T01:30:00Z'), { data: '2026-11-14', hora: '22:30' });
    assert.deepEqual(sugestaoDeHorario(new Date('2026-11-14T23:07:00Z')), { data: '2026-11-14', hora: '21:15' });
  });

  test('busca de produto: código exato primeiro, nome sem acento, até 10', () => {
    const categorias = [
      { nome: 'Lanches', produtos: [{ id: 12, nome: 'X-Bacon' }, { id: 1, nome: 'Misto Quente' }, { id: 120, nome: 'Pão de Queijo' }] },
      { nome: 'Bebidas', produtos: [{ id: 30, nome: 'Água' }] },
    ];
    assert.deepEqual(buscarProdutos(categorias, '12').map((p) => p.id), [12, 120]);
    assert.deepEqual(buscarProdutos(categorias, 'agua').map((p) => p.id), [30]);
    assert.deepEqual(buscarProdutos(categorias, 'ao').map((p) => p.id), [120]);
    assert.equal(buscarProdutos(categorias, 'bacon')[0].categoria, 'Lanches');
    assert.deepEqual(buscarProdutos(categorias, ''), []);
  });

  test('quantidade: inteiro de 1 a 20; adicionar respeita o saldo', () => {
    assert.deepEqual(lerQuantidade('2,00'), { quantidade: 2, erro: null });
    assert.equal(lerQuantidade('1,5').erro, 'Use um número inteiro');
    assert.equal(lerQuantidade('0').erro, 'De 1 a 20');
    const produto = { id: 5, nome: 'Coca', precoCentavos: 600, esgotado: false, saldo: 3, disponivelHoje: true };
    const r = adicionarQuantidade([], produto, 5);
    assert.equal(r.adicionadas, 3);
    assert.equal(r.linhas[0].quantidade, 3);
    const chave = r.linhas[0].chave;
    assert.equal(definirQuantidade(r.linhas, chave, 10, produto)[0].quantidade, 3);
    assert.equal(definirQuantidade(r.linhas, chave, 1, produto)[0].quantidade, 1);
    assert.deepEqual(definirQuantidade(r.linhas, chave, 0, produto), []);
  });

  test('totais: frete grátis, taxa digitada, retirada sem taxa e desconto limitado ao subtotal', () => {
    const linhas = [{ chave: 'a', produtoId: 1, nome: 'X', precoCentavos: 1500, quantidade: 2, observacao: '' }];
    assert.deepEqual(totaisDoPedido(linhas, { taxaBairroCentavos: 500 }), {
      subtotalCentavos: 3000, taxaEntregaCentavos: 500, descontoCentavos: 0, totalCentavos: 3500,
    });
    assert.equal(totaisDoPedido(linhas, { taxaBairroCentavos: 500, freteGratis: { minimoCentavos: 3000 } }).taxaEntregaCentavos, 0);
    assert.equal(totaisDoPedido(linhas, { taxaBairroCentavos: 500, taxaManualCentavos: 800 }).totalCentavos, 3800);
    assert.equal(totaisDoPedido(linhas, { taxaBairroCentavos: 500, taxaManualCentavos: 800, retirarNoBalcao: true }).totalCentavos, 3000);
    assert.equal(totaisDoPedido(linhas, { descontoCentavos: 9999 }).totalCentavos, 0);
  });
});
