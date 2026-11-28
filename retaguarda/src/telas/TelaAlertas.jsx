import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatarDataHora } from '../lib/formatar.js';
import { Confirmar, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';
import { ALERTAS_DE_PAGAMENTO } from '../lib/pagamentosAdmin.js';

/** Nome de cada tipo de alerta (as próximas etapas acrescentam tipos). */
export const TIPOS_ALERTA = {
  RENOVACAO_MP_FALHOU: 'Mercado Pago não renovou',
  PAGAMENTO_DIVERGENTE: 'Pagamento não confere',
  PAGO_APOS_EXPIRAR: 'Pago depois de expirar',
  MP_DESVINCULADA: 'Conta Mercado Pago desvinculada',
  TAXA_ENTREGA_COMPLEMENTO: 'Taxa acima de 50%',
  PIX_FALHANDO: 'Pix falhando',
  LOJA_SEM_LOCALIZACAO: 'Loja sem localização',
  REEMBOLSO_FALHOU: 'Reembolso pendente',
  CHARGEBACK: 'Contestação (chargeback)',
  ESTORNO_EXTERNO: 'Estornado fora do Taaki',
  PEDIDO_SEM_ACEITE: 'Pedido sem aceite da loja',
  FECHAMENTO_ATRASADO: 'Fechamento atrasado',
  PAGAMENTO_CONTA_DESCONECTADA: 'Pagamento em conta desconectada',
};

/**
 * Plataforma (só ADMIN): alertas que pedem ação (ex.: a conexão do Mercado Pago de uma
 * loja não renovou). Resolvidos à mão: o ADMIN age e marca como resolvido.
 */
export function TelaAlertas({ aoMudarLoja, ir }) {
  const carga = useCarregar(() => api.plataforma.alertas.listar());
  const [confirmar, setConfirmar] = useState(null);
  const avisar = useAvisar();

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Alertas</h1>
          <p className="pagina__sub">Situações que pedem ação da plataforma. Resolva e marque como resolvido.</p>
        </div>
      </div>
      <EstadoCarga carga={carga}>
        {({ abertos, resolvidos }) => (
          <>
            <section className="cartao tabela-rolagem">
              <div className="cartao__topo">
                <h2 className="cartao__titulo">Abertos ({abertos.length})</h2>
              </div>
              {abertos.length === 0 ? (
                <p className="estado">Nenhum alerta aberto.</p>
              ) : (
                <TabelaAlertas
                  linhas={abertos}
                  acao={(a) => (
                    <div className="acoes">
                    {ALERTAS_DE_PAGAMENTO.includes(a.tipo) && ir && (
                      <button type="button" className="botao botao--pequeno" onClick={() => ir('pagamentos')}>
                        Pagamentos online
                      </button>
                    )}
                    {(a.tipo === 'FECHAMENTO_ATRASADO' || a.tipo === 'TAXA_ENTREGA_COMPLEMENTO') && ir && (
                      <button type="button" className="botao botao--pequeno" onClick={() => ir('financeiro')}>
                        Financeiro
                      </button>
                    )}
                    <button
                      type="button"
                      className="botao botao--pequeno botao--primario"
                      onClick={() =>
                        setConfirmar({
                          titulo: 'Marcar como resolvido?',
                          texto: `Confirme que o alerta${a.loja ? ` da loja ${a.loja.nome}` : ''} foi resolvido.`,
                          confirmar: 'Marcar como resolvido',
                          acao: async () => {
                            await api.plataforma.alertas.resolver(a.id);
                            avisar('Alerta marcado como resolvido.');
                            await carga.recarregar();
                            aoMudarLoja?.(null); // atualiza o contador do menu
                          },
                        })
                      }
                    >
                      Marcar como resolvido
                    </button>
                    </div>
                  )}
                />
              )}
            </section>
            {resolvidos.length > 0 && (
              <section className="cartao tabela-rolagem" style={{ marginTop: 16 }}>
                <div className="cartao__topo">
                  <h2 className="cartao__titulo">Resolvidos (últimos {resolvidos.length})</h2>
                </div>
                <TabelaAlertas
                  linhas={resolvidos}
                  acao={(a) => (
                    <span className="suave">
                      {formatarDataHora(a.resolvidoEm)}
                      {a.resolvidoPor && ` · ${a.resolvidoPor}`}
                    </span>
                  )}
                />
              </section>
            )}
          </>
        )}
      </EstadoCarga>
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}

function TabelaAlertas({ linhas, acao }) {
  return (
    <table className="tabela">
      <thead>
        <tr>
          <th>Quando</th>
          <th>Tipo</th>
          <th>Loja</th>
          <th>O que aconteceu</th>
          <th className="fim">
            <span className="visualmente-oculto">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((a) => (
          <tr key={a.id}>
            <td>{formatarDataHora(a.criadoEm)}</td>
            <td>{TIPOS_ALERTA[a.tipo] ?? a.tipo}</td>
            <td>{a.loja?.nome ?? <span className="suave">—</span>}</td>
            <td style={{ maxWidth: 420, whiteSpace: 'normal' }}>
              {a.mensagem}
              {a.pedidoId && <span className="suave"> · pedido {a.pedidoId}</span>}
            </td>
            <td className="fim">{acao(a)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
