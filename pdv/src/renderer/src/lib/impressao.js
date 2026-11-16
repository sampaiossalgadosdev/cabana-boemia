/**
 * Resumo do agente de impressão para a barra: impressora OK, sem papel ou
 * erro, offline (impressora ou servidor) ou desligada neste computador.
 */
export function resumoImpressao(s) {
  if (!s || s.estado === 'desligado') return { classe: 'desligado', texto: 'Impressão desligada' };
  if (s.conexao === 'offline') return { classe: 'offline', texto: 'Impressora offline', dica: 'Sem conexão com o servidor' };
  const fila = s.pendentes > 0 ? ` · ${s.pendentes} na fila` : '';
  switch (s.estado) {
    case 'ok':
      return { classe: 'ok', texto: `${s.modo === 'arquivo' ? 'Modo teste (.txt)' : 'Impressora OK'}${fila}`, dica: s.mensagem };
    case 'sem-papel':
      return { classe: 'erro', texto: `Sem papel${fila}`, dica: 'Troque a bobina: os cupons saem sozinhos depois' };
    case 'erro':
      return { classe: 'erro', texto: `Erro na impressora${fila}`, dica: s.mensagem };
    case 'offline':
      return { classe: 'offline', texto: `Impressora offline${fila}`, dica: s.mensagem };
    default:
      return { classe: 'offline', texto: 'Impressora…', dica: 'Verificando' };
  }
}
