/**
 * Telefone celular brasileiro: DDD + 9 dígitos (11 dígitos, o terceiro é 9).
 * Guardado só com números, ex.: "43999990000". Usado pela API e pelo site.
 */

// DDDs em uso no Brasil (Anatel).
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export const MENSAGEM_TELEFONE_INVALIDO = 'Telefone inválido. Informe DDD + 9 dígitos, ex.: (43) 99999-0000';

/**
 * Normaliza para só números. Aceita formatação, "+55" e o "0" de longa distância.
 * @param {unknown} valor
 * @returns {string | null} 11 dígitos, ou null se não for um celular válido
 */
export function normalizarTelefone(valor) {
  if (typeof valor !== 'string') return null;
  let d = valor.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  else if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  if (!/^\d{2}9\d{8}$/.test(d)) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  return d;
}

/** "43999990000" → "(43) 99999-0000". Outros valores voltam como vieram. */
export function formatarTelefone(digitos) {
  const m = /^(\d{2})(\d{5})(\d{4})$/.exec(digitos ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (digitos ?? '');
}

/** Máscara enquanto digita: "4399" → "(43) 99", até "(43) 99999-0000". */
export function mascararTelefone(texto) {
  const d = String(texto ?? '').replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
