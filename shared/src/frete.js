/**
 * Frete grátis (regra única para API, site e PDV; pura e testada).
 *
 * A configuração do restaurante vira `freteGratis = { minimoCentavos } | null`
 * (null = desligado). Com subtotal dos itens (sem a taxa) >= mínimo, a taxa
 * de entrega é 0; senão vale a taxa do bairro. Só a API decide o valor
 * oficial: site e PDV usam isto apenas para mostrar a prévia.
 */

/**
 * @param {{ freteGratisAtivo?: boolean, freteGratisMinimoCentavos?: number | null } | null | undefined} config
 * @returns {{ minimoCentavos: number } | null}
 */
export function freteGratisDaConfig(config) {
  const minimo = config?.freteGratisMinimoCentavos;
  if (!config?.freteGratisAtivo || !Number.isInteger(minimo) || minimo <= 0) return null;
  return { minimoCentavos: minimo };
}

/** O pedido ganha frete grátis? */
export function ganhouFreteGratis(subtotalCentavos, freteGratis) {
  return Boolean(freteGratis) && subtotalCentavos >= freteGratis.minimoCentavos;
}

/** Taxa de entrega cobrada: 0 com frete grátis, senão a do bairro. */
export function taxaDeEntrega(taxaBairroCentavos, subtotalCentavos, freteGratis) {
  return ganhouFreteGratis(subtotalCentavos, freteGratis) ? 0 : taxaBairroCentavos;
}

/**
 * Barra de progresso do site.
 * @returns {{ atingido: boolean, faltaCentavos: number, percentual: number } | null} null = frete grátis desligado
 */
export function progressoFreteGratis(subtotalCentavos, freteGratis) {
  if (!freteGratis) return null;
  const { minimoCentavos } = freteGratis;
  const atingido = subtotalCentavos >= minimoCentavos;
  return {
    atingido,
    faltaCentavos: atingido ? 0 : minimoCentavos - subtotalCentavos,
    percentual: atingido ? 100 : Math.max(0, Math.min(100, Math.floor((subtotalCentavos * 100) / minimoCentavos))),
  };
}
