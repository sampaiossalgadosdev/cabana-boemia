const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos (Int) → "R$ 16,00". */
export function formatarReais(centavos) {
  return formatador.format((centavos ?? 0) / 100).replace(/ /g, ' ');
}

/** Centavos → texto do campo, sem "R$": 1650 → "16,50". */
export function centavosParaCampo(centavos) {
  if (centavos == null) return '';
  return (centavos / 100).toFixed(2).replace('.', ',');
}

/**
 * Texto digitado → centavos (Int), ou null se não for um valor válido.
 * Aceita "16", "16,5", "16,50", "1.234,56", "R$ 3,00" e "16.50" (ponto como
 * decimal só quando não há vírgula e há 1 ou 2 casas depois dele).
 */
export function lerReais(texto) {
  let t = String(texto ?? '')
    .replace(/R\$/i, '')
    .replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  return Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
}
