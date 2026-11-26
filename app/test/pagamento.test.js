import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIX_ONLINE,
  MENSAGEM_FALHA_PIX,
  apagarPixPendente,
  emailValido,
  estadoDoPix,
  interpretarErroDoPix,
  lerPixPendente,
  opcoesDePagamento,
  pixGuardadoValido,
  pixParaGuardar,
  salvarPixPendente,
  tempoRestante,
} from '../src/logica/pagamento.js';
import { corpoDoPedido } from '../src/logica/pedido.js';

function storageFalso() {
  const m = new Map();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

describe('pagamento pelo app (Pix)', () => {
  test('opções: Pix pelo app primeiro quando a loja aceita; loja da plataforma só dinheiro na entrega', () => {
    assert.deepEqual(
      opcoesDePagamento({ naEntrega: ['DINHEIRO'], online: ['PIX'] }).map((o) => o.valor),
      [PIX_ONLINE, 'DINHEIRO'],
    );
    assert.deepEqual(
      opcoesDePagamento({ naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'], online: [] }).map((o) => o.valor),
      ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'],
    );
    // Sem prévia da API: as quatro formas na entrega, como antes (nada de Pix pelo app).
    assert.deepEqual(opcoesDePagamento(null).map((o) => o.valor), ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']);
    // Cartão online (Etapa 7) ainda não aparece.
    assert.deepEqual(opcoesDePagamento({ naEntrega: [], online: ['PIX', 'CARTAO_ONLINE'] }).map((o) => o.valor), [PIX_ONLINE]);
  });

  test('contagem regressiva: mm:ss, nunca negativa', () => {
    const agora = Date.parse('2026-11-14T20:00:00Z');
    assert.deepEqual(tempoRestante('2026-11-14T20:15:00Z', agora), { segundos: 900, texto: '15:00', acabou: false });
    assert.equal(tempoRestante('2026-11-14T20:00:09.200Z', agora).texto, '00:10');
    assert.deepEqual(tempoRestante('2026-11-14T19:59:00Z', agora), { segundos: 0, texto: '00:00', acabou: true });
    assert.equal(tempoRestante('lixo', agora).acabou, true);
  });

  test('estado: pendente aguarda, aprovado segue, A_ESTORNAR é "pago tarde", o resto expirou', () => {
    assert.equal(estadoDoPix({ status: 'PENDENTE' }), 'aguardando');
    assert.equal(estadoDoPix({ status: 'APROVADO' }), 'aprovado');
    assert.equal(estadoDoPix({ status: 'A_ESTORNAR' }), 'pago_tarde');
    for (const s of ['EXPIRADO', 'CANCELADO', 'RECUSADO']) assert.equal(estadoDoPix({ status: s }), 'expirado');
    assert.equal(estadoDoPix(null), 'expirado');
  });

  test('Pix pendente guardado no aparelho: grava, lê, apaga; velho demais ou corrompido = nada', async () => {
    const storage = storageFalso();
    const dados = pixParaGuardar(
      {
        pedido: { id: 7, totalCentavos: 2500 },
        pagamento: { qrCode: '000201', qrCodeBase64: 'iVBOR', expiraEm: '2026-11-14T20:15:00Z', valorCentavos: 2500 },
      },
      { slug: 'cabana-boemia', nome: 'Cabana Boemia' },
    );
    assert.equal(await salvarPixPendente(dados, storage), true);
    const lido = await lerPixPendente(storage, Date.parse('2026-11-14T20:20:00Z'));
    assert.equal(lido.pedidoId, 7);
    assert.equal(lido.loja.nome, 'Cabana Boemia');
    assert.equal(await lerPixPendente(storage, Date.parse('2026-11-16T20:20:00Z')), null, 'mais de 24 h depois do prazo');
    await apagarPixPendente(storage);
    assert.equal(await lerPixPendente(storage), null);
    await storage.setItem('delivery-abatia:pix-pendente:v1', '{lixo');
    assert.equal(await lerPixPendente(storage), null);
    assert.equal(pixGuardadoValido({ pedidoId: '7', qrCode: 'x', expiraEm: '2026-11-14T20:15:00Z' }), null);
  });

  test('erros do Pix: falha e expirado pedem chave nova; e-mail; loja sem online; outros = checkout de sempre', () => {
    assert.deepEqual(interpretarErroDoPix({ codigo: 'PAGAMENTO_FALHOU', message: 'x' }), { acao: 'novaChave', mensagem: MENSAGEM_FALHA_PIX });
    assert.equal(
      MENSAGEM_FALHA_PIX,
      'Não foi possível gerar o Pix agora. Tente de novo ou escolha outra forma de pagamento.',
    );
    assert.equal(interpretarErroDoPix({ codigo: 'PIX_EXPIRADO' }).acao, 'novaChave');
    assert.equal(interpretarErroDoPix({ codigo: 'EMAIL_OBRIGATORIO' }).acao, 'email');
    assert.deepEqual(interpretarErroDoPix({ codigo: 'PAGAMENTO_ONLINE_INDISPONIVEL', message: 'A loja não…' }), {
      acao: 'formas',
      mensagem: 'A loja não…',
    });
    assert.equal(interpretarErroDoPix({ codigo: 'PRECO_ALTERADO' }), null);
  });

  test('e-mail: formato simples (a API confere de novo)', () => {
    assert.equal(emailValido('ana@exemplo.com'), true);
    assert.equal(emailValido(' ana@exemplo.com.br '), true);
    for (const e of ['', 'ana', 'ana@', 'ana@x', 'a b@x.com']) assert.equal(emailValido(e), false, e);
  });

  test('corpo do pedido: sempre origem APP; Pix pelo app vai sem forma e sem troco', () => {
    const itens = [{ produtoId: 1, quantidade: 2, observacao: '' }];
    const naEntrega = corpoDoPedido(itens, { enderecoId: 3, formaPagamento: 'DINHEIRO', trocoParaCentavos: 5000, totalEsperadoCentavos: 3000, lojaSlug: 'x' });
    assert.equal(naEntrega.origem, 'APP');
    assert.equal(naEntrega.formaPagamento, 'DINHEIRO');
    assert.equal(naEntrega.trocoParaCentavos, 5000);
    const pix = corpoDoPedido(itens, { enderecoId: 3, formaPagamento: PIX_ONLINE, totalEsperadoCentavos: 3000 });
    assert.equal(pix.pagamentoOnline, 'PIX');
    assert.equal('formaPagamento' in pix, false);
    assert.equal('trocoParaCentavos' in pix, false);
  });
});

describe('pago online: e-mail recusado, cancelar antes do aceite e estorno (Etapa 5)', async () => {
  const m = await import('../src/logica/pagamento.js');
  const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  const pedido = (extra = {}, pagamento = {}) => ({
    status: 'CONFIRMADO',
    podeCancelar: false,
    pagamentoOnline: { meio: 'PIX', situacao: 'PAGO', valorEstornadoCentavos: 0, ...pagamento },
    ...extra,
  });

  test('e-mail recusado pelo Mercado Pago: mensagem própria, volta ao e-mail e chave nova; os outros erros, a genérica', () => {
    assert.deepEqual(m.interpretarErroDoPix({ codigo: 'EMAIL_RECUSADO_PAGAMENTO' }), {
      acao: 'email',
      novaChave: true,
      mensagem: 'O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo.',
    });
    assert.equal(m.interpretarErroDoPix({ codigo: 'PAGAMENTO_FALHOU' }).mensagem, m.MENSAGEM_FALHA_PIX);
    assert.notEqual(m.interpretarErroDoPix({ codigo: 'PAGAMENTO_FALHOU' }).acao, 'email');
  });

  test('aviso do pedido: aguardando aceite; recusado e estornado (Pix na conta, cartão na fatura); pendente', () => {
    assert.equal(m.avisoDoPedidoOnline(pedido({ podeCancelar: true })).texto, 'Pago. Aguardando a loja aceitar.');
    assert.equal(m.avisoDoPedidoOnline(pedido()), null, 'aceito: nada a dizer');
    assert.equal(
      m.avisoDoPedidoOnline(pedido({ status: 'CANCELADO' }, { situacao: 'ESTORNADO' })).texto,
      'Pedido cancelado e estornado. O valor do Pix volta para a sua conta.',
    );
    assert.equal(
      m.avisoDoPedidoOnline(pedido({ status: 'CANCELADO' }, { meio: 'CARTAO_ONLINE', situacao: 'ESTORNADO' })).texto,
      'Pedido cancelado e estornado. O valor volta na fatura do cartão.',
    );
    assert.match(m.avisoDoPedidoOnline(pedido({ status: 'CANCELADO' }, { situacao: 'ESTORNO_PENDENTE' })).texto, /devolução do valor está em andamento/);
    assert.equal(
      m.avisoDoPedidoOnline(pedido({ status: 'FINALIZADO' }, { situacao: 'ESTORNADO_PARCIAL', valorEstornadoCentavos: 500 }), reais).texto,
      'R$ 5,00 foram estornados. O valor do Pix volta para a sua conta.',
    );
    assert.equal(m.avisoDoPedidoOnline({ status: 'CANCELADO', pagamentoOnline: null }), null, 'pago na entrega');
  });

  test('erros do cancelar: aceito no meio, encerrado, outros', () => {
    assert.match(m.mensagemDoCancelamento({ codigo: 'PEDIDO_JA_ACEITO' }), /já aceitou/);
    assert.equal(m.mensagemDoCancelamento({ codigo: 'PEDIDO_ENCERRADO' }), 'Este pedido já foi encerrado.');
    assert.match(m.mensagemDoCancelamento(new TypeError('Network')), /Network|conexão/);
  });
});
