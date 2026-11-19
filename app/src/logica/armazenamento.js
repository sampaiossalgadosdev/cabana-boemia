/**
 * Armazenamento do aparelho com a interface do AsyncStorage (getItem/setItem/
 * removeItem que devolvem Promise). Sem React Native aqui: o app injeta o
 * AsyncStorage em `plataforma.js` (usarArmazenamento) e os testes passam um
 * storage em memória. Nada aqui pode derrubar o app: em falha, lê null e não
 * grava.
 */
let padrao = null;

/** Define o storage usado quando a função não recebe um. */
export function usarArmazenamento(storage) {
  padrao = storage ?? null;
}

/** @returns {Promise<string | null>} */
export async function lerTexto(chave, storage = padrao) {
  try {
    return (await storage?.getItem(chave)) ?? null;
  } catch {
    return null;
  }
}

export async function removerTexto(chave, storage = padrao) {
  try {
    await storage?.removeItem(chave);
  } catch {
    // sem storage: nada a remover
  }
}

/** @returns {Promise<boolean>} se gravou */
export async function gravarTexto(chave, valor, storage = padrao) {
  try {
    if (!storage) return false;
    await storage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
}
