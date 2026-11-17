import { ABAS } from '../lib/navegacao.js';

const ICONES = {
  inicio: (
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  ),
  pedidos: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-2 2-2-2-2 2-2-2-3 2V4a1 1 0 0 1 1-1z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  perfil: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
};

/**
 * Navegação entre Início, Pedidos e Perfil. `variante="inferior"`: barra fixa
 * no rodapé (celular); `"topo"`: abas no cabeçalho (telas largas). O CSS
 * mostra só uma das duas conforme a largura.
 */
export function Navegacao({ aba, onIr, variante }) {
  return (
    <nav className={`navegacao navegacao--${variante}`} aria-label="Navegação principal">
      <ul className="navegacao__lista">
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          return (
            <li key={a.id}>
              <a
                href={a.caminho}
                className={`navegacao__item${ativa ? ' navegacao__item--ativa' : ''}`}
                aria-current={ativa ? 'page' : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // nova aba: deixa o navegador
                  e.preventDefault();
                  onIr(a.id);
                }}
              >
                <svg
                  className="navegacao__icone"
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={ativa ? 2.4 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONES[a.id]}
                </svg>
                <span>{a.rotulo}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
