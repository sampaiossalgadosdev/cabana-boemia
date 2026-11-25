/**
 * Taxa de entrega por quilômetro (entrega pela plataforma, lote dos entregadores).
 * Pronta e testada, mas AINDA NÃO COBRADA: hoje vale a taxa da área de entrega da loja.
 *
 * taxa = base + valorPorKm × (distância de ida e volta em km), em centavos.
 * Arredondamento explícito ao centavo, meio para cima, em aritmética inteira
 * (sem erro de ponto flutuante).
 */

export const TAXA_KM_PADRAO = Object.freeze({ baseCentavos: 100, porKmCentavos: 90 });

const inteiroNaoNegativo = (v) => Number.isInteger(v) && v >= 0;

/**
 * @param {number | null} distanciaMetros distância só de ida (loja → cliente), em metros inteiros
 * @param {{ baseCentavos: number, porKmCentavos: number }} [regra]
 * @returns {number | null} centavos; null sem distância
 */
export function taxaPorKm(distanciaMetros, regra = TAXA_KM_PADRAO) {
  if (distanciaMetros == null) return null;
  if (!inteiroNaoNegativo(distanciaMetros)) throw new RangeError('distância inválida');
  const { baseCentavos, porKmCentavos } = regra ?? {};
  if (!inteiroNaoNegativo(baseCentavos) || !inteiroNaoNegativo(porKmCentavos)) throw new RangeError('regra inválida');
  // porKm (centavos/km) × ida e volta (2 × metros / 1000 km) = porKm × 2 × metros / 1000 centavos.
  const milesimos = porKmCentavos * 2 * distanciaMetros;
  return baseCentavos + Math.floor((milesimos + 500) / 1000);
}
