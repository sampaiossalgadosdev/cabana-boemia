/**
 * Relatório do dia OPERACIONAL de uma loja (vira às Loja.horaViradaDia, padrão 4h).
 *
 * - Venda = pedido FINALIZADO com finalizadoEm em [D virada, D+1 virada) local
 *   (o dinheiro entrou no expediente D; mesmo critério dos caixas do dia).
 * - Itens: só os NÃO cancelados de pedidos finalizados. A comanda recalcula o
 *   total sem os itens removidos, então Σ itens + Σ taxa − Σ desconto = Σ total
 *   (desconto só existe em pedido lançado pela equipe no delivery).
 * - Cancelados (por canceladoEm no dia) e itens removidos aparecem à parte,
 *   fora dos totais. EXPIRADO (Pix não pago) não é cancelado e não aparece.
 * - Formas de pagamento: as pagas NA ENTREGA; o pago online (Pix/cartão no app) à parte, e os
 *   estornos de pedidos finalizados (feitos pelo ADMIN) também à parte (Etapa 5).
 */
import { emitirParaEquipe } from '../lib/eventos.js';
import { paraCampoData } from '../lib/fuso.js';
import * as relatorioRepo from '../repositories/relatorio.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import { resolverDia } from './diaOperacional.service.js';
import { CANAIS, FORMAS_PAGAMENTO } from './pedido.service.js';

export const TOP = 10;
// Ordem fixa (o gráfico tem sempre as 4 barras; Dinheiro primeiro, como no caixa).
const ORDEM_FORMAS = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];
// Pago online (o cartão entra na Etapa 7; aparece zerado até lá).
const MEIOS_ONLINE = ['PIX', 'CARTAO_ONLINE'];

/** Grupos do groupBy → lista completa na ordem dada, com zero no que não vendeu. */
function completar(grupos, chave, ordem) {
  const por = new Map(grupos.map((g) => [g[chave], g]));
  return ordem.map((valor) => ({
    [chave === 'formaPagamento' ? 'forma' : chave === 'meioOnline' ? 'meio' : chave]: valor,
    quantidade: por.get(valor)?._count._all ?? 0,
    totalCentavos: por.get(valor)?._sum.totalCentavos ?? 0,
  }));
}

/** Funções puras de ordenação dos tops (desempate estável pelo nome). */
export const porQuantidade = (a, b) =>
  b.quantidade - a.quantidade || b.totalCentavos - a.totalCentavos || a.nome.localeCompare(b.nome, 'pt-BR');
export const porValor = (a, b) =>
  b.totalCentavos - a.totalCentavos || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR');

/** Ticket médio arredondado ao centavo; 0 sem pedidos. */
export const ticketMedio = (total, quantidade) => (quantidade ? Math.round(total / quantidade) : 0);

/**
 * @param {string} data "hoje" ou "YYYY-MM-DD" (dia operacional)
 */
export async function relatorioDoDia(lojaId, data, agora = new Date()) {
  const { dia, horaVirada, inicio, fim } = await resolverDia(lojaId, data, agora);
  const [resumo, formas, canais, produtos, cancelados, removidos, online, estornos] = await Promise.all([
    relatorioRepo.resumo(lojaId, inicio, fim),
    relatorioRepo.porFormaPagamento(lojaId, inicio, fim),
    relatorioRepo.porCanal(lojaId, inicio, fim),
    relatorioRepo.porProduto(lojaId, inicio, fim),
    relatorioRepo.cancelados(lojaId, inicio, fim),
    relatorioRepo.itensRemovidos(lojaId, inicio, fim),
    relatorioRepo.porMeioOnline(lojaId, inicio, fim),
    relatorioRepo.estornosDeFinalizados(lojaId, inicio, fim),
  ]);

  const nomes = new Map(
    (await relatorioRepo.nomesDosProdutos(produtos.map((p) => p.produtoId))).map((p) => [p.id, p]),
  );
  const linhas = produtos.map((p) => ({
    produtoId: p.produtoId,
    nome: nomes.get(p.produtoId)?.nome ?? `Produto ${p.produtoId}`,
    tipoPreco: nomes.get(p.produtoId)?.tipoPreco ?? 'UNIDADE',
    quantidade: p._sum.quantidade ?? 0,
    pesoGramas: p._sum.pesoGramas ?? null,
    totalCentavos: p._sum.totalCentavos ?? 0,
  }));

  const totalCentavos = resumo._sum.totalCentavos ?? 0;
  const quantidadePedidos = resumo._count._all;
  return {
    data: dia,
    horaViradaDia: horaVirada,
    inicio,
    fim,
    totalCentavos,
    quantidadePedidos,
    ticketMedioCentavos: ticketMedio(totalCentavos, quantidadePedidos),
    subtotalCentavos: resumo._sum.subtotalCentavos ?? 0,
    taxaEntregaCentavos: resumo._sum.taxaEntregaCentavos ?? 0,
    descontoCentavos: resumo._sum.descontoCentavos ?? 0,
    // Pagas na entrega (com a gaveta ou a maquininha da loja); o pago online vem à parte (Decisão 19).
    porFormaPagamento: completar(formas, 'formaPagamento', ORDEM_FORMAS.filter((f) => FORMAS_PAGAMENTO.includes(f))),
    pagoOnline: completar(online, 'meioOnline', MEIOS_ONLINE),
    estornosDeFinalizados: { quantidade: estornos._count._all, totalCentavos: estornos._sum.valorCentavos ?? 0 },
    porCanal: completar(canais, 'canal', CANAIS),
    topPorQuantidade: [...linhas].sort(porQuantidade).slice(0, TOP),
    topPorValor: [...linhas].sort(porValor).slice(0, TOP),
    cancelados: { quantidade: cancelados._count._all, totalCentavos: cancelados._sum.totalCentavos ?? 0 },
    itensRemovidos: { quantidade: removidos._count._all, totalCentavos: removidos._sum.totalCentavos ?? 0 },
  };
}

/**
 * "Imprimir fechamento do dia": trabalho RELATORIO_DIA com o dia operacional.
 * O resumo é calculado na hora de imprimir (fila de impressão), como o FECHAMENTO.
 */
export async function imprimirRelatorio(lojaId, data, agora = new Date()) {
  const { dia } = await resolverDia(lojaId, data, agora);
  const trabalho = await pedidoRepo.criarTrabalhoImpressao({
    lojaId,
    tipo: 'RELATORIO_DIA',
    status: 'PENDENTE',
    dataRelatorio: paraCampoData(dia),
  });
  emitirParaEquipe(lojaId, 'impressao:nova', trabalho);
  return { trabalho: { id: trabalho.id, tipo: trabalho.tipo, status: trabalho.status, dataRelatorio: dia } };
}
