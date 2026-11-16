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
    status: 'ABERTO',
    nomeCliente: 'Mesa 4',
    telefone: null,
    enderecoTexto: null,
    bairroNome: null,
    subtotalCentavos: 3895,
    taxaEntregaCentavos: 0,
    totalCentavos: 3895,
    formaPagamento: null,
    trocoParaCentavos: null,
    mesaRotulo: '4',
    tempoEstimadoMin: null,
    criadoEm: '2026-11-15T14:50:00.000Z',
    itens: [
      { id: 7, produtoId: 30, nome: 'Prato por kg', quantidade: 1, pesoGramas: 455, precoUnitarioCentavos: 5990,
        totalCentavos: 2725, observacao: null },
      { id: 8, produtoId: 21, nome: 'Suco de laranja', quantidade: 2, pesoGramas: null, precoUnitarioCentavos: 585,
        totalCentavos: 1170, observacao: 'sem gelo' },
    ],
  },
};
