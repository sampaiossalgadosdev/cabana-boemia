import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { atualizarPrecos, itensParaApi } from '../../lib/lancamento.js';
import { PassoCliente } from './PassoCliente.jsx';
import { PassoItens } from './PassoItens.jsx';
import { PassoPagamento } from './PassoPagamento.jsx';

const PASSOS = ['Cliente', 'Itens', 'Pagamento'];

/** Chave de idempotência: a mesma em todas as tentativas deste lançamento. */
const novaChave = () => crypto.randomUUID();

/**
 * Lançamento de delivery do WhatsApp em 3 passos. Esc volta um passo (no
 * passo 1, fecha o cadastro/endereço e depois sai). Confirmar cria o pedido
 * pela API (mesmo criarPedido do site) e volta para a fila.
 */
export function NovoDelivery({ aoConcluir, aoSair }) {
  const [passo, setPasso] = useState(0);
  const [modoCliente, setModoCliente] = useState('busca'); // busca | cadastro | endereco
  const [buscaInicial, setBuscaInicial] = useState('');
  const [cliente, setCliente] = useState(null);
  const [enderecoId, setEnderecoId] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [cardapio, setCardapio] = useState(null);
  const [turnoId, setTurnoId] = useState(null);
  const [carregandoCardapio, setCarregandoCardapio] = useState(false);
  const [erroCardapio, setErroCardapio] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [forma, setForma] = useState('');
  const [troco, setTroco] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const chave = useRef(novaChave());

  useEffect(() => {
    chamar(pdv.bairros.listar()).then((r) => setBairros(r.bairros), () => {});
  }, []);

  const carregarCardapio = useCallback(async (id) => {
    setCarregandoCardapio(true);
    try {
      const c = await chamar(pdv.cardapio.obter(id));
      setCardapio(c);
      setErroCardapio('');
      // Preço e nome de agora (o total oficial sai da API de qualquer forma).
      const porId = new Map(c.categorias.flatMap((cat) => cat.produtos).map((p) => [p.id, p]));
      setLinhas((ls) => atualizarPrecos(ls, porId));
    } catch (err) {
      setErroCardapio(err.message);
    } finally {
      setCarregandoCardapio(false);
    }
  }, []);

  // Cardápio (com saldo) recarregado sempre que entra no passo de itens.
  useEffect(() => {
    if (passo === 1) carregarCardapio(turnoId);
  }, [passo, turnoId, carregarCardapio]);

  // A retaguarda mudou algo: recarrega a grade (se estiver nela) e as taxas dos bairros.
  useEffect(
    () =>
      pdv.aoEvento('cardapio:atualizado', () => {
        if (passo === 1) carregarCardapio(turnoId);
        chamar(pdv.bairros.listar()).then((r) => setBairros(r.bairros), () => {});
      }),
    [passo, turnoId, carregarCardapio],
  );

  const escolherCliente = useCallback((c) => {
    setCliente(c);
    const ativo = c?.enderecos.find((e) => e.bairro.ativo);
    setEnderecoId(ativo?.id ?? null);
    setErroEnvio('');
  }, []);

  const voltar = useCallback(() => {
    if (enviando) return;
    if (passo === 0) {
      if (modoCliente !== 'busca') setModoCliente('busca');
      else aoSair();
      return;
    }
    setErroEnvio('');
    setPasso((p) => p - 1);
  }, [passo, modoCliente, enviando, aoSair]);

  useEffect(() => {
    function aoTeclar(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target.closest?.('.campo-tempo')) return; // Esc do campo de tempo desfaz a edição
      e.preventDefault();
      voltar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [voltar]);

  async function confirmar(trocoParaCentavos) {
    setEnviando(true);
    setErroEnvio('');
    try {
      const { pedido } = await chamar(
        pdv.pedidos.criar({
          clienteId: cliente.id,
          enderecoId,
          itens: itensParaApi(linhas),
          formaPagamento: forma,
          trocoParaCentavos,
          chaveIdempotencia: chave.current,
        }),
      );
      aoConcluir(pedido);
    } catch (err) {
      setEnviando(false);
      setErroEnvio(err.message);
      // Nada foi criado: estoque/produto mudou. Recarrega para a grade mostrar.
      if (['ESTOQUE_INSUFICIENTE', 'PRODUTO_INDISPONIVEL'].includes(err.codigo)) carregarCardapio(turnoId);
    }
  }

  const endereco = cliente?.enderecos.find((e) => e.id === enderecoId);

  return (
    <section className="novo-delivery" aria-labelledby="titulo-novo-delivery">
      <header className="novo-delivery__topo">
        <button type="button" className="botao botao--contorno botao--pequeno" onClick={voltar} disabled={enviando}>
          ← {passo === 0 && modoCliente === 'busca' ? 'Fila' : 'Voltar'} <kbd>Esc</kbd>
        </button>
        <h2 id="titulo-novo-delivery">Novo delivery (WhatsApp)</h2>
        <ol className="etapas">
          {PASSOS.map((nome, i) => (
            <li key={nome} className={`etapa ${i === passo ? 'etapa--atual' : ''} ${i < passo ? 'etapa--feita' : ''}`}
              aria-current={i === passo ? 'step' : undefined}>
              <span className="etapa__numero">{i + 1}</span> {nome}
            </li>
          ))}
        </ol>
      </header>

      {passo === 0 && (
        <PassoCliente
          cliente={cliente}
          enderecoId={enderecoId}
          bairros={bairros}
          modo={modoCliente}
          buscaInicial={buscaInicial}
          aoMudarModo={(modo, busca = '') => {
            setBuscaInicial(busca);
            setModoCliente(modo);
          }}
          aoEscolher={escolherCliente}
          aoEscolherEndereco={setEnderecoId}
          aoContinuar={() => setPasso(1)}
        />
      )}

      {passo === 1 && (
        <PassoItens
          cardapio={cardapio}
          carregando={carregandoCardapio}
          erro={erroCardapio}
          linhas={linhas}
          aoMudarLinhas={setLinhas}
          aoTrocarTurno={setTurnoId}
          aoRecarregar={() => carregarCardapio(turnoId)}
          aoContinuar={() => setPasso(2)}
        />
      )}

      {passo === 2 && cliente && endereco && (
        <PassoPagamento
          cliente={cliente}
          endereco={endereco}
          linhas={linhas}
          freteGratis={cardapio?.freteGratis ?? null}
          forma={forma}
          aoMudarForma={setForma}
          troco={troco}
          aoMudarTroco={setTroco}
          enviando={enviando}
          erro={erroEnvio}
          aoConfirmar={confirmar}
        />
      )}
    </section>
  );
}
