import { useState } from 'react';
import { api } from '../lib/api.js';
import { errosPorCampo, moverNaOrdem } from '../lib/formatar.js';
import { Campo, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/** Categorias: criar, renomear, ordem e ativar/desativar (sem excluir). */
export function TelaCategorias() {
  const carga = useCarregar(() => api.categorias.listar());
  const [editando, setEditando] = useState(null); // categoria | 'nova'
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAvisar();

  async function executar(fn, mensagem) {
    setOcupado(true);
    try {
      await fn();
      if (mensagem) avisar(mensagem);
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      await carga.recarregar();
      setOcupado(false);
    }
  }

  const mover = (categorias, id, direcao) =>
    executar(async () => {
      for (const m of moverNaOrdem(categorias, id, direcao)) await api.categorias.alterar(m.id, { ordem: m.ordem });
    });

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Categorias</h1>
          <p className="pagina__sub">A ordem daqui é a do site e do PDV. Categoria desativada some dos dois com seus produtos.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('nova')}>
          + Nova categoria
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {({ categorias }) => (
          <section className="cartao tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Categoria</th>
                  <th className="num">Produtos</th>
                  <th>Ativa</th>
                  <th className="fim">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c, i) => (
                  <tr key={c.id} className={c.ativo ? undefined : 'linha--inativa'}>
                    <td>
                      <div className="acoes" style={{ flexWrap: 'nowrap', gap: 4 }}>
                        <button
                          type="button"
                          className="botao botao--icone"
                          aria-label={`Subir ${c.nome}`}
                          disabled={ocupado || i === 0}
                          onClick={() => mover(categorias, c.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="botao botao--icone"
                          aria-label={`Descer ${c.nome}`}
                          disabled={ocupado || i === categorias.length - 1}
                          onClick={() => mover(categorias, c.id, +1)}
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td className="produto-nome">{c.nome}</td>
                    <td className="num">{c.quantidadeProdutos}</td>
                    <td>
                      <Interruptor
                        ligado={c.ativo}
                        desabilitado={ocupado}
                        rotulo={`${c.nome} ativa`}
                        ocultarRotulo
                        aoMudar={(ativo) =>
                          executar(
                            () => api.categorias.alterar(c.id, { ativo }),
                            ativo ? `${c.nome} ativada.` : `${c.nome} desativada: saiu do site e do PDV.`,
                          )
                        }
                      />
                    </td>
                    <td className="fim">
                      <button type="button" className="botao botao--pequeno" onClick={() => setEditando(c)}>
                        Renomear
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!categorias.length && <div className="tabela-vazia">Nenhuma categoria.</div>}
          </section>
        )}
      </EstadoCarga>
      <FormCategoria
        categoria={editando}
        proximaOrdem={((carga.dados?.categorias.at(-1)?.ordem ?? 0) + 10)}
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

function FormCategoria({ categoria, proximaOrdem, aoFechar, aoSalvar }) {
  const nova = categoria === 'nova';
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberta, setAberta] = useState(null);
  if (categoria !== aberta) {
    setAberta(categoria);
    setNome(categoria && !nova ? categoria.nome : '');
    setErro('');
    setSalvando(false);
  }

  async function salvar() {
    if (!nome.trim()) {
      setErro('Informe o nome');
      return;
    }
    setSalvando(true);
    try {
      if (nova) await api.categorias.criar({ nome: nome.trim(), ordem: proximaOrdem });
      else await api.categorias.alterar(categoria.id, { nome: nome.trim() });
      await aoSalvar(nova ? `Categoria ${nome.trim()} criada.` : 'Categoria renomeada.');
    } catch (err) {
      setErro(errosPorCampo(err).nome ?? err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(categoria)}
      titulo={nova ? 'Nova categoria' : 'Renomear categoria'}
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
      <Campo rotulo="Nome" erro={erro}>
        {(id, d) => (
          <input
            id={id}
            className="entrada"
            maxLength={60}
            autoFocus
            value={nome}
            aria-invalid={Boolean(erro) || undefined}
            aria-describedby={d}
            onChange={(e) => setNome(e.target.value)}
          />
        )}
      </Campo>
      {nova && <p className="suave">Entra no fim da lista; use ↑ ↓ para mudar a posição.</p>}
    </Dialogo>
  );
}
