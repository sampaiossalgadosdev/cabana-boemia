import { useEffect, useMemo, useRef, useState } from 'react';
import { formatarPreco } from '../../lib/formatar.js';
import {
  alterarQuantidade,
  consolidar,
  definirObservacao,
  estadoDoProduto,
  lerReais,
  removerLinha,
} from '../../lib/lancamento.js';
import { adicionarQuantidade, buscarProdutos, definirQuantidade, lerQuantidade } from '../../lib/novoPedido.js';
import { Destaque } from '../Destaque.jsx';
import { IconeLupa, IconeSeta, IconeTeclado, IconeTrocarCliente, IconeVassoura } from '../Icones.jsx';

/** Cores das categorias (só a paleta da marca), em rodízio. */
const CORES_CATEGORIA = ['vermelho', 'dourado', 'preto', 'laranja', 'vermelho-escuro'];
const ROLAGEM_PX = 240;

/**
 * Etapa 4: produtos no estilo PDV. Esquerda: código/nome com autocomplete,
 * quantidade e grade de categorias → produtos. Direita: resumo do pedido
 * (itens editáveis, taxa, desconto, observação, total e "Lançar").
 */
export function EtapaProdutos(props) {
  const { cardapio, carregando, erroCardapio, aoTrocarTurno, aoRecarregar, linhas, aoMudarLinhas } = props;
  const categorias = cardapio?.categorias ?? [];
  const produtosPorId = useMemo(() => new Map(categorias.flatMap((c) => c.produtos).map((p) => [p.id, p])), [categorias]);
  const [categoriaId, setCategoriaId] = useState(null);
  const [aviso, setAviso] = useState('');
  const grade = useRef(null);

  useEffect(() => {
    if (categoriaId != null && !categorias.some((c) => c.id === categoriaId)) setCategoriaId(null);
  }, [categorias, categoriaId]);

  function adicionar(produto, quantidade = 1) {
    const r = adicionarQuantidade(linhas, produto, quantidade);
    aoMudarLinhas(r.linhas);
    if (r.adicionadas < quantidade) {
      setAviso(r.adicionadas ? `Só ${r.adicionadas} de ${produto.nome}: acabou o saldo.` : `${produto.nome}: sem saldo.`);
    } else setAviso('');
    return r.adicionadas;
  }

  const categoria = categorias.find((c) => c.id === categoriaId);
  const rolar = (sentido) => grade.current?.scrollBy({ top: sentido * ROLAGEM_PX, behavior: 'smooth' });

  return (
    <div className="etapa-produtos">
      <section className="etapa-produtos__esquerda" aria-label="Produtos">
        <EntradaProduto categorias={categorias} aoAdicionar={adicionar} />
        {aviso && <p className="aviso" role="status">{aviso}</p>}

        <div className="grade__topo">
          {cardapio?.turnos?.length > 1 ? (
            <div className="segmentado" role="group" aria-label="Turno">
              {cardapio.turnos.map((t) => (
                <button key={t.id} type="button" aria-pressed={cardapio.turno?.id === t.id}
                  className={`segmentado__opcao ${cardapio.turno?.id === t.id ? 'segmentado__opcao--ativa' : ''}`}
                  onClick={() => {
                    setCategoriaId(null);
                    aoTrocarTurno(t.id);
                  }}>
                  {t.nome}
                </button>
              ))}
            </div>
          ) : (
            <strong>{cardapio?.turno?.nome}</strong>
          )}
          {cardapio && !cardapio.turnoAtivo && <span className="selo selo--aviso">Loja fechada agora</span>}
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={aoRecarregar}>Atualizar estoque</button>
        </div>
        {erroCardapio && <p className="erro" role="alert">{erroCardapio}</p>}

        <div className="grade-rolavel">
          <div className="grade-rolavel__conteudo" ref={grade}>
            {carregando && !categorias.length ? (
              <p className="texto-suave">Carregando cardápio…</p>
            ) : !categorias.length ? (
              <p className="texto-suave">Nenhum produto neste turno.</p>
            ) : !categoria ? (
              <div className="grade-categorias">
                {categorias.map((c, i) => (
                  <button key={c.id} type="button" className={`categoria-botao categoria-botao--${CORES_CATEGORIA[i % CORES_CATEGORIA.length]}`}
                    onClick={() => setCategoriaId(c.id)}>
                    {c.nome}
                    <span className="categoria-botao__qtd">{c.produtos.length} itens</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button type="button" className="botao botao--contorno botao--pequeno grade__voltar" onClick={() => setCategoriaId(null)}>
                  ← Categorias · <strong>{categoria.nome}</strong>
                </button>
                <div className="grade__botoes">
                  {categoria.produtos.map((p) => {
                    const e = estadoDoProduto(p, linhas);
                    return (
                      <button key={p.id} type="button" className={`produto-botao ${e.desabilitado ? 'produto-botao--esgotado' : ''}`}
                        disabled={e.desabilitado} onClick={() => adicionar(p)}
                        aria-label={`${p.nome}, ${formatarPreco(p.precoCentavos)}${e.motivo ? `, ${e.motivo}` : ''}`}>
                        <span className="produto-botao__codigo">{p.id}</span>
                        <span className="produto-botao__nome">{p.nome}</span>
                        <span className="produto-botao__preco">{formatarPreco(p.precoCentavos)}</span>
                        {e.motivo && <span className="produto-botao__selo">{e.motivo}</span>}
                        {!e.motivo && e.restam != null && e.restam <= 5 && <span className="produto-botao__restam">restam {e.restam}</span>}
                        {e.foraDeHoje && <span className="produto-botao__fora">fora de hoje</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <div className="grade-rolavel__setas">
            <button type="button" className="botao-icone" onClick={() => rolar(-1)} aria-label="Rolar para cima"><IconeSeta direcao="cima" /></button>
            <button type="button" className="botao-icone" onClick={() => rolar(1)} aria-label="Rolar para baixo"><IconeSeta direcao="baixo" /></button>
          </div>
        </div>
      </section>

      <ResumoPedido {...props} produtosPorId={produtosPorId} />
    </div>
  );
}

/** "PRODUTO (CÓD. REF OU NOME)" com autocomplete + "QTD." + "+". Enter no produto vai para a quantidade; Enter na quantidade adiciona. */
function EntradaProduto({ categorias, aoAdicionar }) {
  const [texto, setTexto] = useState('');
  const [escolhido, setEscolhido] = useState(null);
  const [destaque, setDestaque] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [qtd, setQtd] = useState('1');
  const [erro, setErro] = useState('');
  const [teclado, setTeclado] = useState(false);
  const campoProduto = useRef(null);
  const campoQtd = useRef(null);

  const resultados = useMemo(() => (escolhido ? [] : buscarProdutos(categorias, texto)), [categorias, texto, escolhido]);
  const mostrar = aberto && texto.trim() && !escolhido;

  function escolher(p) {
    setEscolhido(p);
    setTexto(`${p.id} - ${p.nome}`);
    setAberto(false);
    setErro('');
    campoQtd.current?.focus();
    campoQtd.current?.select();
  }

  function confirmar() {
    const produto = escolhido ?? (resultados.length === 1 ? resultados[0] : null);
    if (!produto) {
      setErro('Escolha o produto na lista');
      campoProduto.current?.focus();
      return;
    }
    const { quantidade, erro: e } = lerQuantidade(qtd);
    if (e) {
      setErro(e);
      return;
    }
    if (estadoDoProduto(produto).desabilitado) {
      setErro(`${produto.nome}: esgotado`);
      return;
    }
    aoAdicionar(produto, quantidade);
    setTexto('');
    setEscolhido(null);
    setQtd('1');
    setErro('');
    setTeclado(false);
    campoProduto.current?.focus();
  }

  function aoTeclarProduto(e) {
    const n = mostrar ? resultados.length : 0;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setDestaque((d) => (d + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      setDestaque((d) => (d - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (n) escolher(resultados[destaque]);
      else if (escolhido) campoQtd.current?.focus();
    } else if (e.key === 'Escape' && texto) {
      // Com texto, o Esc limpa o campo; vazio, deixa o Esc voltar a etapa.
      e.preventDefault();
      setTexto('');
      setEscolhido(null);
      setAberto(false);
    }
  }

  const tecla = (t) => {
    if (t === '⌫') setQtd((q) => q.slice(0, -1));
    else if (t === 'OK') confirmar();
    else setQtd((q) => (q === '1' && !teclado.digitou ? t : q + t).slice(0, 5));
  };

  return (
    <div className="entrada-produto">
      <div className="entrada-produto__linha">
        <label className="campo entrada-produto__produto">
          <span>PRODUTO (CÓD. REF OU NOME)</span>
          <div className="autocomplete">
            <input ref={campoProduto} className="campo__grande" value={texto} autoFocus
              onChange={(e) => {
                setTexto(e.target.value);
                setEscolhido(null);
                setDestaque(0);
                setAberto(true);
              }}
              onKeyDown={aoTeclarProduto} onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)}
              role="combobox" aria-expanded={Boolean(mostrar)} aria-controls="lista-busca-produto"
              aria-activedescendant={mostrar && resultados.length ? `busca-produto-${resultados[destaque]?.id}` : undefined} />
            {mostrar && (
              <ul className="autocomplete__lista" id="lista-busca-produto" role="listbox">
                {resultados.length === 0 && <li className="autocomplete__vazio">Nenhum produto encontrado.</li>}
                {resultados.map((p, i) => {
                  const e = estadoDoProduto(p);
                  return (
                    <li key={p.id} id={`busca-produto-${p.id}`} role="option" aria-selected={i === destaque} aria-disabled={e.desabilitado}
                      className={`autocomplete__item ${i === destaque ? 'autocomplete__item--destaque' : ''} ${e.desabilitado ? 'autocomplete__item--esgotado' : ''}`}
                      onMouseEnter={() => setDestaque(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => escolher(p)}>
                      <Destaque texto={String(p.id)} busca={texto} /> - <Destaque texto={p.nome} busca={texto} /> -{' '}
                      {formatarPreco(p.precoCentavos)}
                      {e.motivo && <span className="produto-botao__selo">{e.motivo}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </label>
        <button type="button" className="botao-icone botao-icone--campo" aria-label="Buscar produto"
          onClick={() => {
            setAberto(true);
            campoProduto.current?.focus();
          }}>
          <IconeLupa />
        </button>
        <button type="button" className={`botao-icone botao-icone--campo ${teclado ? 'botao-icone--ativo' : ''}`}
          aria-label="Teclado numérico" aria-pressed={Boolean(teclado)} onClick={() => setTeclado((t) => (t ? false : { digitou: false }))}>
          <IconeTeclado />
        </button>
        <label className="campo entrada-produto__qtd">
          <span>QTD.</span>
          <input ref={campoQtd} className="campo__grande" inputMode="numeric" value={qtd}
            onChange={(e) => setQtd(e.target.value)} onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                confirmar();
              }
            }} />
        </label>
        <button type="button" className="botao botao--adicionar" onClick={confirmar} aria-label="Adicionar ao pedido">+</button>
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {teclado && (
        <div className="teclado-numerico" role="group" aria-label="Teclado numérico da quantidade">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', 'OK'].map((t) => (
            <button key={t} type="button" className={`teclado-numerico__tecla ${t === 'OK' ? 'teclado-numerico__tecla--ok' : ''}`}
              onClick={() => {
                tecla(t);
                if (t !== 'OK' && t !== '⌫') setTeclado({ digitou: true });
              }}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lado direito: cliente, tempo, itens editáveis, taxa, total e ações. */
function ResumoPedido({
  linhas,
  aoMudarLinhas,
  produtosPorId,
  nomeCliente,
  textoTempo,
  totais: t,
  retirarNoBalcao,
  taxaManual,
  aoMudarTaxaManual,
  desconto,
  aoMudarDesconto,
  observacao,
  aoMudarObservacao,
  aoVoltar,
  aoTrocarCliente,
  aoRemoverCliente,
  aoLancar,
  erroLancar,
}) {
  const [editando, setEditando] = useState(null); // chave da linha aberta
  const [confirmarLimpar, setConfirmarLimpar] = useState(false);
  const [painel, setPainel] = useState(null); // null | 'taxa' | 'desconto' | 'obs'
  const [textoValor, setTextoValor] = useState('');
  const [erroValor, setErroValor] = useState('');

  function abrirValor(qual, centavos) {
    setPainel(painel === qual ? null : qual);
    setTextoValor(centavos ? (centavos / 100).toFixed(2).replace('.', ',') : '');
    setErroValor('');
  }

  function aplicarValor() {
    const c = lerReais(textoValor);
    if (Number.isNaN(c)) {
      setErroValor('Valor inválido');
      return;
    }
    if (painel === 'taxa') aoMudarTaxaManual(c); // vazio (null) = volta para a taxa do bairro
    else {
      if ((c ?? 0) > t.subtotalCentavos) {
        setErroValor('O desconto não pode passar do valor dos itens');
        return;
      }
      aoMudarDesconto(c ?? 0);
    }
    setPainel(null);
  }

  return (
    <aside className="resumo-pedido" aria-label="Resumo do pedido">
      <div className="resumo-pedido__topo">
        <div>
          <p className="resumo-pedido__cliente">{nomeCliente}</p>
          <p className="resumo-pedido__tempo">{textoTempo}</p>
        </div>
        <div className="resumo-pedido__redondos">
          <button type="button" className="botao-redondo botao-redondo--vermelho" onClick={aoVoltar} title="Voltar (Esc)" aria-label="Voltar">
            <IconeSeta direcao="esquerda" />
          </button>
          <button type="button" className="botao-redondo botao-redondo--verde" onClick={aoTrocarCliente} title="Trocar cliente" aria-label="Trocar cliente">
            <IconeTrocarCliente />
          </button>
          <button type="button" className="botao-redondo botao-redondo--dourado" onClick={() => setConfirmarLimpar(true)}
            disabled={!linhas.length} title="Limpar pedido" aria-label="Limpar pedido">
            <IconeVassoura />
          </button>
        </div>
      </div>

      {confirmarLimpar && (
        <div className="aviso resumo-pedido__confirmar" role="alertdialog" aria-label="Limpar pedido">
          <span>Tirar todos os itens do pedido?</span>
          <button type="button" className="botao botao--contorno botao--pequeno" onClick={() => setConfirmarLimpar(false)} autoFocus>Não</button>
          <button type="button" className="botao botao--perigo botao--pequeno"
            onClick={() => {
              aoMudarLinhas([]);
              aoMudarDesconto(0);
              setConfirmarLimpar(false);
            }}>
            Sim, limpar
          </button>
        </div>
      )}

      <ul className="resumo-pedido__itens">
        {linhas.length === 0 && <li className="texto-suave resumo-pedido__vazio">Nenhum item ainda.</li>}
        {linhas.map((l) => {
          const aberto = editando === l.chave;
          const produto = produtosPorId.get(l.produtoId);
          return (
            <li key={l.chave} className={`item-resumo ${aberto ? 'item-resumo--aberto' : ''}`}>
              <button type="button" className="item-resumo__linha" onClick={() => setEditando(aberto ? null : l.chave)} aria-expanded={aberto}>
                <span className="item-resumo__codigo">{l.produtoId}</span>
                <span className="item-resumo__nome">{l.nome}</span>
                <span className="item-resumo__qtd">Qtd. {l.quantidade} UND x {formatarPreco(l.precoCentavos)}</span>
                <span className="item-resumo__total">{formatarPreco(l.precoCentavos * l.quantidade)}</span>
                {l.observacao && <span className="item__obs item-resumo__obs">{l.observacao}</span>}
              </button>
              {aberto && (
                <div className="item-resumo__editor">
                  <div className="qtd" role="group" aria-label={`Quantidade de ${l.nome}`}>
                    <button type="button" aria-label="Menos um" onClick={() => aoMudarLinhas(alterarQuantidade(linhas, l.chave, -1))}>−</button>
                    <input aria-label="Quantidade" inputMode="numeric" value={l.quantidade}
                      onChange={(e) => aoMudarLinhas(definirQuantidade(linhas, l.chave, Number(e.target.value.replace(/\D/g, '')) || 1, produto))} />
                    <button type="button" aria-label="Mais um" onClick={() => aoMudarLinhas(alterarQuantidade(linhas, l.chave, +1, produto))}>+</button>
                  </div>
                  <input className="linha__obs" placeholder="Observação (ex.: sem cebola)" maxLength={140} value={l.observacao}
                    aria-label={`Observação de ${l.nome}`} autoFocus
                    onChange={(e) => aoMudarLinhas(definirObservacao(linhas, l.chave, e.target.value))}
                    onBlur={() => aoMudarLinhas(consolidar(linhas))} />
                  <button type="button" className="botao botao--contorno botao--pequeno" onClick={() => aoMudarLinhas(removerLinha(linhas, l.chave))}>
                    Remover
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="resumo-pedido__rodape">
        <div className="faixa faixa--cliente">
          <span>{nomeCliente}</span>
          <button type="button" className="faixa__x" onClick={aoRemoverCliente} aria-label="Remover cliente">×</button>
        </div>
        {retirarNoBalcao ? (
          <div className="faixa faixa--taxa">Retirada no balcão · sem taxa</div>
        ) : (
          <button type="button" className="faixa faixa--taxa" onClick={() => abrirValor('taxa', t.taxaEntregaCentavos)}>
            Taxa de entrega: {formatarPreco(t.taxaEntregaCentavos)}
            {taxaManual != null ? ' (digitada)' : t.taxaEntregaCentavos === 0 ? ' (grátis)' : ''}
          </button>
        )}
        {t.descontoCentavos > 0 && <div className="faixa faixa--desconto">Desconto: − {formatarPreco(t.descontoCentavos)}</div>}
        <p className="resumo-pedido__total">
          <span>TOTAL</span> <strong>{formatarPreco(t.totalCentavos)}</strong>
        </p>

        {(painel === 'taxa' || painel === 'desconto') && (
          <form className="resumo-pedido__valor" onSubmit={(e) => {
            e.preventDefault();
            aplicarValor();
          }}>
            <label className="campo">
              <span>{painel === 'taxa' ? 'Taxa de entrega (R$) — vazio volta à do bairro' : 'Desconto (R$)'}</span>
              <input inputMode="decimal" autoFocus value={textoValor} onChange={(e) => setTextoValor(e.target.value)} />
            </label>
            {erroValor && <p className="erro">{erroValor}</p>}
            <div className="finalizar__acoes">
              <button type="button" className="botao botao--contorno botao--pequeno" onClick={() => setPainel(null)}>Voltar</button>
              <button type="submit" className="botao botao--pequeno">Aplicar</button>
            </div>
          </form>
        )}
        {painel === 'obs' && (
          <label className="campo resumo-pedido__valor">
            <span>Observação do pedido (sai no cupom)</span>
            <textarea maxLength={200} rows={2} autoFocus value={observacao} onChange={(e) => aoMudarObservacao(e.target.value)} />
          </label>
        )}
        {erroLancar && <p className="aviso" role="alert">{erroLancar}</p>}

        <div className="resumo-pedido__botoes">
          <button type="button" className={`botao botao--contorno ${observacao ? 'botao--marcado' : ''}`} onClick={() => setPainel(painel === 'obs' ? null : 'obs')}>
            Observação
          </button>
          <button type="button" className={`botao botao--contorno ${t.descontoCentavos ? 'botao--marcado' : ''}`}
            onClick={() => abrirValor('desconto', t.descontoCentavos)} disabled={!linhas.length}>
            Desconto
          </button>
          <button type="button" className="botao botao--lancar" onClick={aoLancar} disabled={!linhas.length}>Lançar</button>
        </div>
      </div>
    </aside>
  );
}
