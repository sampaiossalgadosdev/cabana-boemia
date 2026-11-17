import { useEffect, useMemo, useRef, useState } from 'react';
import { useCarrinho } from '../carrinho/CarrinhoContext.jsx';
import { subtotal } from '../carrinho/carrinho.js';
import { useCliente } from '../cliente/ClienteContext.jsx';
import * as api from '../lib/api.js';
import { obterConfig } from '../lib/config.js';
import { mostrarConfirmacao, preCarregarConfirmacao } from '../lib/confirmacao.js';
import { formatarPreco } from '../lib/dinheiro.js';
import { quandoAbre } from '../lib/horario.js';
import { logoUrl } from '../lib/logo.js';
import {
  enderecoDaTaxa,
  iconeDaCategoria,
  limiteDaLinha,
  produtosDoCardapio,
  resumoDaSacola,
  rotuloItens,
  sugestoes as listarSugestoes,
} from '../sacola/sacola.js';
import { LinhaFreteGratis } from './BarraSacola.jsx';
import { Checkout } from './Checkout.jsx';
import { PedidoEnviado } from './PedidoEnviado.jsx';

const Icone = ({ d, tamanho = 20, traco = 2.2 }) => (
  <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="none" stroke="currentColor" strokeWidth={traco}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const SETA_BAIXO = <path d="m6 9 6 6 6-6" />;
const SETA_ESQUERDA = <path d="m15 18-6-6 6-6" />;
const LAPIS = <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />;
const LIXEIRA = <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />;
const MAIS = <path d="M12 5v14M5 12h14" />;
const MENOS = <path d="M5 12h14" />;
const CERTO = <path d="m5 12 5 5 9-10" />;

function ItemSacola({ item, produto, limite, onEditar, onMudar, onRemover }) {
  const noLimite = item.quantidade >= limite;
  const detalhe = item.observacao || produto?.descricao || '';
  return (
    <li className="sacola-item">
      <div className="sacola-item__miniatura">
        <span aria-hidden="true">{iconeDaCategoria(produto?.categoria)}</span>
        <button type="button" className="sacola-item__editar" onClick={() => onEditar(item)} aria-label={`Editar ${item.nome}`}>
          <Icone d={LAPIS} tamanho={14} />
        </button>
      </div>
      <div className="sacola-item__info">
        <span className="sacola-item__nome">{item.nome}</span>
        {detalhe && <span className={`sacola-item__detalhe${item.observacao ? ' sacola-item__detalhe--obs' : ''}`}>{detalhe}</span>}
        <span className="sacola-item__preco">{formatarPreco(subtotal(item))}</span>
      </div>
      <div className="sacola-item__lado">
        <div className="sacola-qtd" role="group" aria-label={`Quantidade de ${item.nome}`}>
          {item.quantidade === 1 ? (
            <button type="button" onClick={onRemover} aria-label={`Remover ${item.nome}`}>
              <Icone d={LIXEIRA} tamanho={18} traco={1.9} />
            </button>
          ) : (
            <button type="button" onClick={() => onMudar(item.quantidade - 1)} aria-label="Diminuir">
              <Icone d={MENOS} tamanho={18} />
            </button>
          )}
          <output aria-live="polite">{item.quantidade}</output>
          <button type="button" onClick={() => onMudar(item.quantidade + 1)} disabled={noLimite} aria-label="Aumentar">
            <Icone d={MAIS} tamanho={18} />
          </button>
        </div>
        {noLimite && limite > 0 && <span className="sacola-item__max">Máx. disponível</span>}
      </div>
    </li>
  );
}

function CartaoSugestao({ produto, adicionado, onAdicionar }) {
  return (
    <li className="sugestao">
      <div className="sugestao__imagem">
        <span aria-hidden="true">{iconeDaCategoria(produto.categoria)}</span>
        <button
          type="button"
          className={`sugestao__mais${adicionado ? ' sugestao__mais--ok' : ''}`}
          onClick={() => onAdicionar(produto)}
          disabled={adicionado}
          aria-label={adicionado ? `${produto.nome} adicionado` : `Adicionar ${produto.nome}`}
        >
          <Icone d={adicionado ? CERTO : MAIS} tamanho={18} traco={2.6} />
        </button>
      </div>
      <strong className="sugestao__preco">{formatarPreco(produto.precoCentavos)}</strong>
      <span className="sugestao__nome">{produto.nome}</span>
    </li>
  );
}

/** Taxa do bairro do endereço salvo (logado), ou null se ainda não dá para saber. */
function useTaxaDoCliente(aberto) {
  const { token, status } = useCliente();
  const [taxa, setTaxa] = useState(null);
  useEffect(() => {
    if (!aberto || status !== 'logado' || !token) {
      if (status !== 'logado') setTaxa(null);
      return undefined;
    }
    let vivo = true;
    api
      .listarEnderecos(token)
      .then(({ enderecos }) => vivo && setTaxa(enderecoDaTaxa(enderecos)?.bairro.taxaCentavos ?? null))
      .catch(() => vivo && setTaxa(null));
    return () => {
      vivo = false;
    };
  }, [aberto, token, status]);
  return taxa;
}

/**
 * Sacola em painel que sobe de baixo (tela cheia no celular, lateral em telas
 * largas): itens, "Peça também", resumo e "Continuar". O checkout e a tela de
 * pedido enviado acontecem no mesmo painel. Valores são prévia: a API recalcula.
 */
export function PainelSacola({
  aberto,
  onFechar,
  onVoltarAoCardapio,
  onEditar,
  cardapio,
  freteGratis,
  onFreteGratis,
  onPedidoEnviado,
  onCardapioDesatualizado,
}) {
  const ref = useRef(null);
  const { itens, totalItens, adicionar, editar, remover, substituir } = useCarrinho();
  const [tela, setTela] = useState('sacola'); // 'sacola' | 'checkout'
  const [enviado, setEnviado] = useState(null);
  const [confirmando, setConfirmando] = useState(false); // animação de pedido confirmado
  const confirmandoRef = useRef(false);
  const [confirmandoLimpar, setConfirmandoLimpar] = useState(false);
  const [nomeRestaurante, setNomeRestaurante] = useState('Cabana Boemia');
  const [aviso, setAviso] = useState('');
  const [recem, setRecem] = useState(() => new Set());
  const taxaBairro = useTaxaDoCliente(aberto);

  useEffect(() => {
    obterConfig()
      .then((c) => c.nome && setNomeRestaurante(c.nome))
      .catch(() => {});
  }, []);

  // <dialog> nativo: foco preso, Esc fecha, fundo inerte.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
    if (!aberto) {
      setTela('sacola');
      setEnviado(null);
      setConfirmandoLimpar(false);
    }
  }, [aberto]);

  // Sacola esvaziou (último item removido, "Limpar"): fecha o painel.
  useEffect(() => {
    if (aberto && !enviado && !confirmando && itens.length === 0) onFechar();
  }, [aberto, enviado, confirmando, itens.length, onFechar]);

  // Abriu o checkout: deixa a coroa da animação de confirmação no cache.
  useEffect(() => {
    if (aberto && tela === 'checkout') preCarregarConfirmacao();
  }, [aberto, tela]);

  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(''), 1800);
    return () => clearTimeout(t);
  }, [aviso]);

  const produtos = useMemo(() => produtosDoCardapio(cardapio?.categorias), [cardapio]);
  const resumo = resumoDaSacola(itens, { taxaBairroCentavos: taxaBairro, freteGratis });
  const listaSugestoes = listarSugestoes(cardapio, itens, recem);
  const fechado = cardapio ? !cardapio.aberto : false;

  const adicionarSugestao = (produto) => {
    adicionar(produto, 1, '');
    setAviso(`${produto.nome} foi para a sacola`);
    setRecem((s) => new Set(s).add(produto.id));
    setTimeout(() => setRecem((s) => {
      const n = new Set(s);
      n.delete(produto.id);
      return n;
    }), 1200);
  };

  // Chamado só com a resposta de sucesso da API. A sacola é limpa na hora (o
  // pedido já existe; recarregar no meio da animação não pode deixá-la cheia) e a
  // tela "pedido enviado" entra quando a animação termina ou é pulada.
  const aoEnviar = (pedido) => {
    if (confirmandoRef.current) return; // segunda resposta (duplo clique, reenvio)
    confirmandoRef.current = true;
    setConfirmando(true);
    substituir([]);
    onPedidoEnviado?.(pedido);
    // Dentro do <dialog> modal: no body ficaria por trás dele.
    mostrarConfirmacao({ numero: pedido.numeroDia, dentro: ref.current }).then(() => {
      confirmandoRef.current = false;
      setConfirmando(false);
      if (ref.current?.open) setEnviado(pedido);
    });
  };

  const titulo = enviado ? 'PEDIDO ENVIADO' : tela === 'checkout' ? 'FINALIZAR' : 'SACOLA';
  const voltarParaSacola = tela === 'checkout' && !enviado;

  return (
    <dialog
      ref={ref}
      className="painel-sacola"
      aria-label={titulo}
      onClose={onFechar}
      onCancel={(e) => {
        if (confirmandoRef.current) e.preventDefault(); // Esc não fecha durante a animação
      }}
      onClick={(e) => {
        if (e.target === ref.current) onFechar();
      }}
    >
      {aberto && (
        <>
          <header className="painel-sacola__topo">
            <button
              type="button"
              className="botao-redondo"
              onClick={voltarParaSacola ? () => setTela('sacola') : onFechar}
              aria-label={voltarParaSacola ? 'Voltar à sacola' : 'Fechar sacola'}
            >
              <Icone d={voltarParaSacola ? SETA_ESQUERDA : SETA_BAIXO} tamanho={22} />
            </button>
            <h2 className="painel-sacola__titulo">{titulo}</h2>
            {tela === 'sacola' && !enviado ? (
              <button type="button" className="painel-sacola__limpar" onClick={() => setConfirmandoLimpar(true)}>
                Limpar
              </button>
            ) : (
              <span className="painel-sacola__vazio" />
            )}
          </header>

          {confirmandoLimpar && (
            <div className="painel-sacola__confirmar" role="alertdialog" aria-label="Limpar sacola">
              <p>Remover todos os itens da sacola?</p>
              <div>
                <button type="button" className="botao botao--texto" onClick={() => setConfirmandoLimpar(false)}>
                  Cancelar
                </button>
                <button type="button" className="botao botao--primario" onClick={() => substituir([])}>
                  Remover tudo
                </button>
              </div>
            </div>
          )}

          <div className="painel-sacola__corpo">
            {enviado ? (
              <PedidoEnviado pedido={enviado} onFechar={onFechar} />
            ) : tela === 'checkout' ? (
              <Checkout
                onPedidoEnviado={aoEnviar}
                onCardapioDesatualizado={onCardapioDesatualizado}
                freteGratis={freteGratis}
                onFreteGratis={onFreteGratis}
              />
            ) : (
              <>
                <section className="sacola-restaurante" aria-label="Restaurante">
                  <img className="sacola-restaurante__logo" src={logoUrl} alt="" />
                  <div>
                    <p className="sacola-restaurante__nome">{nomeRestaurante}</p>
                    <button type="button" className="link-primario" onClick={onVoltarAoCardapio}>
                      Adicionar mais itens
                    </button>
                  </div>
                </section>

                <section aria-labelledby="sacola-itens">
                  <h3 id="sacola-itens" className="sacola-secao">
                    Itens adicionados
                  </h3>
                  <ul className="sacola-itens">
                    {itens.map((item) => (
                      <ItemSacola
                        key={item.id}
                        item={item}
                        produto={produtos.get(item.produtoId)}
                        limite={limiteDaLinha(item, itens, produtos.get(item.produtoId))}
                        onEditar={onEditar}
                        onMudar={(quantidade) => editar(item.id, { quantidade })}
                        onRemover={() => remover(item.id)}
                      />
                    ))}
                  </ul>
                  <button type="button" className="botao-cinza" onClick={onVoltarAoCardapio}>
                    Adicionar mais itens
                  </button>
                </section>

                {listaSugestoes.length > 0 && (
                  <section aria-labelledby="sacola-sugestoes">
                    <h3 id="sacola-sugestoes" className="sacola-secao">
                      Peça também
                    </h3>
                    <ul className="sugestoes">
                      {listaSugestoes.map((p) => (
                        <CartaoSugestao key={p.id} produto={p} adicionado={recem.has(p.id)} onAdicionar={adicionarSugestao} />
                      ))}
                    </ul>
                  </section>
                )}

                <section aria-labelledby="sacola-resumo" className="sacola-resumo">
                  <h3 id="sacola-resumo" className="sacola-secao">
                    Resumo de valores
                  </h3>
                  {resumo.progresso && !resumo.progresso.atingido && (
                    <LinhaFreteGratis subtotalCentavos={resumo.subtotalCentavos} freteGratis={freteGratis} />
                  )}
                  <dl>
                    <div>
                      <dt>Total dos itens</dt>
                      <dd>{formatarPreco(resumo.subtotalCentavos)}</dd>
                    </div>
                    <div>
                      <dt>Taxa de entrega</dt>
                      <dd className={resumo.gratis ? 'sacola-resumo__gratis' : resumo.taxaEntregaCentavos == null ? 'sacola-resumo__depois' : undefined}>
                        {resumo.gratis
                          ? 'Grátis'
                          : resumo.taxaEntregaCentavos == null
                            ? 'Calculada no próximo passo'
                            : formatarPreco(resumo.taxaEntregaCentavos)}
                      </dd>
                    </div>
                    <div className="sacola-resumo__total">
                      <dt>Total</dt>
                      <dd>{formatarPreco(resumo.totalCentavos)}</dd>
                    </div>
                  </dl>
                  <p className="nota nota--esquerda">Valores de prévia: o total final é conferido ao enviar o pedido.</p>
                </section>
              </>
            )}
          </div>

          {tela === 'sacola' && !enviado && (
            <footer className="painel-sacola__rodape">
              <div className="painel-sacola__total">
                <span className="painel-sacola__rotulo">{resumo.rotuloTotal}</span>
                <span>
                  <strong>{formatarPreco(resumo.totalCentavos)}</strong>
                  <span className="painel-sacola__itens"> / {rotuloItens(totalItens)}</span>
                </span>
              </div>
              <div className="painel-sacola__acao">
                <button type="button" className="botao botao--primario painel-sacola__continuar" disabled={fechado} onClick={() => setTela('checkout')}>
                  Continuar
                </button>
                {fechado && (
                  <span className="painel-sacola__fechado">
                    Fechado no momento{cardapio?.proximaAbertura ? ` · abre ${quandoAbre(cardapio.proximaAbertura.em)}` : ''}
                  </span>
                )}
              </div>
            </footer>
          )}

          {aviso && (
            <p className="painel-sacola__aviso" role="status">
              {aviso}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
