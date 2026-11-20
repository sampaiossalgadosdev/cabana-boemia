/**
 * CPF e CNPJ: só dígitos, com os dígitos verificadores conferidos (módulo 11).
 * Usado no cadastro do anunciante (registro da veiculação).
 */

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

function digitoMod11(numeros, pesos) {
  const soma = numeros.reduce((acc, n, i) => acc + n * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(valor) {
  const d = soDigitos(valor);
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const n = [...d].map(Number);
  const d1 = digitoMod11(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoMod11(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return n[9] === d1 && n[10] === d2;
}

export function cnpjValido(valor) {
  const d = soDigitos(valor);
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const n = [...d].map(Number);
  const d1 = digitoMod11(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digitoMod11(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return n[12] === d1 && n[13] === d2;
}

/** "123.456.789-09" → "12345678909" se for CPF ou CNPJ válido; senão null. */
export function normalizarCpfCnpj(valor) {
  const d = soDigitos(valor);
  if (d.length === 11) return cpfValido(d) ? d : null;
  if (d.length === 14) return cnpjValido(d) ? d : null;
  return null;
}
