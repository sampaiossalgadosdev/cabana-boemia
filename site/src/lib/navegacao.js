/**
 * Abas da navegação do site (lógica pura, testada). Cada aba tem um caminho
 * próprio (a API devolve o index.html para qualquer rota do site), então
 * voltar do navegador e recarregar a página mantêm a aba.
 */
export const ABAS = [
  { id: 'inicio', rotulo: 'Início', caminho: '/' },
  { id: 'pedidos', rotulo: 'Pedidos', caminho: '/pedidos' },
  { id: 'perfil', rotulo: 'Perfil', caminho: '/perfil' },
];

/** Caminho da URL → id da aba ("/pedidos/" também vale; desconhecido = início). */
export function abaDoCaminho(caminho) {
  const limpo = String(caminho ?? '/').replace(/\/+$/, '') || '/';
  return ABAS.find((a) => a.caminho === limpo)?.id ?? 'inicio';
}

export const caminhoDaAba = (id) => ABAS.find((a) => a.id === id)?.caminho ?? '/';
