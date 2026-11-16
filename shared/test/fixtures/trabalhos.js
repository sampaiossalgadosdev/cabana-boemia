/** Pedidos de exemplo (formato público da API) para os testes do cupom. */
const baseDelivery = {
  id: 501,
  numeroDia: 12,
  canal: 'SITE',
  status: 'CONFIRMADO',
  nomeCliente: 'Maria Aparecida dos Santos Oliveira',
  telefone: '43999990000',
  enderecoTexto: 'Rua Coronel Joaquim Pedro de Oliveira, 1234 - casa dos fundos (Ref.: em frente à praça da matriz)',
  bairroNome: 'Centro',
  subtotalCentavos: 6700,
  taxaEntregaCentavos: 500,
  totalCentavos: 7200,
  formaPagamento: 'DINHEIRO',
  trocoParaCentavos: 10000,
  mesaRotulo: null,
  tempoEstimadoMin: 40,
  criadoEm: '2026-11-14T23:15:00.000Z', // 20:15 em São Paulo
  itens: [
    { id: 1, produtoId: 3, nome: 'X-Bacon', quantidade: 2, pesoGramas: null, precoUnitarioCentavos: 2500,
      totalCentavos: 5000, observacao: 'sem cebola, “bem passado” 🍔' },
    { id: 2, produtoId: 9, nome: 'Porção de batata frita com cheddar e bacon (grande)', quantidade: 1,
      pesoGramas: null, precoUnitarioCentavos: 500, totalCentavos: 500, observacao: null },
    { id: 3, produtoId: 20, nome: 'Coca-Cola 1L', quantidade: 1, pesoGramas: null, precoUnitarioCentavos: 1200,
      totalCentavos: 1200, observacao: null },
  ],
};

export const pedidoSite = { id: 9001, tipo: 'PEDIDO', criadoEm: baseDelivery.criadoEm, pedido: baseDelivery };

export const cancelamentoWhatsapp = {
  id: 9002,
  tipo: 'CANCELAMENTO',
  criadoEm: '2026-11-14T23:40:00.000Z',
  pedido: { ...baseDelivery, canal: 'WHATSAPP', status: 'CANCELADO', formaPagamento: 'PIX', trocoParaCentavos: null },
};

export const contaSalao = {
  id: 9003,
  tipo: 'CONTA',
  criadoEm: '2026-11-15T15:05:00.000Z', // 12:05 em São Paulo
  pedido: {
    id: 502,
    numeroDia: 3,
    canal: 'SALAO',
    status: 'FINALIZADO',
    nomeCliente: 'Carlos',
    telefone: null,
    enderecoTexto: null,
    bairroNome: null,
    subtotalCentavos: 6395,
    taxaEntregaCentavos: 0,
    totalCentavos: 6395,
    formaPagamento: 'DEBITO',
    trocoParaCentavos: null,
    mesaRotulo: '4',
    tempoEstimadoMin: null,
    criadoEm: '2026-11-15T14:50:00.000Z',
    itens: [
      { id: 7, produtoId: 30, nome: 'Prato por kg', quantidade: 1, pesoGramas: 455, precoUnitarioCentavos: 5990,
        totalCentavos: 2725, observacao: null },
      { id: 8, produtoId: 21, nome: 'Suco de laranja', quantidade: 2, pesoGramas: null, precoUnitarioCentavos: 585,
        totalCentavos: 1170, observacao: 'sem gelo' },
      // Um ItemPedido por toque: na conta, os 4 sem observação viram "4x Refrigerante Lata".
      ...[9, 10, 11, 12].map((id) => ({ id, produtoId: 22, nome: 'Refrigerante Lata', quantidade: 1, pesoGramas: null,
        precoUnitarioCentavos: 500, totalCentavos: 500, observacao: null })),
      { id: 13, produtoId: 22, nome: 'Refrigerante Lata', quantidade: 1, pesoGramas: null, precoUnitarioCentavos: 500,
        totalCentavos: 500, observacao: 'bem gelado' },
    ],
  },
};

export const fechamentoCaixa = {
  id: 9004,
  tipo: 'FECHAMENTO',
  criadoEm: '2026-11-16T02:31:00.000Z', // 23:31 em São Paulo
  pedidoId: null,
  caixaId: 7,
  caixa: {
    id: 7,
    abertoEm: '2026-11-15T13:58:00.000Z',
    abertoPor: { id: 2, nome: 'Ana' },
    valorInicialCentavos: 10000,
    fechadoEm: '2026-11-16T02:30:00.000Z',
    fechadoPor: { id: 3, nome: 'Bia' },
    valorContadoCentavos: 14500,
    observacao: 'Faltou uma moeda de R$ 0,50',
    movimentos: [
      { id: 1, tipo: 'SUPRIMENTO', valorCentavos: 2000, motivo: 'Troco do banco', criadoEm: '2026-11-15T15:10:00.000Z', usuario: { id: 2, nome: 'Ana' } },
      { id: 2, tipo: 'SANGRIA', valorCentavos: 5000, motivo: 'Depósito', criadoEm: '2026-11-15T19:45:00.000Z', usuario: { id: 3, nome: 'Bia' } },
    ],
    totaisPorForma: [
      { forma: 'PIX', quantidade: 1, totalCentavos: 4590 },
      { forma: 'DINHEIRO', quantidade: 3, totalCentavos: 7537 },
    ],
  },
};

/** Resumo do dia operacional sexta 13/11 (mesmos números do teste da API). */
export const relatorioDia = {
  id: 9005,
  tipo: 'RELATORIO_DIA',
  criadoEm: '2026-11-14T13:05:00.000Z', // 10:05 em São Paulo
  pedidoId: null,
  caixaId: null,
  dataRelatorio: '2026-11-13',
  relatorio: {
    data: '2026-11-13',
    horaViradaDia: 4,
    totalCentavos: 11517,
    quantidadePedidos: 3,
    ticketMedioCentavos: 3839,
    subtotalCentavos: 10517,
    taxaEntregaCentavos: 1000,
    porFormaPagamento: [
      { forma: 'DINHEIRO', quantidade: 1, totalCentavos: 2700 },
      { forma: 'PIX', quantidade: 1, totalCentavos: 4200 },
      { forma: 'DEBITO', quantidade: 1, totalCentavos: 4617 },
      { forma: 'CREDITO', quantidade: 0, totalCentavos: 0 },
    ],
    porCanal: [
      { canal: 'SITE', quantidade: 1, totalCentavos: 4200 },
      { canal: 'WHATSAPP', quantidade: 1, totalCentavos: 2700 },
      { canal: 'SALAO', quantidade: 1, totalCentavos: 4617 },
    ],
    topPorQuantidade: [
      { produtoId: 6, nome: 'X-Bacon', quantidade: 2, pesoGramas: null, totalCentavos: 3200 },
      { produtoId: 26, nome: 'Refrigerante Lata', quantidade: 2, pesoGramas: null, totalCentavos: 1000 },
      { produtoId: 31, nome: 'Prato por kg', quantidade: 1, pesoGramas: 487, totalCentavos: 2917 },
      { produtoId: 4, nome: 'X-Salada', quantidade: 1, pesoGramas: null, totalCentavos: 1300 },
      { produtoId: 3, nome: 'X-Burguer', quantidade: 1, pesoGramas: null, totalCentavos: 1200 },
      { produtoId: 27, nome: 'Coca-Cola 1L', quantidade: 1, pesoGramas: null, totalCentavos: 900 },
    ],
    topPorValor: [],
    cancelados: { quantidade: 1, totalCentavos: 5500 },
    itensRemovidos: { quantidade: 1, totalCentavos: 500 },
  },
};
