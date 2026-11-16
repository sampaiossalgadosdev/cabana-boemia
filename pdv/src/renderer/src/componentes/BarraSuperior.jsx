import { Logo } from './Logo.jsx';
import { CampoTempo } from './CampoTempo.jsx';
import { IndicadorConexao } from './IndicadorConexao.jsx';
import { IndicadorImpressora } from './IndicadorImpressora.jsx';
import { IconeBicicleta, IconeMesa, IconeSair } from './Icones.jsx';
import { abertoAntesDeHoje } from '../lib/caixa.js';

/** Botão "Caixa": aberto (abre o painel), esquecido aberto de outro dia (alerta) ou fechado. */
function BotaoCaixa({ caixa, aoAbrir }) {
  if (caixa === undefined) return null;
  if (!caixa) {
    return (
      <span className="caixa-status caixa-status--fechado" role="status">
        <span className="conexao__ponto" aria-hidden="true" /> Caixa fechado
      </span>
    );
  }
  const esquecido = abertoAntesDeHoje(caixa.abertoEm);
  return (
    <button type="button" className={`caixa-status ${esquecido ? 'caixa-status--esquecido' : ''}`} onClick={aoAbrir}
      title={esquecido ? 'Caixa aberto desde outro dia' : 'Sangria, suprimento e fechar caixa'}>
      <span className="conexao__ponto" aria-hidden="true" /> {esquecido ? 'Caixa de outro dia' : 'Caixa'}
    </button>
  );
}

export function BarraSuperior({ aba, aoTrocarAba, statusConexao, usuario, aoSair, saindo, caixa, aoAbrirCaixa }) {
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
        <BotaoCaixa caixa={caixa} aoAbrir={aoAbrirCaixa} />
        <IndicadorConexao status={statusConexao} />
        <IndicadorImpressora />
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
