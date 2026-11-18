import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { atualizarPrecos, itensParaApi } from '../../lib/lancamento.js';
import { diaOperacional, horaVirada } from '../../lib/caixa.js';
import { formatarDataHora } from '../../lib/formatar.js';
import {
  CLIENTE_VAZIO,
  ENDERECO_VAZIO,
  avaliarAgendamento,
  clienteParaForm,
  enderecoParaEnvio,
  enderecoParaForm,
  etapasDoPedido,
  manterPedidoAoVoltar,
  planoDeGravacao,
  primeiroErro,
  sugestaoDeHorario,
  totaisDoPedido,
  validarCliente,
} from '../../lib/novoPedido.js';
import { IconeSeta } from '../Icones.jsx';
import { EtapaTipo } from './EtapaTipo.jsx';
import { EtapaCliente } from './EtapaCliente.jsx';
import { EtapaProdutos } from './EtapaProdutos.jsx';
import { ModalPagamento } from './ModalPagamento.jsx';

const NOME_ETAPA = { tipo: 'Pedido', cliente: 'Cliente', produtos: 'Produtos' };

/**
 * "Novo pedido" do delivery em etapas: tipo → cliente (+ data/horário, só
 * encomenda) → produtos → pagamento. "→" só avança com a etapa válida (senão
 * diz o que falta); Esc volta uma etapa. Cria o pedido pela API (o mesmo
 * criarPedido do site: preço do banco, baixa de estoque, impressão).
 */
export function NovoPedido({ aoSair, aoConcluir }) {
  const [tipo, setTipo] = useState(null);
  const [indice, setIndice] = useState(0);
  // Direção da animação: 'frente' entra da direita; 'tras' entra da esquerda.
  const [direcao, setDirecao] = useState('frente');
  // Quando a atendente voltou para a escolha do tipo (regra dos 5 s).
  const voltouAoTipoEm = useRef(null);
  const etapas = etapasDoPedido(tipo ?? 'delivery');
  const etapa = etapas[indice];

  const [cliente, setCliente] = useState(null);
  const [form, setForm] = useState(CLIENTE_VAZIO);
  const [endereco, setEndereco] = useState(ENDERECO_VAZIO);
  const [enderecoId, setEnderecoId] = useState(null);
  const [retirar, setRetirar] = useState(false);
  const [errosCliente, setErrosCliente] = useState({});
  const [clienteExistente, setClienteExistente] = useState(null);
  const [agendamento, setAgendamento] = useState(() => sugestaoDeHorario(new Date()));
  const [erroAgendamento, setErroAgendamento] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [tempoMin, setTempoMin] = useState(null);

  const [cardapio, setCardapio] = useState(null);
  const [turnoId, setTurnoId] = useState(null);
  const [carregandoCardapio, setCarregandoCardapio] = useState(false);
  const [erroCardapio, setErroCardapio] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [taxaManual, setTaxaManual] = useState(null);
  const [desconto, setDesconto] = useState(0);
  const [observacao, setObservacao] = useState('');

  const [pagamento, setPagamento] = useState(false);
  const [forma, setForma] = useState('');
  const [troco, setTroco] = useState('');
  const [pagoAgora, setPagoAgora] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const chave = useRef(crypto.randomUUID());

  /** Vai para a etapa `novo` (a animação segue a direção). */
  function irPara(novo) {
    setDirecao(novo >= indice ? 'frente' : 'tras');
    if (novo === 0 && indice > 0) voltouAoTipoEm.current = Date.now();
    setIndice(novo);
  }

  const encomenda = tipo === 'encomenda';
  const retirarNoBalcao = encomenda && retirar;

  const carregarBairros = useCallback(() => {
    chamar(pdv.bairros.listar()).then((r) => setBairros(r.bairros), () => {});
  }, []);

  useEffect(() => {
    carregarBairros();
    chamar(pdv.tempo.obter()).then((r) => setTempoMin(r.vigenteMin), () => {});
  }, [carregarBairros]);

  const carregarCardapio = useCallback(async (id) => {
    setCarregandoCardapio(true);
    try {
      const c = await chamar(pdv.cardapio.obter(id));
      setCardapio(c);
      setErroCardapio('');
      const porId = new Map(c.categorias.flatMap((cat) => cat.produtos).map((p) => [p.id, p]));
      setLinhas((ls) => atualizarPrecos(ls, porId));
    } catch (err) {
      setErroCardapio(err.message);
    } finally {
      setCarregandoCardapio(false);
    }
  }, []);

  // Cardápio (com saldo) recarregado sempre que entra na etapa de produtos.
  useEffect(() => {
    if (etapa === 'produtos') carregarCardapio(turnoId);
  }, [etapa, turnoId, carregarCardapio]);

  // A retaguarda mudou algo: recarrega a grade (se estiver nela) e as taxas dos bairros.
  useEffect(
    () =>
      pdv.aoEvento('cardapio:atualizado', () => {
        if (etapa === 'produtos') carregarCardapio(turnoId);
        carregarBairros();
      }),
    [etapa, turnoId, carregarCardapio, carregarBairros],
  );

  useEffect(() => setMensagem(''), [etapa]);

  // ───────── Cliente ─────────

  function escolherCliente(c) {
    const principal = c.enderecos.find((e) => e.bairro.ativo) ?? null;
    setCliente(c);
    setForm(clienteParaForm(c));
    setEnderecoId(principal?.id ?? null);
    setEndereco(enderecoParaForm(principal));
    setErrosCliente({});
    setClienteExistente(null);
    setMensagem('');
  }

  /** Solta o cliente escolhido: os campos ficam vazios e avançar cria um cliente novo. */
  function desvincularCliente() {
    setCliente(null);
    setForm(CLIENTE_VAZIO);
    setEndereco(ENDERECO_VAZIO);
    setEnderecoId(null);
    setErrosCliente({});
    setClienteExistente(null);
    setMensagem('');
  }

  /** Recomeça o pedido do zero (cliente, itens, ajustes e pagamento). */
  function limparPedido() {
    desvincularCliente();
    setRetirar(false);
    setAgendamento(sugestaoDeHorario(new Date()));
    setErroAgendamento(null);
    setLinhas([]);
    setTaxaManual(null);
    setDesconto(0);
    setObservacao('');
    setForma('');
    setTroco('');
    setPagoAgora(false);
    chave.current = crypto.randomUUID();
  }

  /**
   * Escolha de DELIVERY/ENCOMENDA (já avança). Se a atendente voltou para cá
   * e ficou 5 s ou mais, o pedido recomeça do zero; menos que isso, mantém.
   */
  function escolherTipo(t) {
    if (!manterPedidoAoVoltar(voltouAoTipoEm.current, Date.now())) limparPedido();
    voltouAoTipoEm.current = null;
    setTipo(t);
    if (t !== 'encomenda') setRetirar(false);
    setMensagem('');
    irPara(1);
  }

  function escolherEndereco(id) {
    setEnderecoId(id);
    setEndereco(enderecoParaForm(cliente?.enderecos.find((e) => e.id === id) ?? null));
  }

  /** Valida e grava (cria ou atualiza) o cliente e o endereço. true = pode avançar. */
  async function gravarCliente() {
    const erros = validarCliente(form, endereco, { retirarNoBalcao, bairros, doSite: cliente?.doSite });
    setErrosCliente(erros);
    if (Object.keys(erros).length) {
      setMensagem(primeiroErro(erros));
      return false;
    }
    let atual = cliente;
    let endId = enderecoId;
    try {
      for (const passo of planoDeGravacao({ cliente, form, endereco, enderecoId, retirarNoBalcao })) {
        if (passo.tipo === 'criar') {
          atual = (await chamar(pdv.clientes.criar({ ...form, endereco: passo.comEndereco ? enderecoParaEnvio(endereco) : null }))).cliente;
          endId = atual.enderecos[0]?.id ?? null;
        } else if (passo.tipo === 'atualizarCliente') {
          atual = (await chamar(pdv.clientes.atualizar(atual.id, form))).cliente;
        } else if (passo.tipo === 'adicionarEndereco') {
          atual = (await chamar(pdv.clientes.adicionarEndereco(atual.id, enderecoParaEnvio(endereco)))).cliente;
          endId = atual.enderecos[0]?.id ?? null; // o novo vira o principal (vem primeiro)
        } else if (passo.tipo === 'atualizarEndereco') {
          atual = (await chamar(pdv.clientes.atualizarEndereco(atual.id, passo.enderecoId, enderecoParaEnvio(endereco)))).cliente;
          endId = passo.enderecoId;
        }
      }
      return true;
    } catch (err) {
      setMensagem(err.message);
      if (err.codigo === 'CLIENTE_JA_EXISTE' && err.detalhes?.cliente) setClienteExistente(err.detalhes.cliente);
      return false;
    } finally {
      // Mesmo numa falha no meio (ex.: endereço), o que já foi gravado fica valendo.
      if (atual) {
        setCliente(atual);
        setForm(clienteParaForm(atual));
        if (endId) {
          setEnderecoId(endId);
          setEndereco(enderecoParaForm(atual.enderecos.find((e) => e.id === endId)));
        }
      }
    }
  }

  // ───────── Navegação ─────────

  const temDados = linhas.length > 0 || Boolean(cliente) || Boolean(form.nome.trim() || form.telefone.trim());

  const sair = useCallback(() => {
    if (enviando) return;
    if (temDados && !window.confirm('Descartar este pedido?')) return;
    aoSair();
  }, [enviando, temDados, aoSair]);

  const voltar = useCallback(() => {
    if (enviando || salvando) return;
    if (pagamento) {
      setPagamento(false);
      return;
    }
    if (indice === 0) sair();
    else irPara(indice - 1);
  }, [enviando, salvando, pagamento, indice, sair]);

  async function avancar() {
    if (salvando || enviando) return;
    setMensagem('');
    if (etapa === 'tipo') {
      if (!tipo) setMensagem('Escolha DELIVERY ou ENCOMENDA.');
      else escolherTipo(tipo);
    } else if (etapa === 'cliente') {
      // Encomenda: data/horário (no fim da etapa) conferidos antes de gravar o cliente.
      if (encomenda) {
        const { erro } = avaliarAgendamento(agendamento.data, agendamento.hora, new Date(), diaOperacional);
        setErroAgendamento(erro);
        if (erro) {
          setMensagem(erro);
          return;
        }
      }
      setSalvando(true);
      const ok = await gravarCliente();
      setSalvando(false);
      if (ok) irPara(indice + 1);
    } else if (etapa === 'produtos') {
      if (!linhas.length) setMensagem('Adicione pelo menos um item.');
      else abrirPagamento();
    }
  }

  function abrirPagamento() {
    setErroEnvio('');
    setPagamento(true);
  }

  useEffect(() => {
    function aoTeclar(e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return; // o diálogo (pagamento) trata o próprio Esc
      if (e.target.closest?.('.campo-tempo')) return; // Esc do campo de tempo desfaz a edição
      e.preventDefault();
      voltar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [voltar]);

  // ───────── Lançar ─────────

  const bairroDaTaxa = bairros.find((b) => String(b.id) === String(endereco.bairroId));
  const totais = totaisDoPedido(linhas, {
    taxaBairroCentavos: bairroDaTaxa?.taxaCentavos ?? 0,
    freteGratis: cardapio?.freteGratis ?? null,
    taxaManualCentavos: taxaManual,
    descontoCentavos: desconto,
    retirarNoBalcao,
  });

  async function finalizar(trocoParaCentavos) {
    let agendadoPara = null;
    if (encomenda) {
      const r = avaliarAgendamento(agendamento.data, agendamento.hora, new Date(), diaOperacional);
      if (r.erro) {
        setErroEnvio(`${r.erro}. Volte e ajuste o horário.`);
        return;
      }
      agendadoPara = r.instante.toISOString();
    }
    setEnviando(true);
    setErroEnvio('');
    try {
      const { pedido } = await chamar(
        pdv.pedidos.criar({
          clienteId: cliente.id,
          enderecoId: retirarNoBalcao ? null : enderecoId,
          itens: itensParaApi(linhas),
          formaPagamento: forma,
          trocoParaCentavos: pagoAgora ? null : trocoParaCentavos,
          chaveIdempotencia: chave.current,
          encomenda,
          agendadoPara,
          retirarNoBalcao,
          descontoCentavos: desconto,
          taxaEntregaCentavos: retirarNoBalcao ? null : taxaManual,
          observacao,
          pagoAgora,
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

  const instanteAgendado = new Date(`${agendamento.data}T${agendamento.hora}:00-03:00`);
  const textoTempo = encomenda
    ? `Encomenda p/ ${Number.isNaN(instanteAgendado.getTime()) ? '—' : formatarDataHora(instanteAgendado)}${retirarNoBalcao ? ' · retirar no balcão' : ''}`
    : tempoMin
      ? `Delivery · entrega em ~${tempoMin} min`
      : 'Delivery';

  return (
    <section className="novo-pedido" aria-labelledby="titulo-novo-pedido">
      <header className="novo-pedido__barra">
        <button type="button" className="botao-icone" onClick={sair} aria-label="Voltar para o painel" title="Voltar para o painel">
          <IconeSeta direcao="esquerda" />
        </button>
        <h2 id="titulo-novo-pedido">
          Novo pedido <span className="novo-pedido__etapa">· {NOME_ETAPA[etapa]}</span>
        </h2>
        <div className="novo-pedido__setas">
        <button type="button" className="botao-redondo botao-redondo--vermelho botao-redondo--grande" onClick={voltar}
          disabled={enviando || salvando} aria-label="Etapa anterior" title="Etapa anterior (Esc)">
          <IconeSeta direcao="esquerda" />
        </button>
        <button type="button" className="botao-redondo botao-redondo--verde botao-redondo--grande" onClick={avancar}
          disabled={enviando || salvando} aria-label={etapa === 'produtos' ? 'Pagamento' : 'Próxima etapa'}
          title={etapa === 'produtos' ? 'Pagamento' : 'Próxima etapa'}>
          <IconeSeta direcao="direita" />
        </button>
        </div>
      </header>

      {mensagem && (
        <p className="novo-pedido__mensagem" role="alert">
          {mensagem}
          {clienteExistente && (
            <button type="button" className="botao botao--pequeno" onClick={() => escolherCliente(clienteExistente)}>
              Usar {clienteExistente.nome}
            </button>
          )}
        </p>
      )}
      {salvando && <p className="novo-pedido__mensagem novo-pedido__mensagem--info" role="status">Salvando cliente…</p>}

      <div className={`novo-pedido__cartao ${['cliente', 'produtos'].includes(etapa) ? 'novo-pedido__cartao--largo' : ''}`}>
        {/* key = etapa: cada troca remonta e anima (entra da direita ao avançar, da esquerda ao voltar). */}
        <div key={etapa} className={`novo-pedido__tela novo-pedido__tela--${direcao}`}>
        {etapa === 'tipo' && (
          <EtapaTipo tipo={tipo} aoEscolher={escolherTipo} />
        )}
        {etapa === 'cliente' && (
          <EtapaCliente tipo={tipo} cliente={cliente} form={form} endereco={endereco} enderecoId={enderecoId}
            retirarNoBalcao={retirar} bairros={bairros} erros={errosCliente}
            aoEscolherCliente={escolherCliente} aoDesvincular={desvincularCliente} aoMudarForm={setForm}
            aoMudarEndereco={setEndereco} aoEscolherEndereco={escolherEndereco} aoMudarRetirar={setRetirar}
            agendamento={agendamento} aoMudarAgendamento={(v) => {
              setAgendamento(v);
              setErroAgendamento(null);
            }} erroAgendamento={erroAgendamento} horaVirada={horaVirada()} />
        )}
        {etapa === 'produtos' && (
          <EtapaProdutos cardapio={cardapio} carregando={carregandoCardapio} erroCardapio={erroCardapio}
            aoTrocarTurno={setTurnoId} aoRecarregar={() => carregarCardapio(turnoId)}
            linhas={linhas} aoMudarLinhas={setLinhas}
            nomeCliente={cliente?.nome ?? ''} textoTempo={textoTempo} totais={totais}
            retirarNoBalcao={retirarNoBalcao} taxaManual={taxaManual} aoMudarTaxaManual={setTaxaManual}
            desconto={desconto} aoMudarDesconto={setDesconto} observacao={observacao} aoMudarObservacao={setObservacao}
            aoVoltar={voltar} aoTrocarCliente={() => irPara(etapas.indexOf('cliente'))}
            aoRemoverCliente={() => {
              desvincularCliente();
              irPara(etapas.indexOf('cliente'));
            }}
            aoLancar={abrirPagamento} erroLancar={null} />
        )}
        </div>
        <ol className="novo-pedido__bolinhas" aria-label="Etapas">
          {etapas.map((e, i) => (
            <li key={e} className={`bolinha ${i === indice ? 'bolinha--atual' : ''} ${i < indice ? 'bolinha--feita' : ''}`}
              aria-current={i === indice ? 'step' : undefined}>
              <span className="visualmente-oculto">{NOME_ETAPA[e]}</span>
            </li>
          ))}
        </ol>
      </div>

      {pagamento && (
        <ModalPagamento totais={totais} retirarNoBalcao={retirarNoBalcao} forma={forma} aoMudarForma={setForma}
          troco={troco} aoMudarTroco={setTroco} pagoAgora={pagoAgora} aoMudarPagoAgora={setPagoAgora}
          enviando={enviando} erro={erroEnvio} aoFinalizar={finalizar} aoFechar={() => setPagamento(false)} />
      )}
    </section>
  );
}
