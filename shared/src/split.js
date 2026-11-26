/**
 * Divisão do dinheiro do pedido entre a loja, a plataforma e o entregador (pagamento
 * online com Mercado Pago, Split 1:1). Pura e testada; a API decide o valor oficial.
 * Decisões em docs/pagamento-online.md (2, 4, 12, 16 e as da Etapa 2).
 *
 * - Loja PROPRIO (motoboy da loja): a taxa é da loja; nada vai à plataforma.
 *   Campanha da primeira compra: o cliente não paga a taxa e ela vira CRÉDITO da loja.
 * - Loja PLATAFORMA (entregador do Taaki): a taxa é da plataforma, dividida 95% para o
 *   entregador (meio para cima) e o resto para a plataforma, mesmo com frete grátis.
 *   Frete grátis da loja: a loja paga a taxa cheia. Campanha: a plataforma paga (zero da loja).
 * - Os dois frete grátis no mesmo pedido: vale o da loja e a campanha não é consumida.
 * - Trava: o que a loja deve à plataforma passa de 50% do valor cobrado do cliente? O split
 *   leva só 50% (arredondado para baixo) e o resto vira débito da loja no livro-razão
 *   (TAXA_ENTREGA_COMPLEMENTO), com alerta para o ADMIN.
 *
 * Esta função não escolhe entre taxa por km e da área: recebe a taxa já resolvida e a origem.
 */

import { ganhouFreteGratis } from './frete.js';

export const MODOS_ENTREGA = Object.freeze(['PLATAFORMA', 'PROPRIO']);
export const ORIGENS_TAXA = Object.freeze(['KM', 'AREA']);
/** Parte da taxa que fica com o entregador da plataforma (%). */
export const PERCENTUAL_ENTREGADOR = 95;
/** Teto do valor da plataforma no split, em % do valor cobrado do cliente. */
export const LIMITE_SPLIT_PERCENTUAL = 50;

const inteiroNaoNegativo = (v) => Number.isInteger(v) && v >= 0;

/**
 * Taxa cheia dividida entre o entregador (95%, meio para cima) e a plataforma (o resto):
 * a soma bate sempre com a taxa.
 * @param {number} taxaCentavos
 * @returns {{ entregadorCentavos: number, plataformaCentavos: number }}
 */
export function dividirTaxaEntrega(taxaCentavos) {
  if (!inteiroNaoNegativo(taxaCentavos)) throw new RangeError('taxa inválida');
  const entregadorCentavos = Math.floor((taxaCentavos * PERCENTUAL_ENTREGADOR + 50) / 100);
  return { entregadorCentavos, plataformaCentavos: taxaCentavos - entregadorCentavos };
}

/**
 * @param {{
 *   subtotalCentavos: number,           // itens
 *   descontoCentavos?: number,          // desconto da loja (PDV); padrão 0
 *   modoEntrega: 'PLATAFORMA' | 'PROPRIO',
 *   comEntrega?: boolean,               // false = retirada no balcão (sem taxa nem entregador); padrão true
 *   taxaEntregaCentavos: number,        // taxa cheia já resolvida (km ou área)
 *   origemTaxa?: 'KM' | 'AREA',         // obrigatória em PLATAFORMA com entrega
 *   freteGratisLoja?: { minimoCentavos: number } | null,  // freteGratisDaConfig(loja, { canal })
 *   campanhaElegivel?: boolean,         // primeira compra: telefone verificado, app, sem uso nem reserva
 * }} entrada
 * @returns {{
 *   taxaCheiaCentavos: number,
 *   taxaCobradaCentavos: number,
 *   valorCobradoCentavos: number,
 *   origemFreteGratis: 'NENHUM' | 'LOJA' | 'CAMPANHA',
 *   consumirCampanha: boolean,
 *   origemTaxaEntrega: 'KM' | 'AREA' | null,
 *   valorEntregadorCentavos: number | null,
 *   valorPlataformaEntregaCentavos: number | null,
 *   devidoPelaLojaCentavos: number,
 *   valorPlataformaSplitCentavos: number,
 *   complementoLojaCentavos: number,
 *   alertaAdmin: boolean,
 *   creditoLojaCentavos: number,
 * }}
 *   `devidoPelaLojaCentavos`: tudo que a loja deve à plataforma pelo pedido. No pagamento
 *   online, `valorPlataformaSplitCentavos` vai no split (0 = omitir o campo) e
 *   `complementoLojaCentavos` vai para o livro-razão; pago na entrega, o livro-razão
 *   recebe o devido inteiro. `creditoLojaCentavos`: a plataforma deve à loja.
 */
export function calcularSplit({
  subtotalCentavos,
  descontoCentavos = 0,
  modoEntrega,
  comEntrega = true,
  taxaEntregaCentavos,
  origemTaxa,
  freteGratisLoja = null,
  campanhaElegivel = false,
}) {
  if (!inteiroNaoNegativo(subtotalCentavos)) throw new RangeError('subtotal inválido');
  if (!inteiroNaoNegativo(descontoCentavos)) throw new RangeError('desconto inválido');
  if (!MODOS_ENTREGA.includes(modoEntrega)) throw new RangeError('modo de entrega inválido');
  const taxaCheia = comEntrega ? taxaEntregaCentavos : 0;
  if (!inteiroNaoNegativo(taxaCheia)) throw new RangeError('taxa inválida');
  const plataforma = modoEntrega === 'PLATAFORMA' && comEntrega;
  if (plataforma && !ORIGENS_TAXA.includes(origemTaxa)) throw new RangeError('origem da taxa inválida');

  // Frete grátis só existe com taxa a perdoar. O da loja vence a campanha (que fica para depois).
  let origemFreteGratis = 'NENHUM';
  if (comEntrega && taxaCheia > 0) {
    if (ganhouFreteGratis(subtotalCentavos, freteGratisLoja)) origemFreteGratis = 'LOJA';
    else if (campanhaElegivel) origemFreteGratis = 'CAMPANHA';
  }
  const taxaCobrada = origemFreteGratis === 'NENHUM' ? taxaCheia : 0;
  const valorCobrado = subtotalCentavos + taxaCobrada - descontoCentavos;
  if (valorCobrado < 0) throw new RangeError('desconto maior que o valor do pedido');

  const divisao = plataforma ? dividirTaxaEntrega(taxaCheia) : null;
  // Entregador da plataforma: a loja deve a taxa cheia, menos quando a campanha paga.
  const devido = plataforma && origemFreteGratis !== 'CAMPANHA' ? taxaCheia : 0;
  // Trava: o split nunca leva mais que 50% do valor cobrado (o resto, a loja deve no livro-razão).
  const teto = Math.floor((valorCobrado * LIMITE_SPLIT_PERCENTUAL) / 100);
  const noSplit = Math.min(devido, teto);
  const complemento = devido - noSplit;

  return {
    taxaCheiaCentavos: taxaCheia,
    taxaCobradaCentavos: taxaCobrada,
    valorCobradoCentavos: valorCobrado,
    origemFreteGratis,
    consumirCampanha: origemFreteGratis === 'CAMPANHA',
    origemTaxaEntrega: plataforma ? origemTaxa : null,
    valorEntregadorCentavos: divisao ? divisao.entregadorCentavos : null,
    valorPlataformaEntregaCentavos: divisao ? divisao.plataformaCentavos : null,
    devidoPelaLojaCentavos: devido,
    valorPlataformaSplitCentavos: noSplit,
    complementoLojaCentavos: complemento,
    alertaAdmin: complemento > 0,
    creditoLojaCentavos: !plataforma && origemFreteGratis === 'CAMPANHA' ? taxaCheia : 0,
  };
}
