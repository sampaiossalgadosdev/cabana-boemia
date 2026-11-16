import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { formatarPeso, formatarPreco } from '../../lib/formatar.js';
import { idParaRemover, tempoAberta } from '../../lib/salao.js';
import { agruparItens } from '@restaurante/shared/itens';
import { TecladoPeso } from './TecladoPeso.jsx';
import { FecharConta } from './FecharConta.jsx';

/**
 * Uma comanda aberta: "Prato por kg" (teclado de gramas), grade de produtos
 * do turno e a lista de itens com remover. Cada toque LANÇA na hora (a API
 * baixa o estoque no lançamento); os lançamentos vão em fila, um por vez,
 * para a tela mostrar sempre o estado mais novo da comanda.
 */
export function ComandaAberta({ comanda, agora, aoMudar, aoFechada, aoVoltar }) {
  const [cardapio, setCardapio] = useState(null);
  const [turnoId, setTurnoId] = useState(null);
  const [categoriaId, setCategoriaId] = useState(null);
  const [erroCardapio, setErroCardapio] = useState('');
  const [teclado, setTeclado] = useState(null); // produto por kg
  const [fechando, setFechando] = useState(false);
  const [pendentes, setPendentes] = useState(0);
  const [erro, setErro] = useState('');
  const [confirmarRemocao, setConfirmarRemocao] = useState(null); // itemId | 'comanda'
  const [removendo, setRemovendo] = useState(false);
  const fila = useRef(Promise.resolve());

  const carregarCardapio = useCallback(async (id) => {
    try {
      const c = await chamar(pdv.cardapio.obter(id));
      setCardapio(c);
      setErroCardapio('');
    } catch (err) {
      setErroCardapio(err.message);
    }
  }, []);

  useEffect(() => {
    carregarCardapio(turnoId);
  }, [turnoId, carregarCardapio]);

  // A retaguarda mudou produtos, preços, estoque ou turnos: recarrega a grade.
  useEffect(() => pdv.aoEvento('cardapio:atualizado', () => carregarCardapio(turnoId)), [turnoId, carregarCardapio]);

  const categorias = cardapio?.categorias ?? [];
  useEffect(() => {
    if (!categorias.some((c) => c.id === categoriaId)) setCategoriaId(categorias[0]?.id ?? null);
  }, [categorias, categoriaId]);
  const categoria = categorias.find((c) => c.id === categoriaId);

  // Esc volta para a grade de comandas (com teclado/fechamento abertos, o <dialog> trata).
  useEffect(() => {
    function aoTeclar(e) {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.target.closest?.('.campo-tempo')) return;
      e.preventDefault();
      if (confirmarRemocao) setConfirmarRemocao(null);
      else aoVoltar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoVoltar, confirmarRemocao]);

  function tratarErro(err) {
    setErro(err.message);
    if (['ESTOQUE_INSUFICIENTE', 'PRODUTO_INDISPONIVEL'].includes(err.codigo)) carregarCardapio(turnoId);
    // Outra atendente fechou/cancelou: a comanda some da grade.
    if (err.codigo === 'PEDIDO_ENCERRADO' || err.status === 404) aoFechada(null, err.message);
  }

  /** Enfileira o lançamento; devolve a promessa (o teclado espera para fechar). */
  function lancar(item) {
    setErro('');
    setPendentes((n) => n + 1);
    const tarefa = fila.current.then(async () => {
      try {
        const { comanda: atual } = await chamar(pdv.comandas.lancarItem(comanda.id, item));
        aoMudar(atual);
        carregarCardapio(turnoId); // saldo da grade
      } finally {
        setPendentes((n) => n - 1);
      }
    });
    fila.current = tarefa.catch(() => {});
    return tarefa;
  }

  const lancarProduto = (p) => lancar({ produtoId: p.id, quantidade: 1 }).catch(tratarErro);

  async function remover(itemId) {
    setRemovendo(true);
    setErro('');
    try {
      await fila.current;
      const { comanda: atual } = await chamar(pdv.comandas.removerItem(comanda.id, itemId));
      aoMudar(atual);
      carregarCardapio(turnoId);
      setConfirmarRemocao(null);
    } catch (err) {
      tratarErro(err);
    } finally {
      setRemovendo(false);
    }
  }

  async function excluirComanda() {
    setRemovendo(true);
    try {
      const { pedido } = await chamar(pdv.pedidos.cancelar(comanda.id));
      aoFechada(pedido, `Comanda de ${comanda.nomeCliente} excluída.`);
    } catch (err) {
      tratarErro(err);
      setRemovendo(false);
    }
  }

  async function fechar(dados) {
    await fila.current;
    const { comanda: fechada } = await chamar(pdv.comandas.fechar(comanda.id, dados));
    const conta = dados.imprimirConta ? ' Conta enviada para a impressora.' : '';
    aoFechada(fechada, `Comanda de ${fechada.nomeCliente} fechada: ${formatarPreco(fechada.totalCentavos)}.${conta}`);
  }

  const porKg = cardapio?.porKg ?? [];
  const vazia = comanda.itens.length === 0;

  return (
    <div className="comanda">
      <section className="grade comanda__grade" aria-label="Lançar itens">
        <div className="grade__topo">
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={aoVoltar}>
            ← Comandas <kbd>Esc</kbd>
          </button>
          {cardapio?.turnos?.length > 1 && (
            <div className="segmentado" role="group" aria-label="Turno">
              {cardapio.turnos.map((t) => (
                <button key={t.id} type="button" aria-pressed={cardapio.turno?.id === t.id}
                  className={`segmentado__opcao ${cardapio.turno?.id === t.id ? 'segmentado__opcao--ativa' : ''}`}
                  onClick={() => setTurnoId(t.id)}>
                  {t.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        {erroCardapio && <p className="erro" role="alert">Cardápio: {erroCardapio}</p>}

        {porKg.length > 0 ? (
          <div className="comanda__kg">
            {porKg.map((p) => (
              <button key={p.id} type="button" className="botao-kg" onClick={() => setTeclado(p)}>
                <span className="botao-kg__nome">{p.nome}</span>
                <span className="botao-kg__preco">{formatarPreco(p.precoCentavos)}/kg</span>
              </button>
            ))}
          </div>
        ) : (
          cardapio?.turno?.nome === 'Almoço' && (
            <p className="aviso">Prato por kg sem preço ou inativo: o dono precisa definir o preço do quilo.</p>
          )
        )}

        <div className="abas-categorias" role="tablist">
          {categorias.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === categoriaId}
              className={`aba-categoria ${c.id === categoriaId ? 'aba-categoria--ativa' : ''}`}
              onClick={() => setCategoriaId(c.id)}>
              {c.nome}
            </button>
          ))}
        </div>

        {!cardapio ? (
          <p className="texto-suave">Carregando cardápio…</p>
        ) : (
          <div className="grade__botoes" role="tabpanel">
            {categoria?.produtos.map((p) => (
              <button key={p.id} type="button" className={`produto-botao ${p.esgotado ? 'produto-botao--esgotado' : ''}`}
                disabled={p.esgotado} onClick={() => lancarProduto(p)}
                aria-label={`${p.nome}, ${formatarPreco(p.precoCentavos)}${p.esgotado ? ', esgotado' : ''}`}>
                <span className="produto-botao__nome">{p.nome}</span>
                <span className="produto-botao__preco">{formatarPreco(p.precoCentavos)}</span>
                {p.esgotado && <span className="produto-botao__selo">Esgotado</span>}
                {!p.esgotado && p.saldo != null && p.saldo <= 5 && (
                  <span className="produto-botao__restam">restam {p.saldo}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="carrinho comanda__painel" aria-label={`Comanda de ${comanda.nomeCliente}`}>
        <header className="comanda__cabecalho">
          <h2>{comanda.nomeCliente}</h2>
          <span className="texto-suave">
            #{comanda.numeroDia}
            {comanda.mesaRotulo ? ` · Mesa ${comanda.mesaRotulo}` : ''} · aberta há {tempoAberta(comanda.criadoEm, agora)}
          </span>
        </header>

        {erro && <p className="erro" role="alert">{erro}</p>}

        {vazia ? (
          <p className="texto-suave">Nenhum item. Toque no prato ou nos produtos para lançar.</p>
        ) : (
          <ul className="carrinho__linhas">
            {/* Um ItemPedido por toque no banco; aqui "4× Refrigerante Lata". O × tira um
                (o lançamento mais recente da linha), com confirmação. */}
            {agruparItens(comanda.itens).map((l) => (
              <li key={l.ids[0]} className="linha">
                {confirmarRemocao === l.ids[0] ? (
                  <div className="linha__topo comanda__confirmar">
                    <span className="linha__nome">Remover {l.ids.length > 1 ? `1 ${l.nome}` : l.nome}?</span>
                    <button type="button" className="botao botao--contorno botao--pequeno" disabled={removendo}
                      onClick={() => setConfirmarRemocao(null)} autoFocus>Não</button>
                    <button type="button" className="botao botao--perigo botao--pequeno" disabled={removendo}
                      onClick={() => remover(idParaRemover(l))}>{removendo ? '…' : 'Remover'}</button>
                  </div>
                ) : (
                  <div className="linha__topo">
                    <span className="item__qtd">{l.pesoGramas ? formatarPeso(l.pesoGramas) : `${l.quantidade}×`}</span>
                    <span className="linha__nome">{l.nome}</span>
                    <span className="linha__total">{formatarPreco(l.totalCentavos)}</span>
                    <button type="button" className="linha__remover"
                      aria-label={l.ids.length > 1 ? `Remover um ${l.nome}` : `Remover ${l.nome}`}
                      onClick={() => setConfirmarRemocao(l.ids[0])}>×</button>
                  </div>
                )}
                {l.observacao && <p className="item__obs">{l.observacao}</p>}
              </li>
            ))}
          </ul>
        )}

        <div className="carrinho__rodape comanda__total">
          <span>Total{pendentes > 0 ? ' (lançando…)' : ''}</span>
          <strong>{formatarPreco(comanda.totalCentavos)}</strong>
        </div>

        {vazia ? (
          confirmarRemocao === 'comanda' ? (
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno" disabled={removendo}
                onClick={() => setConfirmarRemocao(null)}>Não</button>
              <button type="button" className="botao botao--perigo" disabled={removendo} onClick={excluirComanda}>
                {removendo ? 'Excluindo…' : 'Sim, excluir'}
              </button>
            </div>
          ) : (
            <button type="button" className="botao botao--contorno botao--largo" disabled={pendentes > 0}
              onClick={() => setConfirmarRemocao('comanda')}>
              Excluir comanda vazia
            </button>
          )
        ) : (
          <button type="button" className="botao botao--grande botao--largo" disabled={pendentes > 0}
            onClick={() => setFechando(true)}>
            Fechar conta
          </button>
        )}
      </aside>

      {teclado && (
        <TecladoPeso produto={teclado} aoFechar={() => setTeclado(null)}
          aoLancar={(pesoGramas) =>
            lancar({ produtoId: teclado.id, pesoGramas }).catch((err) => {
              if (err.codigo === 'PEDIDO_ENCERRADO' || err.status === 404) tratarErro(err);
              throw err;
            })
          } />
      )}
      {fechando && <FecharConta comanda={comanda} aoConfirmar={fechar} aoFechar={() => setFechando(false)} />}
    </div>
  );
}
