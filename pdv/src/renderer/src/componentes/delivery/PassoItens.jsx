import { useEffect, useMemo, useState } from 'react';
import { formatarPreco } from '../../lib/formatar.js';
import {
  adicionarProduto,
  alterarQuantidade,
  consolidar,
  definirObservacao,
  estadoDoProduto,
  removerLinha,
  totais,
} from '../../lib/lancamento.js';

/**
 * Passo 2: grade de botões grandes por categoria do turno, carrinho ao lado
 * com quantidade e observação por item. Esgotado fica desabilitado.
 */
export function PassoItens({ cardapio, carregando, erro, linhas, aoMudarLinhas, aoTrocarTurno, aoRecarregar, aoContinuar }) {
  const categorias = cardapio?.categorias ?? [];
  const [categoriaId, setCategoriaId] = useState(null);
  const produtosPorId = useMemo(
    () => new Map(categorias.flatMap((c) => c.produtos).map((p) => [p.id, p])),
    [categorias],
  );

  useEffect(() => {
    if (!categorias.some((c) => c.id === categoriaId)) setCategoriaId(categorias[0]?.id ?? null);
  }, [categorias, categoriaId]);

  const categoria = categorias.find((c) => c.id === categoriaId);
  const { subtotalCentavos } = totais(linhas);
  const fechado = cardapio && !cardapio.turnoAtivo;

  return (
    <div className="passo-itens">
      <section className="grade" aria-label="Produtos">
        <div className="grade__topo">
          {cardapio?.turnos?.length > 1 ? (
            <div className="segmentado" role="group" aria-label="Turno">
              {cardapio.turnos.map((t) => (
                <button key={t.id} type="button" aria-pressed={cardapio.turno?.id === t.id}
                  className={`segmentado__opcao ${cardapio.turno?.id === t.id ? 'segmentado__opcao--ativa' : ''}`}
                  onClick={() => aoTrocarTurno(t.id)}>
                  {t.nome}
                </button>
              ))}
            </div>
          ) : (
            <strong>{cardapio?.turno?.nome}</strong>
          )}
          {fechado && <span className="selo selo--aviso">Loja fechada agora</span>}
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={aoRecarregar}>
            Atualizar estoque
          </button>
        </div>

        {erro && <p className="erro" role="alert">{erro}</p>}

        <div className="abas-categorias" role="tablist">
          {categorias.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === categoriaId}
              className={`aba-categoria ${c.id === categoriaId ? 'aba-categoria--ativa' : ''}`}
              onClick={() => setCategoriaId(c.id)}>
              {c.nome}
            </button>
          ))}
        </div>

        {carregando && !categorias.length ? (
          <p className="texto-suave">Carregando cardápio…</p>
        ) : !categorias.length ? (
          <p className="texto-suave">Nenhum produto neste turno.</p>
        ) : (
          <div className="grade__botoes" role="tabpanel">
            {categoria?.produtos.map((p) => {
              const e = estadoDoProduto(p, linhas);
              return (
                <button key={p.id} type="button" className={`produto-botao ${e.desabilitado ? 'produto-botao--esgotado' : ''}`}
                  disabled={e.desabilitado}
                  onClick={() => aoMudarLinhas(adicionarProduto(linhas, p))}
                  aria-label={`${p.nome}, ${formatarPreco(p.precoCentavos)}${e.motivo ? `, ${e.motivo}` : ''}`}>
                  <span className="produto-botao__nome">{p.nome}</span>
                  <span className="produto-botao__preco">{formatarPreco(p.precoCentavos)}</span>
                  {e.motivo && <span className="produto-botao__selo">{e.motivo}</span>}
                  {!e.motivo && e.restam != null && e.restam <= 5 && (
                    <span className="produto-botao__restam">restam {e.restam}</span>
                  )}
                  {e.foraDeHoje && <span className="produto-botao__fora">fora de hoje</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="carrinho" aria-label="Itens do pedido">
        <h3>Itens</h3>
        {linhas.length === 0 ? (
          <p className="texto-suave">Toque nos produtos para adicionar.</p>
        ) : (
          <ul className="carrinho__linhas">
            {linhas.map((l) => (
              <li key={l.chave} className="linha">
                <div className="linha__topo">
                  <div className="qtd" role="group" aria-label={`Quantidade de ${l.nome}`}>
                    <button type="button" aria-label="Menos um"
                      onClick={() => aoMudarLinhas(alterarQuantidade(linhas, l.chave, -1))}>−</button>
                    <span aria-live="polite">{l.quantidade}</span>
                    <button type="button" aria-label="Mais um"
                      onClick={() => aoMudarLinhas(alterarQuantidade(linhas, l.chave, +1, produtosPorId.get(l.produtoId)))}>+</button>
                  </div>
                  <span className="linha__nome">{l.nome}</span>
                  <span className="linha__total">{formatarPreco(l.precoCentavos * l.quantidade)}</span>
                  <button type="button" className="linha__remover" aria-label={`Remover ${l.nome}`}
                    onClick={() => aoMudarLinhas(removerLinha(linhas, l.chave))}>×</button>
                </div>
                <input className="linha__obs" placeholder="Observação (ex.: sem cebola)" maxLength={140}
                  value={l.observacao} aria-label={`Observação de ${l.nome}`}
                  onChange={(e) => aoMudarLinhas(definirObservacao(linhas, l.chave, e.target.value))}
                  onBlur={() => aoMudarLinhas(consolidar(linhas))} />
              </li>
            ))}
          </ul>
        )}
        <div className="carrinho__rodape">
          <span>Subtotal</span>
          <strong>{formatarPreco(subtotalCentavos)}</strong>
        </div>
        <button type="button" className="botao botao--largo" disabled={!linhas.length}
          onClick={() => {
            aoMudarLinhas(consolidar(linhas));
            aoContinuar();
          }}>
          Continuar → Pagamento
        </button>
      </aside>
    </div>
  );
}
