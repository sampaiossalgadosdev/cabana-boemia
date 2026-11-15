import { useEffect, useMemo, useRef, useState } from 'react';
import { formatarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../cliente/ClienteContext.jsx';
import { useCarrinho } from '../carrinho/CarrinhoContext.jsx';
import { mensagensDaConciliacao } from '../carrinho/carrinho.js';
import { sessaoExpirou } from '../cliente/sessao.js';
import * as api from '../lib/api.js';
import { formatarPreco } from '../lib/dinheiro.js';
import {
  FORMAS_PAGAMENTO,
  resumoDoPedido,
  corpoDoPedido,
  lerReais,
  erroDoTroco,
  novaChavePedido,
  aplicarPrecosNovos,
} from '../pedido/pedido.js';

const ERRO_GENERICO = 'Não foi possível enviar agora. Confira sua conexão e tente de novo.';

/** Erros da API que significam "o cardápio mudou": recarregar e conciliar o carrinho. */
const CARDAPIO_MUDOU = new Set(['ESTOQUE_INSUFICIENTE', 'PRODUTO_INDISPONIVEL', 'LOJA_FECHADA']);

const textoEndereco = (e) =>
  `${e.rua}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`;

function NovoEndereco({ bairros, onSalvo, onCancelar }) {
  const { token } = useCliente();
  const [dados, setDados] = useState({ rua: '', numero: '', complemento: '', referencia: '', bairroId: '' });
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (e) => setDados((d) => ({ ...d, [campo]: e.target.value }));

  const salvar = async (e) => {
    e.preventDefault();
    const novos = {};
    if (!dados.rua.trim()) novos.rua = 'Informe a rua';
    if (!dados.numero.trim()) novos.numero = 'Informe o número';
    if (!dados.bairroId) novos.bairroId = 'Escolha o bairro';
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    try {
      const { endereco } = await api.criarEndereco(token, { ...dados, bairroId: Number(dados.bairroId) });
      onSalvo(endereco);
    } catch (err) {
      const porCampo = Object.fromEntries((err.detalhes ?? []).map((d) => [d.campo, d.mensagem]));
      setErros(Object.keys(porCampo).length ? porCampo : { geral: err.status ? err.message : ERRO_GENERICO });
    } finally {
      setSalvando(false);
    }
  };

  const campo = (id, rotulo, props = {}) => (
    <div className="campo">
      <label className="campo__rotulo" htmlFor={`end-${id}`}>
        {rotulo}
      </label>
      <input
        id={`end-${id}`}
        value={dados[id]}
        onChange={mudar(id)}
        aria-invalid={Boolean(erros[id])}
        {...props}
      />
      {erros[id] && <p className="erro">{erros[id]}</p>}
    </div>
  );

  return (
    <form className="checkout-passo" onSubmit={salvar} noValidate aria-label="Novo endereço">
      <h3 className="checkout-passo__titulo">Endereço de entrega</h3>
      {campo('rua', 'Rua', { autoComplete: 'address-line1', maxLength: 120 })}
      {campo('numero', 'Número', { inputMode: 'numeric', maxLength: 20 })}
      <div className="campo">
        <label className="campo__rotulo" htmlFor="end-bairroId">
          Bairro
        </label>
        <select id="end-bairroId" value={dados.bairroId} onChange={mudar('bairroId')} aria-invalid={Boolean(erros.bairroId)}>
          <option value="">Escolha…</option>
          {bairros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome} · entrega {formatarPreco(b.taxaCentavos)}
            </option>
          ))}
        </select>
        {erros.bairroId && <p className="erro">{erros.bairroId}</p>}
      </div>
      {campo('complemento', 'Complemento (opcional)', { maxLength: 120 })}
      {campo('referencia', 'Ponto de referência (opcional)', { maxLength: 200 })}
      {erros.geral && (
        <p className="erro" role="alert">
          {erros.geral}
        </p>
      )}
      <button type="submit" className="botao botao--primario botao--bloco checkout-passo__acao" disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar endereço'}
      </button>
      {onCancelar && (
        <button type="button" className="botao botao--texto botao--bloco" onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </form>
  );
}

function EscolherEndereco({ enderecos, selecionado, onEscolher, onNovo }) {
  return (
    <fieldset className="opcoes">
      <legend className="checkout-passo__titulo">Entregar em</legend>
      {enderecos.map((e) => (
        <label key={e.id} className="opcao">
          <input
            type="radio"
            name="endereco"
            checked={e.id === selecionado}
            disabled={!e.bairro.ativo}
            onChange={() => onEscolher(e.id)}
          />
          <span>
            {textoEndereco(e)}
            <small>
              {e.bairro.nome}
              {e.bairro.ativo ? ` · entrega ${formatarPreco(e.bairro.taxaCentavos)}` : ' · não entregamos mais aqui'}
            </small>
          </span>
        </label>
      ))}
      <button type="button" className="botao botao--texto" onClick={onNovo}>
        + Novo endereço
      </button>
    </fieldset>
  );
}

/**
 * Depois do login e do telefone: confirmar dados (um toque), pagamento,
 * resumo com taxa e envio. O total aqui é prévia; vale o que a API devolver.
 */
export function Finalizacao({ onEditarTelefone, onPedidoEnviado, onCardapioDesatualizado }) {
  const { token, cliente, sair } = useCliente();
  const { itens, substituir } = useCarrinho();

  const [enderecos, setEnderecos] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [enderecoId, setEnderecoId] = useState(null);
  const [modoEndereco, setModoEndereco] = useState(null); // null | 'escolher' | 'novo'
  const [etapa, setEtapa] = useState('confirmar'); // 'confirmar' | 'pagamento'
  const [forma, setForma] = useState('');
  const [precisaTroco, setPrecisaTroco] = useState(false);
  const [trocoTexto, setTrocoTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const chave = useRef(novaChavePedido());

  useEffect(() => {
    let vivo = true;
    Promise.all([api.listarEnderecos(token), api.buscarBairros()])
      .then(([{ enderecos: lista }, { bairros: b }]) => {
        if (!vivo) return;
        setEnderecos(lista);
        setBairros(b);
        const inicial = lista.find((e) => e.principal && e.bairro.ativo) ?? lista.find((e) => e.bairro.ativo);
        setEnderecoId(inicial?.id ?? null);
        if (!inicial) setModoEndereco('novo');
      })
      .catch((err) => {
        if (!vivo) return;
        if (sessaoExpirou(err)) sair();
        else setErro(ERRO_GENERICO);
      });
    return () => {
      vivo = false;
    };
  }, [token, sair]);

  const endereco = enderecos?.find((e) => e.id === enderecoId) ?? null;
  const resumo = useMemo(() => resumoDoPedido(itens, endereco?.bairro.taxaCentavos ?? 0), [itens, endereco]);
  const trocoCentavos = forma === 'DINHEIRO' && precisaTroco ? lerReais(trocoTexto) : null;
  const erroTroco =
    forma === 'DINHEIRO' && precisaTroco
      ? trocoCentavos == null
        ? 'Informe o valor, ex.: 100'
        : erroDoTroco(trocoCentavos, resumo.totalCentavos)
      : null;

  if (!enderecos) {
    return erro ? (
      <p className="erro" role="alert">
        {erro}
      </p>
    ) : (
      <p className="nota">Carregando seus endereços…</p>
    );
  }

  if (modoEndereco === 'novo' || (!endereco && modoEndereco !== 'escolher')) {
    return (
      <NovoEndereco
        bairros={bairros}
        onCancelar={enderecos.some((e) => e.bairro.ativo) ? () => setModoEndereco(null) : null}
        onSalvo={(novo) => {
          setEnderecos((lista) => [novo, ...lista.map((e) => (novo.principal ? { ...e, principal: false } : e))]);
          setEnderecoId(novo.id);
          setModoEndereco(null);
        }}
      />
    );
  }

  if (modoEndereco === 'escolher') {
    return (
      <section className="checkout-passo">
        <EscolherEndereco
          enderecos={enderecos}
          selecionado={enderecoId}
          onEscolher={(id) => {
            setEnderecoId(id);
            setModoEndereco(null);
          }}
          onNovo={() => setModoEndereco('novo')}
        />
      </section>
    );
  }

  const cartaoDados = (
    <div className="dados-entrega">
      <div className="dados-entrega__linha">
        <div>
          <span className="dados-entrega__rotulo">Telefone</span>
          <strong>{formatarTelefone(cliente.telefone)}</strong>
        </div>
        <button type="button" className="botao botao--texto" onClick={onEditarTelefone}>
          Alterar
        </button>
      </div>
      <div className="dados-entrega__linha">
        <div>
          <span className="dados-entrega__rotulo">Entregar em</span>
          <strong>{textoEndereco(endereco)}</strong>
          <small>
            {endereco.bairro.nome}
            {endereco.referencia ? ` · ${endereco.referencia}` : ''}
          </small>
        </div>
        <button type="button" className="botao botao--texto" onClick={() => setModoEndereco('escolher')}>
          Trocar
        </button>
      </div>
    </div>
  );

  if (etapa === 'confirmar') {
    return (
      <section className="checkout-passo" aria-labelledby="titulo-confirmar">
        <h3 id="titulo-confirmar" className="checkout-passo__titulo">
          Confirme seus dados, {cliente.nome.split(' ')[0]}
        </h3>
        {cartaoDados}
        <button
          type="button"
          className="botao botao--primario botao--bloco checkout-passo__acao"
          onClick={() => setEtapa('pagamento')}
        >
          Confirmar dados
        </button>
        <button type="button" className="botao botao--texto botao--bloco" onClick={sair}>
          Não é você? Sair
        </button>
      </section>
    );
  }

  const enviar = async () => {
    setErro('');
    if (!forma) return setErro('Escolha a forma de pagamento.');
    if (erroTroco) return setErro(erroTroco);
    setEnviando(true);
    try {
      const corpo = corpoDoPedido(itens, {
        enderecoId,
        formaPagamento: forma,
        trocoParaCentavos: trocoCentavos,
        chaveIdempotencia: chave.current,
        totalEsperadoCentavos: resumo.totalCentavos,
      });
      const { pedido } = await api.enviarPedido(token, corpo);
      onPedidoEnviado(pedido);
    } catch (err) {
      if (sessaoExpirou(err)) return sair();
      if (err.codigo === 'PRECO_ALTERADO') {
        // Nada foi criado nem baixado: atualiza carrinho e taxa e pede nova confirmação.
        // O aviso vai no texto da própria gaveta: os avisos flutuantes ficam
        // atrás do <dialog> aberto.
        const r = aplicarPrecosNovos(itens, err.detalhes?.itens);
        if (r.alterados.length) substituir(r.itens);
        const linhas = mensagensDaConciliacao({ removidos: [], precosAlterados: r.alterados });
        const taxa = err.detalhes?.taxaEntregaCentavos;
        if (Number.isInteger(taxa) && taxa !== endereco.bairro.taxaCentavos) {
          setEnderecos((lista) =>
            lista.map((e) => (e.id === enderecoId ? { ...e, bairro: { ...e.bairro, taxaCentavos: taxa } } : e)),
          );
          linhas.push(`A taxa de entrega mudou para ${formatarPreco(taxa)}.`);
        }
        onCardapioDesatualizado();
        return setErro(
          [...(linhas.length ? linhas : ['Os preços mudaram.']), 'Confira o novo total e toque em "Enviar pedido" para confirmar.'].join(' '),
        );
      }
      if (CARDAPIO_MUDOU.has(err.codigo)) onCardapioDesatualizado();
      // Com status: a API recusou (nada foi criado). Sem status: rede; a mesma
      // chave garante que tentar de novo não duplica o pedido.
      setErro(err.status ? err.message : ERRO_GENERICO);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section className="checkout-passo" aria-labelledby="titulo-pagamento">
      <fieldset className="opcoes">
        <legend id="titulo-pagamento" className="checkout-passo__titulo">
          Forma de pagamento
        </legend>
        <p className="nota nota--esquerda">Pagamento na entrega.</p>
        {FORMAS_PAGAMENTO.map((f) => (
          <label key={f.valor} className="opcao">
            <input type="radio" name="pagamento" value={f.valor} checked={forma === f.valor} onChange={() => setForma(f.valor)} />
            <span>{f.rotulo}</span>
          </label>
        ))}
      </fieldset>

      {forma === 'DINHEIRO' && (
        <div className="troco">
          <label className="opcao opcao--simples">
            <input type="checkbox" checked={precisaTroco} onChange={(e) => setPrecisaTroco(e.target.checked)} />
            <span>Preciso de troco</span>
          </label>
          {precisaTroco && (
            <div className="campo">
              <label className="campo__rotulo" htmlFor="troco">
                Troco para quanto?
              </label>
              <div className="campo-reais">
                <span aria-hidden="true">R$</span>
                <input
                  id="troco"
                  inputMode="decimal"
                  placeholder="100"
                  value={trocoTexto}
                  onChange={(e) => setTrocoTexto(e.target.value)}
                  aria-invalid={Boolean(trocoTexto && erroTroco)}
                />
              </div>
              {trocoTexto && erroTroco && <p className="erro">{erroTroco}</p>}
            </div>
          )}
        </div>
      )}

      <dl className="resumo">
        <div>
          <dt>Itens</dt>
          <dd>{formatarPreco(resumo.subtotalCentavos)}</dd>
        </div>
        <div>
          <dt>Entrega ({endereco.bairro.nome})</dt>
          <dd>{formatarPreco(resumo.taxaEntregaCentavos)}</dd>
        </div>
        <div className="resumo__total">
          <dt>Total</dt>
          <dd>{formatarPreco(resumo.totalCentavos)}</dd>
        </div>
      </dl>
      <p className="nota nota--esquerda">
        {textoEndereco(endereco)} · {formatarTelefone(cliente.telefone)}{' '}
        <button type="button" className="botao botao--texto" onClick={() => setEtapa('confirmar')}>
          Alterar
        </button>
      </p>

      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
      <button
        type="button"
        className="botao botao--primario botao--bloco checkout-passo__acao"
        onClick={enviar}
        disabled={enviando || itens.length === 0}
      >
        {enviando ? 'Enviando…' : `Enviar pedido · ${formatarPreco(resumo.totalCentavos)}`}
      </button>
    </section>
  );
}
