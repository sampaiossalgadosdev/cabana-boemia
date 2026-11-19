/**
 * UUID v4. O React Native não tem `crypto.randomUUID`: o app injeta o do
 * expo-crypto em `plataforma.js` (usarGeradorUuid). Sem injeção (testes no
 * Node), usa o `crypto` global.
 */
let gerador = () => globalThis.crypto.randomUUID();

export function usarGeradorUuid(fn) {
  gerador = fn;
}

/** @returns {string} */
export const novoUuid = () => gerador();
