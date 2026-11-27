import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';

/**
 * Migrations do pagamento online (etapa 2): padrões que não mudam nada do que existe,
 * CHECKs (inclusive com um NULL, que já passou despercebido no lote do mapa) e o
 * livro-razão só de inserção.
 */
describe('pagamento online: regras no banco', { skip: semBancoDeTeste }, () => {
  let prisma;
  let lojaId;
  let n = 0;

  const violaCheck = async (promessa, nome) => {
    await assert.rejects(promessa, (err) => {
      const texto = String(err?.message ?? err);
      assert.ok(texto.includes(nome) || texto.includes('check_violation') || texto.includes('23514'), texto);
      return true;
    });
  };

  const novoPedido = (dados = {}) =>
    prisma.pedido.create({
      data: { lojaId, numeroDia: ++n, dataRef: new Date('2026-11-26T00:00:00Z'), canal: 'SITE', nomeCliente: 'Teste', ...dados },
    });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    ({ id: lojaId } = await prisma.loja.findUniqueOrThrow({ where: { slug: 'cabana-boemia' } }));
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  test('loja nasce com motoboy próprio e pagamento online desligado; pedido sem frete grátis', async () => {
    const loja = await prisma.loja.findUniqueOrThrow({ where: { id: lojaId } });
    assert.equal(loja.modoEntrega, 'PROPRIO');
    assert.equal(loja.pagamentoOnlineAtivo, false);
    const p = await novoPedido();
    assert.equal(p.origemFreteGratis, 'NENHUM');
    assert.equal(p.origemTaxaEntrega, null);
    assert.equal(p.valorEntregadorCentavos, null);
  });

  test('número do dia só pode faltar aguardando pagamento ou expirado', async () => {
    await violaCheck(novoPedido({ numeroDia: null, status: 'CONFIRMADO' }), 'Pedido_numero_dia_check');
    const aguardando = await novoPedido({ numeroDia: null, status: 'AGUARDANDO_PAGAMENTO' });
    assert.equal(aguardando.numeroDia, null);
    await novoPedido({ numeroDia: null, status: 'EXPIRADO' });
    // Dois pedidos sem número no mesmo dia não colidem no único [lojaId, dataRef, numeroDia].
    await novoPedido({ numeroDia: null, status: 'AGUARDANDO_PAGAMENTO' });
    await violaCheck(
      prisma.pedido.update({ where: { id: aguardando.id }, data: { status: 'CONFIRMADO' } }),
      'Pedido_numero_dia_check',
    );
  });

  test('entregador da plataforma: origem da taxa e divisão juntas e não negativas', async () => {
    await violaCheck(novoPedido({ valorEntregadorCentavos: 380 }), 'Pedido_entrega_plataforma_check');
    await violaCheck(
      novoPedido({ origemTaxaEntrega: 'KM', valorEntregadorCentavos: 380, valorPlataformaEntregaCentavos: null }),
      'Pedido_entrega_plataforma_check',
    );
    await violaCheck(
      novoPedido({ origemTaxaEntrega: 'KM', valorEntregadorCentavos: -1, valorPlataformaEntregaCentavos: 20 }),
      'Pedido_entrega_plataforma_check',
    );
    const ok = await novoPedido({ origemTaxaEntrega: 'AREA', valorEntregadorCentavos: 380, valorPlataformaEntregaCentavos: 20 });
    assert.equal(ok.origemTaxaEntrega, 'AREA');
  });

  test('conexão CONECTADA exige o token; desconectada pode ficar sem', async () => {
    await violaCheck(
      prisma.conexaoMercadoPago.create({ data: { lojaId, mpUserId: '123' } }),
      'ConexaoMercadoPago_token_check',
    );
    const c = await prisma.conexaoMercadoPago.create({ data: { lojaId, mpUserId: '123', status: 'DESCONECTADA' } });
    await prisma.conexaoMercadoPago.update({ where: { id: c.id }, data: { status: 'CONECTADA', accessTokenCifrado: 'v1.x.y.z' } });
  });

  test('pagamento: total positivo, comissão e reembolso entre 0 e o total', async () => {
    const pedido = await novoPedido();
    const base = { pedidoId: pedido.id, metodo: 'PIX', expiraEm: new Date() };
    let k = 0;
    const criar = (dados) => prisma.pagamento.create({ data: { ...base, idempotencyKey: `k-${++k}`, ...dados } });
    await violaCheck(criar({ valorTotalCentavos: 0 }), 'Pagamento_valores_check');
    await violaCheck(criar({ valorTotalCentavos: 1000, valorPlataformaCentavos: 1001 }), 'Pagamento_valores_check');
    await violaCheck(criar({ valorTotalCentavos: 1000, valorPlataformaCentavos: -1 }), 'Pagamento_valores_check');
    await violaCheck(criar({ valorTotalCentavos: 1000, valorReembolsadoCentavos: 1001 }), 'Pagamento_valores_check');
    const ok = await criar({ valorTotalCentavos: 1000, valorPlataformaCentavos: 400 });
    assert.equal(ok.status, 'PENDENTE');
  });

  test('campanha: um por telefone (hash), hash com 64 hexadecimais, data de uso só no USADO', async () => {
    const [a, b] = [await novoPedido(), await novoPedido()];
    const H = 'ab'.repeat(32);
    await violaCheck(
      prisma.usoCampanhaFreteGratis.create({ data: { telefoneHash: '43999990001', pedidoId: a.id } }),
      'UsoCampanhaFreteGratis_check',
    );
    await violaCheck(
      prisma.usoCampanhaFreteGratis.create({ data: { telefoneHash: H, pedidoId: a.id, situacao: 'USADO' } }),
      'UsoCampanhaFreteGratis_check',
    );
    await prisma.usoCampanhaFreteGratis.create({ data: { telefoneHash: H, pedidoId: a.id } });
    await assert.rejects(prisma.usoCampanhaFreteGratis.create({ data: { telefoneHash: H, pedidoId: b.id } }), {
      code: 'P2002',
    });
  });

  test('livro-razão: valor nunca zero; não se apaga nem se altera (só ganha o fechamento)', async () => {
    await violaCheck(
      prisma.lancamentoLoja.create({ data: { lojaId, tipo: 'AJUSTE_MANUAL', valorCentavos: 0 } }),
      'LancamentoLoja_valor_check',
    );
    // Etapa 6: lançamento automático sempre com o pedido; ajuste manual sempre com a observação.
    await violaCheck(
      prisma.lancamentoLoja.create({ data: { lojaId, tipo: 'TAXA_ENTREGA_DINHEIRO', valorCentavos: 500 } }),
      'LancamentoLoja_tipo_check',
    );
    const l = await prisma.lancamentoLoja.create({ data: { lojaId, tipo: 'AJUSTE_MANUAL', valorCentavos: 500, observacao: 'teste' } });
    await assert.rejects(prisma.lancamentoLoja.update({ where: { id: l.id }, data: { valorCentavos: 400 } }), /não pode ser alterado/);
    await assert.rejects(prisma.lancamentoLoja.delete({ where: { id: l.id } }), /não pode ser apagado/);

    const f = await prisma.fechamentoSemanal.create({
      data: { lojaId, inicio: new Date('2026-11-23T00:00:00Z'), fim: new Date('2026-11-30T00:00:00Z') },
    });
    await prisma.lancamentoLoja.update({ where: { id: l.id }, data: { fechamentoId: f.id } });
    await assert.rejects(prisma.lancamentoLoja.update({ where: { id: l.id }, data: { fechamentoId: null } }), /não pode ser alterado/);
  });

  test('fechamento: fim depois do início; QUITADO com a data e só com ela', async () => {
    const criar = (dados) => prisma.fechamentoSemanal.create({ data: { lojaId, ...dados } });
    await violaCheck(
      criar({ inicio: new Date('2026-12-07T00:00:00Z'), fim: new Date('2026-12-07T00:00:00Z') }),
      'FechamentoSemanal_check',
    );
    await violaCheck(
      criar({ inicio: new Date('2026-12-07T00:00:00Z'), fim: new Date('2026-12-14T00:00:00Z'), status: 'QUITADO' }),
      'FechamentoSemanal_check',
    );
    await violaCheck(
      criar({ inicio: new Date('2026-12-07T00:00:00Z'), fim: new Date('2026-12-14T00:00:00Z'), quitadoEm: new Date() }),
      'FechamentoSemanal_check',
    );
    const ok = await criar({
      inicio: new Date('2026-12-07T00:00:00Z'),
      fim: new Date('2026-12-14T00:00:00Z'),
      status: 'QUITADO',
      quitadoEm: new Date(),
      observacao: 'Pix recebido',
    });
    assert.equal(ok.status, 'QUITADO');
  });
});
