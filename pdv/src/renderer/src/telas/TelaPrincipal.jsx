import { useCallback, useEffect, useState } from 'react';
import { CAIXA_FECHADO_EVENTO, chamar, pdv } from '../lib/pdv.js';
import { definirHoraVirada } from '../lib/caixa.js';
import { BarraSuperior } from '../componentes/BarraSuperior.jsx';
import { PainelDelivery } from '../componentes/painel/PainelDelivery.jsx';
import { NovoPedido } from '../componentes/novo-pedido/NovoPedido.jsx';
import { Salao } from '../componentes/salao/Salao.jsx';
import { TelaAbrirCaixa } from '../componentes/caixa/TelaAbrirCaixa.jsx';
import { PainelCaixa } from '../componentes/caixa/PainelCaixa.jsx';

const AVISO_MS = 6000;

export function TelaPrincipal({ usuario, aoSair, aoTrocarLoja }) {
  const [aba, setAba] = useState('delivery');
  const [lancando, setLancando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [status, setStatus] = useState('reconectando');
  const [saindo, setSaindo] = useState(false);
  // undefined = ainda não sabe (carregando/sem rede): não bloqueia a tela.
  const [caixa, setCaixa] = useState(undefined);
  const [painelCaixa, setPainelCaixa] = useState(false);
  // Aumenta a cada pedido lançado: o painel recarrega a lista (além do evento do socket).
  const [recarga, setRecarga] = useState(0);

  const carregarCaixa = useCallback(async () => {
    try {
      const r = await chamar(pdv.caixa.atual());
      definirHoraVirada(r.horaViradaDia);
      setCaixa(r.caixa);
    } catch {
      // Sem rede: mantém o que sabia; a API recusa finalizar se o caixa estiver fechado.
    }
  }, []);

  // Caixa: ao entrar, a cada (re)conexão, quando outro PDV abre/fecha/movimenta
  // e quando uma operação recebe 409 CAIXA_FECHADO.
  useEffect(() => {
    carregarCaixa();
    const pararEvento = pdv.aoEvento('caixa:atualizado', (d) => setCaixa(d?.caixa ?? null));
    window.addEventListener(CAIXA_FECHADO_EVENTO, carregarCaixa);
    return () => {
      pararEvento();
      window.removeEventListener(CAIXA_FECHADO_EVENTO, carregarCaixa);
    };
  }, [carregarCaixa]);

  useEffect(() => {
    if (status === 'conectado') carregarCaixa();
  }, [status, carregarCaixa]);

  const semCaixa = caixa === null;

  useEffect(() => {
    chamar(pdv.tempoReal.status()).then(setStatus, () => {});
    return pdv.aoEvento('socket:status', setStatus);
  }, []);

  // F2: novo pedido (delivery/encomenda) de qualquer lugar da tela principal.
  useEffect(() => {
    function aoTeclar(e) {
      // Com o painel da impressora aberto (modal), F2 não abre nada por trás.
      if (e.key !== 'F2' || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      setAba('delivery');
      setLancando(true);
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  useEffect(() => {
    if (!aviso) return undefined;
    const id = setTimeout(() => setAviso(''), AVISO_MS);
    return () => clearTimeout(id);
  }, [aviso]);

  async function sair() {
    setSaindo(true);
    try {
      await chamar(pdv.sessao.sair());
    } finally {
      aoSair();
    }
  }

  return (
    <div className="principal">
      <BarraSuperior aba={aba} aoTrocarAba={setAba} statusConexao={status} usuario={usuario}
        aoSair={sair} saindo={saindo} caixa={caixa} aoAbrirCaixa={() => setPainelCaixa(true)} aoTrocarLoja={aoTrocarLoja} />
      {/* Novo pedido ocupa a tela toda, sem a margem creme. */}
      <main className={`conteudo ${!semCaixa && aba === 'delivery' && lancando ? 'conteudo--cheio' : ''}`}>
        {aviso && (
          <p className="aviso-sucesso" role="status">
            {aviso}
          </p>
        )}
        {semCaixa && (
          <TelaAbrirCaixa usuario={usuario}
            aoAbrir={(c, { recarregar } = {}) => {
              if (recarregar) carregarCaixa();
              else setCaixa(c);
            }} />
        )}
        {/* O painel fica montado mesmo no Salão, durante o lançamento e com o caixa fechado: o alerta continua tocando. */}
        <div hidden={semCaixa || aba !== 'delivery' || lancando}>
          <PainelDelivery statusConexao={status} aoNovoPedido={() => setLancando(true)} recarga={recarga} />
        </div>
        {!semCaixa && aba === 'delivery' && lancando && (
          <NovoPedido
            aoSair={() => setLancando(false)}
            aoConcluir={(pedido) => {
              setLancando(false);
              setRecarga((n) => n + 1);
              const tipo = pedido.encomenda ? 'Encomenda' : 'Pedido';
              setAviso(`${tipo} #${pedido.numeroDia} ${pedido.encomenda ? 'lançada' : 'lançado'} (${pedido.nomeCliente}).`);
            }}
          />
        )}
        {!semCaixa && aba === 'salao' && <Salao statusConexao={status} />}
      </main>
      {painelCaixa && caixa && (
        <PainelCaixa caixa={caixa} aoMudar={setCaixa} aoFechar={() => setPainelCaixa(false)}
          aoFechado={(mensagem) => {
            setCaixa(null);
            setAviso(mensagem);
          }} />
      )}
    </div>
  );
}
