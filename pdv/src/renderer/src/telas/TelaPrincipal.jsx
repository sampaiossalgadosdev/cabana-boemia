import { useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { BarraSuperior } from '../componentes/BarraSuperior.jsx';
import { FilaPedidos } from '../componentes/FilaPedidos.jsx';

export function TelaPrincipal({ usuario, aoSair }) {
  const [aba, setAba] = useState('delivery');
  const [status, setStatus] = useState('reconectando');
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    chamar(pdv.tempoReal.status()).then(setStatus, () => {});
    return pdv.aoEvento('socket:status', setStatus);
  }, []);

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
        {/* A fila fica montada mesmo no Salão: o alerta continua tocando. */}
        <div hidden={aba !== 'delivery'}>
          <FilaPedidos statusConexao={status} />
        </div>
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
