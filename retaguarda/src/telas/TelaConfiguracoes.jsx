import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { errosPorCampo, formatarWhatsapp } from '../lib/formatar.js';
import { Campo, CampoDinheiro, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/** Nome do restaurante, WhatsApp (link de cancelamento do site), tempo estimado padrão, virada do dia e frete grátis. */
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
      horaViradaDia: String(config.horaViradaDia ?? 4),
      freteGratisAtivo: Boolean(config.freteGratisAtivo),
      freteGratisMinimoCentavos: config.freteGratisMinimoCentavos ?? null,
      freteGratisTexto: config.freteGratisMinimoCentavos == null ? '' : 'preenchido',
      freteGratisWhatsapp: config.freteGratisWhatsapp ?? true,
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
    // Mínimo: vazio só se desligado (fica guardado para religar); digitado precisa ser válido e > 0.
    const minimo = f.freteGratisMinimoCentavos;
    const digitouMinimo = f.freteGratisTexto.trim() !== '';
    if (digitouMinimo && !(minimo > 0)) erro.freteGratisMinimoCentavos = 'Valor inválido, ex.: 69,00';
    else if (f.freteGratisAtivo && !digitouMinimo) erro.freteGratisMinimoCentavos = 'Informe a partir de quanto o frete é grátis';
    setErros(erro);
    if (Object.keys(erro).length) return;
    setSalvando(true);
    try {
      await api.config.salvar({
        nomeRestaurante: f.nomeRestaurante.trim(),
        whatsappNumero: f.whatsappNumero,
        tempoEstimadoPadraoMin: tempo,
        horaViradaDia: Number(f.horaViradaDia),
        freteGratisAtivo: f.freteGratisAtivo,
        freteGratisMinimoCentavos: digitouMinimo ? minimo : null,
        freteGratisWhatsapp: f.freteGratisWhatsapp,
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
        <Campo
          rotulo="Virada do dia"
          erro={erros.horaViradaDia}
          ajuda="O dia do restaurante (número do pedido, relatório, caixas) só vira nesta hora. Com 04:00, o pedido da 00:30 ainda conta no dia anterior."
        >
          {(id, d) => (
            <select id={id} className="entrada entrada--curta" value={f.horaViradaDia} aria-describedby={d} onChange={mudar('horaViradaDia')}>
              {Array.from({ length: 13 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00{h === 0 ? ' (meia-noite)' : ''}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo
          rotulo="Frete grátis a partir de (R$)"
          erro={erros.freteGratisMinimoCentavos}
          ajuda={
            f.freteGratisAtivo
              ? 'Pedidos de entrega com itens a partir deste valor não pagam a taxa do bairro. O site mostra quanto falta.'
              : 'Desligado: todo pedido paga a taxa do bairro e o site não mostra a barra de frete grátis.'
          }
        >
          {(id, d) => (
            <div className="linha-frete">
              <Interruptor
                ligado={f.freteGratisAtivo}
                rotulo={f.freteGratisAtivo ? 'Ligado' : 'Desligado'}
                aoMudar={(ligado) => {
                  setF((x) => ({ ...x, freteGratisAtivo: ligado }));
                  setErros((x) => ({ ...x, freteGratisMinimoCentavos: undefined }));
                }}
              />
              <CampoDinheiro
                id={id}
                valor={f.freteGratisMinimoCentavos}
                descritoPor={d}
                placeholder="69,00"
                invalido={Boolean(erros.freteGratisMinimoCentavos)}
                aoMudar={(c, texto) => {
                  setF((x) => ({ ...x, freteGratisMinimoCentavos: c, freteGratisTexto: texto }));
                  setErros((x) => ({ ...x, freteGratisMinimoCentavos: undefined }));
                }}
              />
            </div>
          )}
        </Campo>
        <div className="campo">
          <label className="opcao">
            <input
              type="checkbox"
              checked={f.freteGratisWhatsapp}
              onChange={(e) => setF((x) => ({ ...x, freteGratisWhatsapp: e.target.checked }))}
            />
            <span>Frete grátis vale também para os pedidos do WhatsApp lançados no PDV</span>
          </label>
          <p className="campo__ajuda">Desmarcado: só os pedidos feitos pelo site ganham frete grátis.</p>
        </div>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
