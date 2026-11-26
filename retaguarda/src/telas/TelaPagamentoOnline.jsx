import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarDataHora } from '../lib/formatar.js';
import { avisoDesconectar, descreverSituacao, mensagemDoRetorno, motivoInterruptorTravado } from '../lib/pagamentoOnline.js';
import { Confirmar, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Pagamento online da loja (DONO; ADMIN na loja aberta): conecta a conta Mercado Pago
 * da loja (o dinheiro dos produtos cai nela), desconecta e liga/desliga o pagamento
 * online no app. O Mercado Pago volta para cá com ?mp=conectada ou ?mp=erro&motivo=….
 */
export function TelaPagamentoOnline() {
  const carga = useCarregar(() => api.pagamentoOnline.obter());
  const avisar = useAvisar();
  const [retorno] = useState(() => mensagemDoRetorno(window.location.search));
  const [erroRetorno, setErroRetorno] = useState(retorno?.tipo === 'erro' ? retorno.texto : '');

  // A mensagem da volta aparece uma vez: a query sai do endereço (recarregar não repete).
  // Sucesso vira aviso; erro fica na página até fechar.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (retorno?.tipo === 'ok') avisar(retorno.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Pagamento online</h1>
          <p className="pagina__sub">
            Pix e cartão de crédito pelo app, com o dinheiro dos produtos caindo direto na conta Mercado Pago da loja.
          </p>
        </div>
      </div>
      {erroRetorno && (
        <div className="alerta" role="alert">
          {erroRetorno}{' '}
          <button type="button" className="botao botao--texto" onClick={() => setErroRetorno('')}>
            Fechar
          </button>
        </div>
      )}
      <EstadoCarga carga={carga}>{(s) => <Conteudo s={s} recarregar={carga.recarregar} avisar={avisar} />}</EstadoCarga>
    </>
  );
}

function Conteudo({ s, recarregar, avisar }) {
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const situacao = descreverSituacao(s);
  const travado = motivoInterruptorTravado(s);
  const conectada = s.situacao === 'CONECTADA' || s.situacao === 'EXPIRADA';

  async function conectar() {
    setOcupado(true);
    try {
      const { url } = await api.pagamentoOnline.conectar(window.location.origin);
      window.location.assign(url);
    } catch (err) {
      avisar(err.message, 'erro');
      setOcupado(false);
    }
  }

  async function pedirDesconexao() {
    setOcupado(true);
    try {
      const { pendentes } = await api.pagamentoOnline.desconectar(false);
      setConfirmar({
        titulo: 'Desconectar a conta Mercado Pago?',
        texto: avisoDesconectar(pendentes),
        confirmar: 'Desconectar',
        acao: async () => {
          await api.pagamentoOnline.desconectar(true);
          avisar('Conta Mercado Pago desconectada.');
          await recarregar();
        },
      });
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setOcupado(false);
    }
  }

  async function mudarAtivo(ativo) {
    setOcupado(true);
    try {
      await api.pagamentoOnline.ativo(ativo);
      avisar(ativo ? 'Pagamento online ligado.' : 'Pagamento online desligado.');
      await recarregar();
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <section className="cartao">
        <div className="cartao__topo">
          <h2 className="cartao__titulo">Conta Mercado Pago</h2>
          <span className={`etiqueta ${situacao.classe}`}>{situacao.rotulo}</span>
        </div>
        <div className="cartao__corpo" style={{ maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>{situacao.texto}</p>
          {s.situacao === 'CONECTADA' && (
            <p className="suave">
              Conectada em {formatarDataHora(s.conectadaEm)}
              {s.expiraEm && ` · renovação automática antes de ${formatarDataHora(s.expiraEm)}`}
            </p>
          )}
          {!s.configurado && (
            <div className="alerta">O pagamento online ainda não está configurado no servidor. Fale com o Taaki Delivery.</div>
          )}
          <p className="campo__ajuda">
            Você entra na sua conta Mercado Pago e autoriza o Taaki Delivery. A tarifa do Mercado Pago é descontada da loja;
            com os entregadores do Taaki, a taxa de entrega vai para a plataforma no mesmo pagamento.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s.situacao !== 'CONECTADA' && (
              <button type="button" className="botao botao--primario" disabled={ocupado || !s.configurado} onClick={conectar}>
                {s.situacao === 'EXPIRADA' ? 'Conectar de novo' : 'Conectar Mercado Pago'}
              </button>
            )}
            {conectada && (
              <button type="button" className="botao botao--perigo" disabled={ocupado} onClick={pedirDesconexao}>
                Desconectar
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="cartao" style={{ marginTop: 16 }}>
        <div className="cartao__topo">
          <h2 className="cartao__titulo">Pagamento online no app</h2>
        </div>
        <div className="cartao__corpo" style={{ maxWidth: 620 }}>
          <Interruptor
            ligado={s.pagamentoOnlineAtivo}
            rotulo={s.pagamentoOnlineAtivo ? 'Ligado' : 'Desligado'}
            desabilitado={ocupado || (Boolean(travado) && !s.pagamentoOnlineAtivo)}
            aoMudar={mudarAtivo}
          />
          <p className="campo__ajuda">
            {travado && !s.pagamentoOnlineAtivo
              ? travado
              : 'Ligado: o app oferece Pix e cartão de crédito pagos na hora. O pedido só chega ao PDV depois de pago.'}
          </p>
        </div>
      </section>
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}
