/**
 * Chave de acesso da NFC-e (44 dígitos): cUF(2) AAMM(4) CNPJ(14) mod(2) série(3)
 * nNF(9) tpEmis(1) cNF(8) cDV(1). Modelo 65 = NFC-e. O dígito verificador é o
 * módulo 11 dos 43 primeiros, com pesos 2..9 da direita para a esquerda
 * (resto 0 ou 1 = DV 0).
 */

/** Só os dígitos (aceita a chave copiada com espaços ou pontos). */
export const limparChave = (valor) => String(valor ?? '').replace(/\D/g, '');

/** Dígito verificador dos 43 primeiros dígitos. */
export function digitoVerificador(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * Função pura: motivo para a chave não valer, ou null.
 * @param {string} chave só dígitos
 */
export function problemaNaChave(chave) {
  if (!/^\d{44}$/.test(chave)) return 'A chave da NFC-e tem 44 números';
  if (chave.slice(20, 22) !== '65') return 'Esta chave não é de NFC-e (modelo 65)';
  if (digitoVerificador(chave.slice(0, 43)) !== Number(chave[43])) return 'Chave da NFC-e inválida (confira os números)';
  return null;
}
