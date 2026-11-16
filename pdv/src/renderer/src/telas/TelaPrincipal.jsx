import { useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { BarraSuperior } from '../componentes/BarraSuperior.jsx';
import { FilaPedidos } from '../componentes/FilaPedidos.jsx';
import { NovoDelivery } from '../componentes/delivery/NovoDelivery.jsx';

const AVISO_MS = 6000;

export function TelaPrincipal({ usuario, aoSair }) {
  const [aba, setAba] = useState('delivery');
  const [lancando, setLancando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [status, setStatus] = useState('reconectando');
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    chamar(pdv.tempoReal.status()).then(setStatus, () => {});
    return pdv.aoEvento('socket:status', setStatus);
  }, []);

  // F2: novo delivery de qualquer lugar da tela principal.
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
        aoSair={sair} saindo={saindo} />
      <main className="conteudo">
        {aviso && (
          <p className="aviso-sucesso" role="status">
            {aviso}
          </p>
        )}
        {/* A fila fica montada mesmo no Salão e durante o lançamento: o alerta continua tocando. */}
        <div hidden={aba !== 'delivery' || lancando}>
          <FilaPedidos statusConexao={status} aoNovoDelivery={() => setLancando(true)} />
        </div>
        {aba === 'delivery' && lancando && (
          <NovoDelivery
            aoSair={() => setLancando(false)}
            aoConcluir={(pedido) => {
              setLancando(false);
              setAviso(`Pedido #${pedido.numeroDia} lançado (${pedido.nomeCliente}).`);
            }}
          />
        )}
        {aba === 'salao' && (
          <section className="em-breve">
            <h2>Salão</h2>
            <p>Comandas do salão chegam numa próxima etapa.</p>
          </section>
        )}
      </main>
    </div>
  );
}
