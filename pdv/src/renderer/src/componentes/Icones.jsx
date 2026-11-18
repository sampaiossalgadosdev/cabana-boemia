/** Ícones em SVG inline (sem biblioteca). */

export function IconeBicicleta(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="5.5" cy="17" r="3.5" />
      <circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17 9 9.5h6.5L18.5 17" />
      <path d="M9 9.5 12 17l3.5-7.5" />
      <path d="M8 6.5h3" />
      <path d="M15 6.5h2l-1.5 3" />
    </svg>
  );
}

export function IconeMesa(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 9h18" />
      <path d="M6 9v10M18 9v10" />
      <path d="M4 5h16" />
    </svg>
  );
}

export function IconeSair(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}

const tracado = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export function IconeLupa(props) {
  return (
    <svg width="20" height="20" {...tracado} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function IconeAtualizar(props) {
  return (
    <svg width="20" height="20" {...tracado} {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function IconeMais(props) {
  return (
    <svg width="22" height="22" {...tracado} {...props}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function IconeSeta({ direcao = 'esquerda', ...props }) {
  const d = { esquerda: 'M15 5l-7 7 7 7', direita: 'M9 5l7 7-7 7', cima: 'M5 15l7-7 7 7', baixo: 'M5 9l7 7 7-7' }[direcao];
  return (
    <svg width="24" height="24" {...tracado} strokeWidth="2.6" {...props}>
      <path d={d} />
    </svg>
  );
}

export function IconeUsuario(props) {
  return (
    <svg width="20" height="20" {...tracado} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" />
    </svg>
  );
}

export function IconeTeclado(props) {
  return (
    <svg width="22" height="22" {...tracado} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h.01M12 7h.01M15 7h.01M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01" strokeWidth="2.6" />
    </svg>
  );
}

export function IconeVassoura(props) {
  return (
    <svg width="22" height="22" {...tracado} {...props}>
      <path d="M14 3l7 7" />
      <path d="M17.5 6.5 10 14" />
      <path d="M10 14c-3-1-6 1-7 7 6-1 8-4 7-7Z" />
    </svg>
  );
}

export function IconeTrocarCliente(props) {
  return (
    <svg width="22" height="22" {...tracado} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.5-5 6.5-5" />
      <path d="M15 13h6l-2-2M21 17h-6l2 2" />
    </svg>
  );
}

/** Ícone de cada status do pedido (relógio, panela, moto, ok, x). */
export function IconeStatus({ status, ...props }) {
  const caminhos = {
    aberto: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    preparo: (
      <>
        <path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-3Z" />
        <path d="M2 11h2M20 11h2M9 4c0 1.5 1 1.5 1 3M13 4c0 1.5 1 1.5 1 3" />
      </>
    ),
    saiu: (
      <>
        <circle cx="5.5" cy="17" r="3" />
        <circle cx="18.5" cy="17" r="3" />
        <path d="M8.5 17h6l2-6h-5l-3 6M14 6h3l1.5 5" />
      </>
    ),
    finalizado: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8 12.5 2.5 2.5L16 9.5" />
      </>
    ),
    cancelado: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </>
    ),
  };
  return (
    <svg width="18" height="18" {...tracado} {...props}>
      {caminhos[status] ?? caminhos.aberto}
    </svg>
  );
}
