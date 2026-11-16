/**
 * Fila local do agente (memória do processo main). Ordem de impressão = id
 * do trabalho. Duas travas contra imprimir duas vezes:
 *  1. a API só devolve trabalhos PENDENTE (confirmado sai de lá);
 *  2. `impressos`: ids que a impressora aceitou nesta sessão. Mesmo que a
 *     confirmação ainda não tenha chegado na API (rede caiu logo depois da
 *     impressão), o id nunca volta para a fila; só falta confirmar.
 */
export function criarFilaLocal() {
  /** @type {Map<number, object>} */
  const pendentes = new Map();
  const impressos = new Set();
  const aConfirmar = new Set();

  return {
    /** Acrescenta os que ainda não foram impressos nesta sessão. @returns quantos entraram */
    adicionar(trabalhos) {
      let novos = 0;
      for (const t of trabalhos ?? []) {
        if (!Number.isInteger(t?.id) || impressos.has(t.id) || pendentes.has(t.id)) continue;
        pendentes.set(t.id, t);
        novos += 1;
      }
      return novos;
    },
    /** Próximo a imprimir (menor id) ou null. */
    proximo() {
      let menor = null;
      for (const id of pendentes.keys()) if (menor === null || id < menor) menor = id;
      return menor === null ? null : pendentes.get(menor);
    },
    remover(id) {
      pendentes.delete(id);
    },
    /** A impressora aceitou: nunca mais imprime este id; falta confirmar na API. */
    marcarImpresso(id) {
      impressos.add(id);
      aConfirmar.add(id);
      pendentes.delete(id);
    },
    marcarConfirmado(id) {
      aConfirmar.delete(id);
    },
    jaImpresso: (id) => impressos.has(id),
    paraConfirmar: () => [...aConfirmar].sort((a, b) => a - b),
    tamanho: () => pendentes.size,
    /** Esquece os pendentes (ex.: ao sair); mantém `impressos`, a trava da sessão. */
    esvaziar() {
      pendentes.clear();
    },
  };
}
