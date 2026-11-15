/**
 * localStorage pode faltar ou lançar (aba anônima, cota cheia, dados do site
 * bloqueados). Nada aqui pode derrubar o site: em falha, lê null e não grava.
 */
function storagePadrao() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @returns {string | null} */
export function lerTexto(chave, storage = storagePadrao()) {
  try {
    return storage?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}

/** @returns {boolean} se gravou */
export function gravarTexto(chave, valor, storage = storagePadrao()) {
  try {
    if (!storage) return false;
    storage.setItem(chave, valor);
    return true;
  } catch {
    return false;
  }
}
