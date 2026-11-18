import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { DIAS_SEMANA } from '../lib/formatar.js';
import { gravarEmOrdem, ordenarTurnos, prepararGravacao } from '../lib/turnos.js';
import { EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

// Segunda primeiro (como o dono pensa a semana); domingo no fim.
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

let proximaChave = 0;
const comChave = (h) => ({ diaSemana: h.diaSemana, inicio: h.inicio, fim: h.fim, chave: ++proximaChave });

/** { turnoId: linhas } a partir do que veio do servidor. */
const linhasDoServidor = (turnos) => Object.fromEntries(turnos.map((t) => [t.id, t.horarios.map(comChave)]));

/**
 * Horários de cada turno por dia da semana, numa tabela só (uma coluna por
 * turno). O site só aceita pedido no turno aberto. Horários de turnos
 * diferentes não podem se cruzar.
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
        {({ turnos }) => <TabelaHorarios turnos={turnos} aoSalvar={carga.recarregar} />}
      </EstadoCarga>
    </>
  );
}

function TabelaHorarios({ turnos: doServidor, aoSalvar }) {
  const avisar = useAvisar();
  const turnos = useMemo(() => ordenarTurnos(doServidor), [doServidor]);
  const [linhas, setLinhas] = useState({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mudou, setMudou] = useState(false);

  function desfazer() {
    setLinhas(linhasDoServidor(doServidor));
    setMudou(false);
    setErro('');
  }

  useEffect(desfazer, [doServidor]);

  const editar = (turnoId, fn) => {
    setLinhas((atual) => ({ ...atual, [turnoId]: fn(atual[turnoId] ?? []) }));
    setMudou(true);
    setErro('');
  };

  async function salvar() {
    const preparo = prepararGravacao(turnos, linhas);
    if (preparo.erro) {
      setErro(preparo.erro);
      return;
    }
    if (!preparo.gravar.length) {
      setMudou(false);
      return;
    }
    setSalvando(true);
    try {
      const { gravados, erro: e } = await gravarEmOrdem(preparo.gravar, api.turnos.definirHorarios);
      if (e) {
        // O que já foi gravado continua na tela como está; salvar de novo é seguro.
        const nomes = turnos.filter((t) => gravados.includes(t.id)).map((t) => t.nome);
        setErro(nomes.length ? `${e.message} (${nomes.join(' e ')} já ${nomes.length > 1 ? 'foram salvos' : 'foi salvo'}.)` : e.message);
        return;
      }
      avisar('Horários salvos.');
      await aoSalvar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao horarios">
      <div className="cartao__topo">
        <h2 className="cartao__titulo">Horários da semana</h2>
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
        <div className="alerta" role="alert" style={{ margin: '12px 16px' }}>
          {erro}
        </div>
      )}
      <div className="horarios__tabela" style={{ '--colunas-turno': turnos.length }}>
        <div className="horarios__linha horarios__cabecalho">
          <div className="horarios__dia" aria-hidden="true" />
          {turnos.map((t) => (
            <div key={t.id} className="horarios__celula">
              <span className="horarios__turno">{t.nome}</span>
              {!t.ativo && <span className="etiqueta">Turno inativo</span>}
              {!linhas[t.id]?.length && <span className="suave">Sem horários: nunca abre.</span>}
            </div>
          ))}
        </div>
        {ORDEM_DIAS.map((dia) => (
          <div key={dia} className="horarios__linha">
            <div className="horarios__dia">{DIAS_SEMANA[dia]}</div>
            {turnos.map((t) => (
              <CelulaHorarios
                key={t.id}
                turno={t}
                dia={dia}
                linhas={(linhas[t.id] ?? []).filter((l) => l.diaSemana === dia)}
                editar={(fn) => editar(t.id, fn)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function CelulaHorarios({ turno, dia, linhas, editar }) {
  const rotulo = `${turno.nome}, ${DIAS_SEMANA[dia]}`;
  const mudar = (chave, campo, valor) => editar((ls) => ls.map((x) => (x.chave === chave ? { ...x, [campo]: valor } : x)));
  return (
    <div className="horarios__celula">
      {/* No celular as colunas viram blocos: o nome do turno aparece em cada dia. */}
      <span className="horarios__rotulo-movel">
        {turno.nome}
        {!turno.ativo && ' (inativo)'}
      </span>
      {!linhas.length && <span className="suave horarios__fechado">Fechado</span>}
      {linhas.map((l) => (
        <div key={l.chave} className="faixa-horario">
          <input
            type="time"
            className="entrada"
            aria-label={`${rotulo}: início`}
            value={l.inicio}
            onChange={(e) => mudar(l.chave, 'inicio', e.target.value)}
          />
          <span>até</span>
          <input
            type="time"
            className="entrada"
            aria-label={`${rotulo}: fim`}
            value={l.fim}
            onChange={(e) => mudar(l.chave, 'fim', e.target.value)}
          />
          <button
            type="button"
            className="botao botao--icone botao--perigo"
            aria-label={`Remover horário (${rotulo})`}
            onClick={() => editar((ls) => ls.filter((x) => x.chave !== l.chave))}
          >
            ×
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="botao botao--pequeno"
          aria-label={`Adicionar horário (${rotulo})`}
          onClick={() => editar((ls) => [...ls, comChave({ diaSemana: dia, inicio: '', fim: '' })])}
        >
          + Horário
        </button>
      </div>
    </div>
  );
}
