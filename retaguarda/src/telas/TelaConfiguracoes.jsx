import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { errosPorCampo, formatarWhatsapp } from '../lib/formatar.js';
import { Campo, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/** Nome do restaurante, WhatsApp (link de cancelamento do site) e tempo estimado padrão. */
export function TelaConfiguracoes() {
  const carga = useCarregar(() => api.config.obter());
  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Configurações</h1>
          <p className="pagina__sub">Valem para o site, o PDV e os cupons.</p>
        </div>
      </div>
      <EstadoCarga carga={carga}>{({ config }) => <FormConfig config={config} aoSalvar={carga.recarregar} />}</EstadoCarga>
    </>
  );
}

function FormConfig({ config, aoSalvar }) {
  const avisar = useAvisar();
  const [f, setF] = useState(null);
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setF({
      nomeRestaurante: config.nomeRestaurante,
      whatsappNumero: formatarWhatsapp(config.whatsappNumero),
      tempoEstimadoPadraoMin: String(config.tempoEstimadoPadraoMin),
    });
  }, [config]);
  if (!f) return null;

  const mudar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));

  async function salvar(e) {
    e.preventDefault();
    const tempo = Number(f.tempoEstimadoPadraoMin);
    const erro = {};
    if (!f.nomeRestaurante.trim()) erro.nomeRestaurante = 'Informe o nome';
    if (!Number.isInteger(tempo) || tempo < 1 || tempo > 240) erro.tempoEstimadoPadraoMin = 'Entre 1 e 240 minutos';
    setErros(erro);
    if (Object.keys(erro).length) return;
    setSalvando(true);
    try {
      await api.config.salvar({
        nomeRestaurante: f.nomeRestaurante.trim(),
        whatsappNumero: f.whatsappNumero,
        tempoEstimadoPadraoMin: tempo,
      });
      avisar('Configurações salvas.');
      await aoSalvar();
    } catch (err) {
      const porCampo = errosPorCampo(err);
      setErros(porCampo);
      if (!Object.keys(porCampo).length) avisar(err.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="cartao" onSubmit={salvar} noValidate>
      <div className="cartao__corpo" style={{ maxWidth: 520 }}>
        <Campo rotulo="Nome do restaurante" erro={erros.nomeRestaurante} ajuda="Sai no topo dos cupons.">
          {(id, d) => (
            <input id={id} className="entrada" maxLength={60} value={f.nomeRestaurante} aria-describedby={d} onChange={mudar('nomeRestaurante')} />
          )}
        </Campo>
        <Campo
          rotulo="WhatsApp do restaurante"
          erro={erros.whatsappNumero}
          ajuda="Com DDD. O site usa para o cliente pedir cancelamento."
        >
          {(id, d) => (
            <input
              id={id}
              className="entrada"
              type="tel"
              inputMode="tel"
              placeholder="(43) 99999-0000"
              value={f.whatsappNumero}
              aria-invalid={Boolean(erros.whatsappNumero) || undefined}
              aria-describedby={d}
              onChange={mudar('whatsappNumero')}
            />
          )}
        </Campo>
        <Campo
          rotulo="Tempo estimado padrão (min)"
          erro={erros.tempoEstimadoPadraoMin}
          ajuda="Vale quando a atendente não digita um tempo no PDV naquele dia."
        >
          {(id, d) => (
            <input
              id={id}
              className="entrada entrada--curta"
              inputMode="numeric"
              value={f.tempoEstimadoPadraoMin}
              aria-describedby={d}
              onChange={(e) => setF((x) => ({ ...x, tempoEstimadoPadraoMin: e.target.value.replace(/\D/g, '') }))}
            />
          )}
        </Campo>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
