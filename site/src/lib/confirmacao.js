// Animação de "pedido confirmado" (componente pronto do dono, em public/confirmacao/,
// carregado pelo index.html). Se o script não carregou, o fluxo segue sem animação.

export function preCarregarConfirmacao() {
  try {
    window.CBConfirmacao?.preCarregar();
  } catch {
    // sem animação, sem problema
  }
}

/** Resolve quando a animação termina (ou na hora, se ela não estiver disponível). */
export function mostrarConfirmacao(opcoes) {
  try {
    if (window.CBConfirmacao) return window.CBConfirmacao.mostrar(opcoes);
  } catch {
    // segue sem animação
  }
  return Promise.resolve();
}
