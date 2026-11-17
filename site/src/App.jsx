import { useEffect, useMemo, useRef, useState } from 'react';
import { Cabecalho } from './componentes/Cabecalho.jsx';
import { AvisoFechado, FaixaSemConexao } from './componentes/Faixas.jsx';
import { AbasCategorias } from './componentes/AbasCategorias.jsx';
import { ListaCardapio, EstadoCarregando } from './componentes/ListaCardapio.jsx';
import { ModalProduto } from './componentes/ModalProduto.jsx';
import { GavetaCarrinho } from './componentes/Carrinho.jsx';
import { BarraSacola } from './componentes/BarraSacola.jsx';
import { Navegacao } from './componentes/Navegacao.jsx';
import { TelaPedidos } from './componentes/TelaPedidos.jsx';
import { TelaPerfil } from './componentes/TelaPerfil.jsx';
import { useNavegacao } from './hooks/useNavegacao.js';
import { useAvisos } from './componentes/Avisos.jsx';
import { useCardapio } from './hooks/useCardapio.js';
import { useCategoriaAtiva } from './hooks/useCategoriaAtiva.js';
import { useCarrinho } from './carrinho/CarrinhoContext.jsx';
import { conciliar, mensagensDaConciliacao } from './carrinho/carrinho.js';
import { repetirPedido } from './pedido/pedido.js';
import { useUltimoPedido } from './hooks/useUltimoPedido.js';
import { RodapeLegal } from './componentes/PaginaLegal.jsx';

const SEM_CATEGORIAS = [];

export function App() {
  const { dados, semConexao, atualizadoEm, recarregar } = useCardapio();
  const carrinho = useCarrinho();
  const { avisar } = useAvisos();
  const { ultimoPedido, recarregarUltimoPedido } = useUltimoPedido();
  const { aba, irPara: irParaAba } = useNavegacao();

  const categorias = dados?.categorias ?? SEM_CATEGORIAS;
  const fechado = dados ? !dados.aberto : false;
  const { ativa, irPara } = useCategoriaAtiva(categorias, aba === 'inicio');

  // Modal: { produto, item? } — item presente = editando uma linha do carrinho.
  const [modal, setModal] = useState(null);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const aberturas = useRef(0);

  // Frete grátis: vem com o cardápio (recarregado a cada 30 s). Um 409
  // PRECO_ALTERADO no checkout também traz a regra vigente (antes da recarga).
  const [freteGratis, setFreteGratis] = useState(null);
  useEffect(() => {
    if (dados) setFreteGratis(dados.freteGratis ?? null);
  }, [dados]);

  const produtosPorId = useMemo(
    () => new Map(categorias.flatMap((c) => c.produtos).map((p) => [p.id, p])),
    [categorias],
  );

  // A cada cardápio novo (só respostas bem-sucedidas), concilia o carrinho.
  const itensRef = useRef(carrinho.itens);
  itensRef.current = carrinho.itens;
  useEffect(() => {
    if (!atualizadoEm) return;
    const r = conciliar(itensRef.current, categorias);
    if (!r.mudou) return;
    carrinho.substituir(r.itens);
    mensagensDaConciliacao(r).forEach(avisar);
  }, [atualizadoEm]); // de propósito: só quando chega cardápio novo (itens vêm do ref)

  const abrirModal = (produto, item = null) => {
    aberturas.current += 1;
    setModal({ produto, item, chave: aberturas.current });
  };

  const confirmarModal = ({ quantidade, observacao }) => {
    if (modal.item) carrinho.editar(modal.item.id, { quantidade, observacao });
    else carrinho.adicionar(modal.produto, quantidade, observacao);
    setModal(null);
  };

  /** Só o que está no cardápio agora, com o preço de agora (último pedido ou um do histórico). */
  const repetir = (pedido) => {
    const r = repetirPedido(carrinho.itens, pedido, categorias);
    if (r.adicionados) {
      carrinho.substituir(r.itens);
      avisar(r.adicionados === 1 ? '1 item foi para a sacola.' : `${r.adicionados} itens foram para a sacola.`);
    }
    if (r.indisponiveis.length) avisar(`Indisponível agora: ${r.indisponiveis.join(', ')}.`);
    if (r.adicionados) {
      irParaAba('inicio');
      setGavetaAberta(true);
    }
  };

  const editarDoCarrinho = (item) => {
    setGavetaAberta(false);
    const produto = produtosPorId.get(item.produtoId) ?? {
      id: item.produtoId,
      nome: item.nome,
      precoCentavos: item.precoCentavos,
    };
    abrirModal(produto, item);
  };

  return (
    <div className={`app${carrinho.totalItens ? ' app--com-sacola' : ''}${freteGratis && carrinho.totalItens ? ' app--com-frete' : ''}`}>
      <Cabecalho cardapio={dados}>
        <Navegacao aba={aba} onIr={irParaAba} variante="topo" />
      </Cabecalho>

      {aba === 'inicio' && (
        <>
          <div className="conteudo">
            {semConexao && dados && <FaixaSemConexao />}
            {fechado && <AvisoFechado proximaAbertura={dados.proximaAbertura} />}
            {!fechado && ultimoPedido?.itens.length > 0 && categorias.length > 0 && (
              <div className="repetir">
                <span>Bateu a vontade de novo?</span>
                <button type="button" className="botao botao--secundario" onClick={() => repetir(ultimoPedido)}>
                  Repetir último pedido
                </button>
              </div>
            )}
          </div>

          {dados && categorias.length > 0 && (
            <AbasCategorias categorias={categorias} ativa={ativa} onSelecionar={irPara} />
          )}

          <main className="conteudo">
            {dados ? (
              <ListaCardapio categorias={categorias} desabilitado={fechado} onAdicionar={abrirModal} />
            ) : semConexao ? (
              <div className="vazio">
                <p>Não foi possível carregar o cardápio.</p>
                <button type="button" className="botao botao--secundario" onClick={recarregar}>
                  Tentar de novo
                </button>
              </div>
            ) : (
              <EstadoCarregando />
            )}
          </main>
        </>
      )}

      {aba === 'pedidos' && (
        <main className="conteudo">
          <TelaPedidos fechado={fechado || !dados} onRepetir={repetir} />
        </main>
      )}
      {aba === 'perfil' && (
        <main className="conteudo">
          <TelaPerfil />
        </main>
      )}

      <RodapeLegal />

      <div className="rodape-fixo">
        <BarraSacola onAbrir={() => setGavetaAberta(true)} freteGratis={freteGratis} />
        <Navegacao aba={aba} onIr={irParaAba} variante="inferior" />
      </div>
      <GavetaCarrinho
        aberta={gavetaAberta}
        onFechar={() => setGavetaAberta(false)}
        onEditar={editarDoCarrinho}
        fechado={fechado}
        onPedidoEnviado={recarregarUltimoPedido}
        onCardapioDesatualizado={recarregar}
        freteGratis={freteGratis}
        onFreteGratis={setFreteGratis}
      />
      <ModalProduto
        key={modal?.chave ?? 0}
        produto={modal?.produto ?? null}
        item={modal?.item ?? null}
        onConfirmar={confirmarModal}
        onFechar={() => setModal(null)}
      />
    </div>
  );
}
