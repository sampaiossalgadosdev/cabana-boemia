import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { DIAS_SEMANA, descreverHorario, horariosParaApi } from '../lib/formatar.js';
import { EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

// Segunda primeiro (como o dono pensa a semana); domingo no fim.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

let proximaChave = 0;
const comChave = (h) => ({ ...h, chave: ++proximaChave });

/**
 * Horários de cada turno por dia da semana. O site só aceita pedido no
 * turno aberto. Horários de turnos diferentes não podem se cruzar.
 */
export function TelaTurnos() {
  const carga = useCarregar(() => api.turnos.listar());
  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Turnos e horários</h1>
          <p className="pagina__sub">
            Fim antes do início passa da meia-noite (ex.: 19:00 até 01:00). Fim 00:00 = meia-noite.
          </p>
        </div>
      </div>
      <EstadoCarga carga={carga}>
        {({ turnos }) =>
          turnos.map((t) => <CartaoTurno key={t.id} turno={t} aoSalvar={carga.recarregar} />)
        }
      </EstadoCarga>
    </>
  );
}

function CartaoTurno({ turno, aoSalvar }) {
  const avisar = useAvisar();
  const [linhas, setLinhas] = useState([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mudou, setMudou] = useState(false);

  useEffect(() => {
    setLinhas(turno.horarios.map(comChave));
    setMudou(false);
    setErro('');
  }, [turno]);

  const editar = (fn) => {
    setLinhas(fn);
    setMudou(true);
    setErro('');
  };

  function desfazer() {
    setLinhas(turno.horarios.map(comChave));
    setMudou(false);
    setErro('');
  }

  async function salvar() {
    const { horarios, erro: e } = horariosParaApi(linhas);
    if (e) {
      setErro(e);
      return;
    }
    setSalvando(true);
    try {
      await api.turnos.definirHorarios(turno.id, horarios);
      avisar(`Horários de ${turno.nome} salvos.`);
      await aoSalvar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao">
      <div className="cartao__topo">
        <div>
          <h2 className="cartao__titulo">{turno.nome}</h2>
          {!turno.ativo && <span className="etiqueta">Turno inativo</span>}
          {!linhas.length && <span className="suave">Sem horários: o turno nunca abre.</span>}
        </div>
        <div className="acoes">
          {mudou && (
            <button type="button" className="botao" disabled={salvando} onClick={desfazer}>
              Desfazer
            </button>
          )}
          <button type="button" className="botao botao--primario" disabled={!mudou || salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar horários'}
          </button>
        </div>
      </div>
      {erro && (
        <div className="alerta" role="alert" style={{ margin: '12px 16px 0' }}>
          {erro}
        </div>
      )}
      {ORDEM_DIAS.map((dia) => {
        const doDia = linhas.filter((l) => l.diaSemana === dia);
        return (
          <div key={dia} className="dia-horarios">
            <div className="dia-horarios__nome">{DIAS_SEMANA[dia]}</div>
            <div className="dia-horarios__lista">
              {!doDia.length && <span className="suave" style={{ paddingTop: 8 }}>Fechado</span>}
              {doDia.map((l) => (
                <div key={l.chave} className="faixa-horario">
                  <input
                    type="time"
                    className="entrada"
                    aria-label={`${DIAS_SEMANA[dia]}: início`}
                    value={l.inicio}
                    onChange={(e) => editar((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, inicio: e.target.value } : x)))}
                  />
                  <span>até</span>
                  <input
                    type="time"
                    className="entrada"
                    aria-label={`${DIAS_SEMANA[dia]}: fim`}
                    value={l.fim}
                    onChange={(e) => editar((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, fim: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="botao botao--icone botao--perigo"
                    aria-label={`Remover horário de ${DIAS_SEMANA[dia]}`}
                    onClick={() => editar((ls) => ls.filter((x) => x.chave !== l.chave))}
                  >
                    ×
                  </button>
                  {l.inicio && l.fim && l.inicio !== l.fim && <span className="suave">{descreverHorario(l)}</span>}
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="botao botao--pequeno"
                  onClick={() => editar((ls) => [...ls, comChave({ diaSemana: dia, inicio: '', fim: '' })])}
                >
                  + Horário
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
