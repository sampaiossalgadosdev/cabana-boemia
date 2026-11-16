import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import { errosPorCampo } from '../lib/formatar.js';
import { Campo, CampoDinheiro, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/** Bairros e taxas de entrega. Desativar tira o bairro do site e do PDV. */
export function TelaBairros() {
  const carga = useCarregar(() => api.bairros.listar());
  const [editando, setEditando] = useState(null); // bairro | 'novo'
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
          <p className="pagina__sub">A taxa vale para pedidos novos; pedidos já feitos guardam a taxa da época.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
          + Novo bairro
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
                  <tr key={b.id} className={b.ativo ? undefined : 'linha--inativa'}>
                    <td className="produto-nome">{b.nome}</td>
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
            {!bairros.length && <div className="tabela-vazia">Nenhum bairro cadastrado.</div>}
          </section>
        )}
      </EstadoCarga>
      <FormBairro
        bairro={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={async (mensagem) => {
          setEditando(null);
          avisar(mensagem);
          await carga.recarregar();
        }}
      />
    </>
  );
}

function FormBairro({ bairro, aoFechar, aoSalvar }) {
  const novo = bairro === 'novo';
  const [nome, setNome] = useState('');
  const [taxa, setTaxa] = useState(null);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(null);
  if (bairro !== aberto) {
    setAberto(bairro);
    setNome(bairro && !novo ? bairro.nome : '');
    setTaxa(bairro && !novo ? bairro.taxaCentavos : null);
    setErros({});
    setErroGeral('');
    setSalvando(false);
  }

  async function salvar() {
    const e = {};
    if (!nome.trim()) e.nome = 'Informe o nome';
    if (taxa == null) e.taxaCentavos = 'Taxa inválida (use 0 para grátis)';
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    setErroGeral('');
    try {
      const dados = { nome: nome.trim(), taxaCentavos: taxa };
      if (novo) await api.bairros.criar(dados);
      else await api.bairros.alterar(bairro.id, dados);
      await aoSalvar(novo ? `${dados.nome} criado.` : `${dados.nome} salvo.`);
    } catch (err) {
      setErros(errosPorCampo(err));
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(bairro)}
      titulo={novo ? 'Novo bairro' : 'Editar bairro'}
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
