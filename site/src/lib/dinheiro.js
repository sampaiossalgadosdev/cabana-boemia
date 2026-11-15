const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos (Int) → "R$ 16,00". */
export function formatarPreco(centavos) {
  return formatador.format(centavos / 100);
}
