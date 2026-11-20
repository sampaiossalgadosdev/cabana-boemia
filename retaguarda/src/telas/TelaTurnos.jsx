import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { DIAS_SEMANA } from '../lib/formatar.js';
import { gravarEmOrdem, ordenarTurnos, prepararGravacao } from '../lib/turnos.js';
import { Campo, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

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
        {({ turnos }) => (
          <>
            <ListaTurnos turnos={turnos} aoMudar={carga.recarregar} />
            {turnos.length > 0 && <TabelaHorarios turnos={turnos} aoSalvar={carga.recarregar} />}
          </>
        )}
      </EstadoCarga>
    </>
  );
}

/**
 * Turnos da loja: criar, renomear e desativar. Desativado não abre a loja nem
 * entra no cardápio; os horários ficam guardados para religar.
 */
function ListaTurnos({ turnos, aoMudar }) {
  const avisar = useAvisar();
  const [editando, setEditando] = useState(null); // turno | 'novo'
  const ordenados = useMemo(() => ordenarTurnos(turnos), [turnos]);

  async function alternar(t, ativo) {
    try {
      await api.turnos.alterar(t.id, { ativo });
      avisar(ativo ? `${t.nome} ativado.` : `${t.nome} desativado: não abre a loja até ser ativado de novo.`);
    } catch (err) {
      avisar(err.message, 'erro');
    }
    await aoMudar();
  }

  return (
    <section className="cartao" style={{ marginBottom: 16 }}>
      <div className="cartao__topo">
        <h2 className="cartao__titulo">Turnos</h2>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
          + Novo turno
        </button>
      </div>
      {ordenados.length === 0 ? (
        <p className="estado">Nenhum turno ainda. Crie o primeiro (ex.: Almoço, Lanches) e depois defina os horários.</p>
      ) : (
        <table className="tabela">
          <thead>
            <tr>
              <th>Turno</th>
              <th>Ativo</th>
              <th className="fim">
                <span className="visualmente-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((t) => (
              <tr key={t.id} className={t.ativo ? undefined : 'linha--inativa'}>
                <td className="produto-nome">{t.nome}</td>
                <td>
                  <Interruptor ligado={t.ativo} aoMudar={(v) => alternar(t, v)} rotulo={`${t.nome} ativo`} ocultarRotulo />
                </td>
                <td className="fim">
                  <button type="button" className="botao botao--pequeno" onClick={() => setEditando(t)}>
                    Renomear
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <FormTurno
        turno={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (mensagem) => {
          setEditando(null);
          avisar(mensagem);
          await aoMudar();
        }}
      />
    </section>
  );
}

function FormTurno({ turno, aoFechar, aoSalvar }) {
  const novo = turno === 'novo';
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setNome(turno && !novo ? turno.nome : '');
    setErro('');
    setSalvando(false);
  }, [turno, novo]);

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo) {
      setErro('Informe o nome do turno');
      return;
    }
    setSalvando(true);
    try {
      if (novo) await api.turnos.criar(limpo);
      else await api.turnos.alterar(turno.id, { nome: limpo });
      await aoSalvar(novo ? `Turno ${limpo} criado. Agora defina os horários.` : 'Turno renomeado.');
    } catch (err) {
      setErro(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(turno)}
      titulo={novo ? 'Novo turno' : 'Renomear turno'}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <Campo rotulo="Nome" erro={erro} ajuda="Ex.: Almoço, Lanches, Café da manhã">
        {(id, desc) => (
          <input
            id={id}
            className="entrada"
            value={nome}
            maxLength={40}
            autoFocus
            aria-invalid={Boolean(erro) || undefined}
            aria-describedby={desc}
            onChange={(e) => setNome(e.target.value)}
          />
        )}
      </Campo>
    </Dialogo>
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
