const TEXTOS = {
  conectado: 'Conectado',
  reconectando: 'Reconectando…',
  desligado: 'Desconectado',
};

/** Estado do Socket.IO (tempo real) na barra superior. */
export function IndicadorConexao({ status }) {
  return (
    <span
      className={`conexao conexao--${status}`}
      role="status"
      title={status === 'conectado' ? 'Recebendo pedidos em tempo real' : 'Pedidos novos podem atrasar'}
    >
      <span className="conexao__ponto" aria-hidden="true" />
      {TEXTOS[status] ?? status}
    </span>
  );
}
