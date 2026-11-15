import { Logo } from './Logo.jsx';
import { CampoTempo } from './CampoTempo.jsx';
import { IndicadorConexao } from './IndicadorConexao.jsx';
import { IconeBicicleta, IconeMesa, IconeSair } from './Icones.jsx';

export function BarraSuperior({ aba, aoTrocarAba, statusConexao, usuario, aoSair, saindo }) {
  return (
    <header className="barra">
      <Logo className="barra__logo" />

      <nav className="barra__abas" aria-label="Área">
        <button
          type="button"
          className={`aba ${aba === 'salao' ? 'aba--ativa' : ''}`}
          aria-pressed={aba === 'salao'}
          onClick={() => aoTrocarAba('salao')}
        >
          <IconeMesa /> Salão
        </button>
        <button
          type="button"
          className={`aba ${aba === 'delivery' ? 'aba--ativa' : ''}`}
          aria-pressed={aba === 'delivery'}
          onClick={() => aoTrocarAba('delivery')}
        >
          <IconeBicicleta /> Delivery
        </button>
      </nav>

      <CampoTempo />

      <div className="barra__direita">
        <IndicadorConexao status={statusConexao} />
        <span className="barra__usuario" title={usuario.email}>
          {usuario.nome}
        </span>
        <button type="button" className="botao botao--contorno" onClick={aoSair} disabled={saindo}>
          <IconeSair /> Sair
        </button>
      </div>
    </header>
  );
}
