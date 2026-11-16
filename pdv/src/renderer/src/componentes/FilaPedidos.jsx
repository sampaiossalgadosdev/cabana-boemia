import { useCallback, useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { aplicarPedido, entraNaFila, filaDaApi, removerPedido, tocaAlerta } from '../lib/fila.js';
import { tocarAlerta } from '../lib/som.js';
import { CartaoPedido } from './CartaoPedido.jsx';

/** Recarga de segurança (eventos perdidos, virada do dia). */
const RECARREGAR_MS = 5 * 60_000;

/**
 * "Fila de pedidos": site + WhatsApp, ainda abertos hoje. Carrega da API,
 * depois segue os eventos do socket; recarrega ao (re)conectar, porque
 * eventos emitidos durante a queda não são reenviados.
 */
export function FilaPedidos({ statusConexao, aoNovoDelivery }) {
  const [fila, setFila] = useState([]);
  const [novos, setNovos] = useState(() => new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const { pedidos } = await chamar(pdv.pedidos.listarFila());
      setFila(filaDaApi(pedidos));
      setErro('');
    } catch (err) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, RECARREGAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    if (statusConexao === 'conectado') carregar();
  }, [statusConexao, carregar]);

  useEffect(() => {
    const pararNovo = pdv.aoEvento('pedido:novo', (pedido) => {
      if (!entraNaFila(pedido)) return; // ex.: comanda do salão
      setFila((f) => aplicarPedido(f, pedido));
      setNovos((n) => new Set(n).add(pedido.id));
      if (tocaAlerta(pedido)) tocarAlerta();
    });
    const pararAtualizado = pdv.aoEvento('pedido:atualizado', (pedido) => {
      setFila((f) => aplicarPedido(f, pedido));
    });
    return () => {
      pararNovo();
      pararAtualizado();
    };
  }, []);

  const finalizar = useCallback(async (id, formaPagamento) => {
    try {
      await chamar(pdv.pedidos.finalizar(id, formaPagamento));
      setFila((f) => removerPedido(f, id));
    } catch (err) {
      // Outra atendente já finalizou: some da fila.
      if (err.codigo === 'PEDIDO_ENCERRADO' || err.status === 404) setFila((f) => removerPedido(f, id));
      throw err;
    }
  }, []);

  const cancelar = useCallback(async (id) => {
    try {
      await chamar(pdv.pedidos.cancelar(id));
      setFila((f) => removerPedido(f, id));
    } catch (err) {
      if (err.codigo === 'PEDIDO_ENCERRADO' || err.status === 404) setFila((f) => removerPedido(f, id));
      throw err;
    }
  }, []);

  // Cria um trabalho novo na API; o PDV do balcão imprime (mesmo que seja outro computador).
  const reimprimir = useCallback((id) => chamar(pdv.pedidos.reimprimir(id)), []);

  const marcarVisto = (id) =>
    setNovos((n) => {
      const c = new Set(n);
      c.delete(id);
      return c;
    });

  return (
    <section className="fila" aria-labelledby="titulo-fila">
      <div className="fila__cabecalho">
        <h2 id="titulo-fila">Fila de pedidos</h2>
        <span className="fila__contagem">{fila.length}</span>
        <button type="button" className="botao botao--contorno botao--pequeno fila__atualizar" onClick={carregar}>
          Atualizar
        </button>
        <button type="button" className="botao" onClick={aoNovoDelivery}>
          + Novo delivery <kbd>F2</kbd>
        </button>
      </div>

      {erro && (
        <p className="aviso" role="alert">
          Não foi possível atualizar a fila: {erro}
        </p>
      )}

      {carregando ? (
        <p className="fila__vazia">Carregando…</p>
      ) : fila.length === 0 ? (
        <p className="fila__vazia">Nenhum pedido aberto. Pedidos do site e do WhatsApp aparecem aqui.</p>
      ) : (
        <div className="fila__lista">
          {fila.map((p) => (
            <CartaoPedido key={p.id} pedido={p} novo={novos.has(p.id)} aoFinalizar={finalizar} aoCancelar={cancelar}
              aoReimprimir={reimprimir}
              aoVer={() => marcarVisto(p.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
