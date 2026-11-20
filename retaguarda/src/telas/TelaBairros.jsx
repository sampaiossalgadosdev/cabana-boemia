import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import { errosPorCampo } from '../lib/formatar.js';
import { Campo, CampoDinheiro, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Bairros e taxas. Os bairros são da lista da cidade (cadastrada pelo ADMIN);
 * aqui o dono escolhe onde a loja entrega e por quanto. Desativar tira o bairro
 * do site e do PDV desta loja. O ADMIN também edita a lista da cidade.
 */
export function TelaBairros({ usuario }) {
  const carga = useCarregar(() => api.bairros.listar());
  const [editando, setEditando] = useState(null); // área | 'novo'
  const avisar = useAvisar();

  async function alternar(b, ativo) {
    try {
      await api.bairros.alterar(b.id, { ativo });
      avisar(ativo ? `${b.nome} ativado.` : `${b.nome} desativado: não aparece mais no site.`);
    } catch (err) {
      avisar(err.message, 'erro');
    }
    await carga.recarregar();
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Bairros e taxas</h1>
          <p className="pagina__sub">
            Onde a loja entrega. A taxa vale para pedidos novos; pedidos já feitos guardam a taxa da época.
          </p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
          + Adicionar bairro
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {({ bairros }) => (
          <section className="cartao tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Bairro</th>
                  <th className="num">Taxa de entrega</th>
                  <th>Ativo</th>
                  <th className="fim">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bairros.map((b) => (
                  <tr key={b.id} className={b.ativo && b.ativoNaCidade ? undefined : 'linha--inativa'}>
                    <td className="produto-nome">
                      {b.nome}
                      {!b.ativoNaCidade && <span className="etiqueta">Desativado na cidade</span>}
                    </td>
                    <td className="num">{b.taxaCentavos ? formatarReais(b.taxaCentavos) : 'Grátis'}</td>
                    <td>
                      <Interruptor ligado={b.ativo} rotulo={`${b.nome} ativo`} ocultarRotulo aoMudar={(v) => alternar(b, v)} />
                    </td>
                    <td className="fim">
                      <button type="button" className="botao botao--pequeno" onClick={() => setEditando(b)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!bairros.length && <div className="tabela-vazia">Nenhum bairro na área de entrega.</div>}
          </section>
        )}
      </EstadoCarga>
      <FormArea
        area={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (mensagem) => {
          setEditando(null);
          avisar(mensagem);
          await carga.recarregar();
        }}
      />
      {usuario?.papel === 'ADMIN' && (
        <BairrosDaCidade aoMudar={() => carga.recarregar()} />
      )}
    </>
  );
}

/** Adicionar (bairro da lista da cidade + taxa) ou editar a taxa de um bairro da área. */
function FormArea({ area, aoFechar, aoSalvar }) {
  const novo = area === 'novo';
  const [bairroId, setBairroId] = useState('');
  const [opcoes, setOpcoes] = useState(null);
  const [taxa, setTaxa] = useState(null);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(null);
  if (area !== aberto) {
    setAberto(area);
    setBairroId('');
    setOpcoes(null);
    setTaxa(area && !novo ? area.taxaCentavos : null);
    setErros({});
    setErroGeral('');
    setSalvando(false);
    if (novo) {
      api.bairros
        .daCidade()
        .then(({ bairros }) => setOpcoes(bairros))
        .catch((err) => setErroGeral(err.message));
    }
  }

  async function salvar() {
    const e = {};
    if (novo && !bairroId) e.bairroId = 'Escolha o bairro';
    if (taxa == null) e.taxaCentavos = 'Taxa inválida (use 0 para grátis)';
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    setErroGeral('');
    try {
      if (novo) {
        const { bairro } = await api.bairros.criar({ bairroId: Number(bairroId), taxaCentavos: taxa });
        await aoSalvar(`${bairro.nome} adicionado à área de entrega.`);
      } else {
        await api.bairros.alterar(area.id, { taxaCentavos: taxa });
        await aoSalvar(`${area.nome} salvo.`);
      }
    } catch (err) {
      setErros(errosPorCampo(err));
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(area)}
      titulo={novo ? 'Adicionar bairro' : `Taxa de ${area?.nome ?? ''}`}
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
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      {novo && (
        <Campo rotulo="Bairro" ajuda="Lista da cidade. Bairro que não aparece: peça ao administrador da plataforma." erro={erros.bairroId}>
          {(id, d) => (
            <select
              id={id}
              className="entrada"
              autoFocus
              value={bairroId}
              aria-describedby={d}
              disabled={!opcoes}
              onChange={(e) => {
                setBairroId(e.target.value);
                setErros((x) => ({ ...x, bairroId: undefined }));
              }}
            >
              <option value="">{opcoes ? (opcoes.length ? 'Escolha o bairro' : 'Todos os bairros já estão na área') : 'Carregando…'}</option>
              {(opcoes ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
            </select>
          )}
        </Campo>
      )}
      <Campo rotulo="Taxa de entrega (R$)" erro={erros.taxaCentavos}>
        {(id, d) => (
          <CampoDinheiro
            id={id}
            valor={taxa}
            descritoPor={d}
            aoMudar={(c) => {
              setTaxa(c);
              setErros((x) => ({ ...x, taxaCentavos: undefined }));
            }}
          />
        )}
      </Campo>
    </Dialogo>
  );
}

/** Só ADMIN: a lista única de bairros da cidade, usada por todas as lojas. */
function BairrosDaCidade({ aoMudar }) {
  const carga = useCarregar(() => api.plataforma.bairros.listar());
  const [editando, setEditando] = useState(null); // bairro | 'novo'
  const avisar = useAvisar();

  async function alternar(b, ativo) {
    try {
      await api.plataforma.bairros.alterar(b.id, { ativo });
      avisar(ativo ? `${b.nome} ativado na cidade.` : `${b.nome} desativado: nenhuma loja entrega lá.`);
    } catch (err) {
      avisar(err.message, 'erro');
    }
    await carga.recarregar();
    await aoMudar();
  }

  return (
    <>
      <div className="pagina__topo" style={{ marginTop: 32 }}>
        <div>
          <h2 className="pagina__titulo">Bairros da cidade</h2>
          <p className="pagina__sub">Só o administrador vê. Lista única usada por todas as lojas e pelos endereços dos clientes.</p>
        </div>
        <button type="button" className="botao" onClick={() => setEditando('novo')}>
          + Novo bairro na cidade
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {({ bairros }) => (
          <section className="cartao tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Bairro</th>
                  <th className="num">Lojas que entregam</th>
                  <th className="num">Endereços</th>
                  <th>Ativo</th>
                  <th className="fim">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bairros.map((b) => (
                  <tr key={b.id} className={b.ativo ? undefined : 'linha--inativa'}>
                    <td className="produto-nome">{b.nome}</td>
                    <td className="num">{b.lojas}</td>
                    <td className="num">{b.enderecos}</td>
                    <td>
                      <Interruptor ligado={b.ativo} rotulo={`${b.nome} ativo na cidade`} ocultarRotulo aoMudar={(v) => alternar(b, v)} />
                    </td>
                    <td className="fim">
                      <button type="button" className="botao botao--pequeno" onClick={() => setEditando(b)}>
                        Renomear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!bairros.length && <div className="tabela-vazia">Nenhum bairro cadastrado.</div>}
          </section>
        )}
      </EstadoCarga>
      <FormBairroCidade
        bairro={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (mensagem) => {
          setEditando(null);
          avisar(mensagem);
          await carga.recarregar();
          await aoMudar();
        }}
      />
    </>
  );
}

function FormBairroCidade({ bairro, aoFechar, aoSalvar }) {
  const novo = bairro === 'novo';
  const [nome, setNome] = useState('');
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(null);
  if (bairro !== aberto) {
    setAberto(bairro);
    setNome(bairro && !novo ? bairro.nome : '');
    setErros({});
    setErroGeral('');
    setSalvando(false);
  }

  async function salvar() {
    if (!nome.trim()) {
      setErros({ nome: 'Informe o nome' });
      return;
    }
    setSalvando(true);
    setErroGeral('');
    try {
      if (novo) await api.plataforma.bairros.criar({ nome: nome.trim() });
      else await api.plataforma.bairros.alterar(bairro.id, { nome: nome.trim() });
      await aoSalvar(novo ? `${nome.trim()} cadastrado na cidade.` : `${nome.trim()} salvo.`);
    } catch (err) {
      setErros(errosPorCampo(err));
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(bairro)}
      titulo={novo ? 'Novo bairro na cidade' : 'Renomear bairro'}
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
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      <Campo rotulo="Nome" erro={erros.nome}>
        {(id, d) => (
          <input
            id={id}
            className="entrada"
            maxLength={80}
            autoFocus
            value={nome}
            aria-describedby={d}
            onChange={(e) => {
              setNome(e.target.value);
              setErros((x) => ({ ...x, nome: undefined }));
            }}
          />
        )}
      </Campo>
    </Dialogo>
  );
}
