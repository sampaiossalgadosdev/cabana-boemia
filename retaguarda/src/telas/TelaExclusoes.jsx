import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarDataHora } from '../lib/formatar.js';
import { Confirmar, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Plataforma (só ADMIN): pedidos de exclusão de conta enviados pela página
 * pública /excluir-conta (link do Google Play). Atendidos à mão: achar a conta
 * pelo e-mail ou celular, excluir e marcar como atendido aqui.
 */
export function TelaExclusoes() {
  const carga = useCarregar(() => api.plataforma.solicitacoes.listar());
  const [confirmar, setConfirmar] = useState(null);
  const avisar = useAvisar();

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Exclusão de contas</h1>
          <p className="pagina__sub">
            Pedidos da página /excluir-conta. Quem pede pelo app exclui a conta sozinho; estes chegam pelo formulário e são atendidos à mão.
          </p>
        </div>
      </div>
      <EstadoCarga carga={carga}>
        {({ pendentes, atendidas }) => (
          <>
            <section className="cartao tabela-rolagem">
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Pendentes ({pendentes.length})</h2>
              </div>
              {pendentes.length === 0 ? (
                <p className="estado">Nenhum pedido pendente.</p>
              ) : (
                <TabelaSolicitacoes
                  linhas={pendentes}
                  acao={(s) => (
                    <button
                      type="button"
                      className="botao botao--pequeno botao--primario"
                      onClick={() =>
                        setConfirmar({
                          titulo: 'Marcar como atendida?',
                          texto: `Confirme que a conta de ${s.nome || s.email || s.telefone} foi excluída (ou que não existe) e a pessoa foi avisada.`,
                          confirmar: 'Marcar como atendida',
                          acao: async () => {
                            await api.plataforma.solicitacoes.atender(s.id);
                            avisar('Solicitação marcada como atendida.');
                            await carga.recarregar();
                          },
                        })
                      }
                    >
                      Marcar como atendida
                    </button>
                  )}
                />
              )}
            </section>
            {atendidas.length > 0 && (
              <section className="cartao tabela-rolagem" style={{ marginTop: 16 }}>
                <div className="cartao__topo">
                  <h2 className="cartao__titulo">Atendidas (últimas {atendidas.length})</h2>
                </div>
                <TabelaSolicitacoes linhas={atendidas} acao={(s) => <span className="suave">{formatarDataHora(s.atendidaEm)}</span>} />
              </section>
            )}
          </>
        )}
      </EstadoCarga>
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}

function TabelaSolicitacoes({ linhas, acao }) {
  return (
    <table className="tabela">
      <thead>
        <tr>
          <th>Pedido em</th>
          <th>Nome</th>
          <th>Contato</th>
          <th>Mensagem</th>
          <th className="fim">
            <span className="visualmente-oculto">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((s) => (
          <tr key={s.id}>
            <td>{formatarDataHora(s.criadoEm)}</td>
            <td>{s.nome || <span className="suave">—</span>}</td>
            <td>
              {s.email && <div>{s.email}</div>}
              {s.telefone && <div>{s.telefone}</div>}
            </td>
            <td style={{ maxWidth: 320, whiteSpace: 'normal' }}>{s.mensagem || <span className="suave">—</span>}</td>
            <td className="fim">{acao(s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
