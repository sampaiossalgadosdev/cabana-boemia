import { useCallback, useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';

const MIN = 1;
const MAX = 240;
const RECARREGAR_MS = 5 * 60_000; // o manual expira na virada do dia

/**
 * "Tempo estimado (min)": mostra o manual de hoje (ou vazio) com o padrão no
 * placeholder. Grava ao sair do campo ou no Enter; vazio volta ao padrão;
 * Esc desfaz. Aceita inteiros de 1 a 240.
 */
export function CampoTempo() {
  const [tempo, setTempo] = useState(null); // { padraoMin, manualMin, vigenteMin }
  const [valor, setValor] = useState('');
  const [estado, setEstado] = useState({ tipo: 'ocioso' }); // ocioso | salvando | salvo | erro
  const editando = useRef(false);

  const aplicar = useCallback((t) => {
    setTempo(t);
    if (!editando.current) setValor(t.manualMin == null ? '' : String(t.manualMin));
  }, []);

  useEffect(() => {
    let ativo = true;
    const carregar = () =>
      chamar(pdv.tempo.obter())
        .then((t) => ativo && aplicar(t))
        .catch(() => {});
    carregar();
    const id = setInterval(carregar, RECARREGAR_MS);
    // O dono pode ter mudado o tempo padrão na retaguarda (placeholder).
    const parar = pdv.aoEvento('cardapio:atualizado', ({ origem } = {}) => origem === 'config' && carregar());
    return () => {
      ativo = false;
      clearInterval(id);
      parar();
    };
  }, [aplicar]);

  async function salvar() {
    editando.current = false;
    if (!tempo) return;
    const texto = valor.trim();
    const atual = tempo.manualMin == null ? '' : String(tempo.manualMin);
    if (texto === atual) return;

    let minutos = null;
    if (texto !== '') {
      minutos = Number(texto);
      if (!Number.isInteger(minutos) || minutos < MIN || minutos > MAX) {
        setEstado({ tipo: 'erro', mensagem: `Use de ${MIN} a ${MAX} min` });
        return;
      }
    }
    setEstado({ tipo: 'salvando' });
    try {
      aplicar(await chamar(pdv.tempo.definir(minutos)));
      setEstado({ tipo: 'salvo' });
      setTimeout(() => setEstado((e) => (e.tipo === 'salvo' ? { tipo: 'ocioso' } : e)), 2000);
    } catch (err) {
      setEstado({ tipo: 'erro', mensagem: err.message });
    }
  }

  function aoTeclar(e) {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      editando.current = false;
      setValor(tempo?.manualMin == null ? '' : String(tempo.manualMin));
      setEstado({ tipo: 'ocioso' });
      e.currentTarget.blur();
    }
  }

  const dica =
    estado.tipo === 'erro'
      ? estado.mensagem
      : estado.tipo === 'salvando'
        ? 'Salvando…'
        : estado.tipo === 'salvo'
          ? 'Salvo'
          : tempo && tempo.manualMin == null
            ? `Padrão: ${tempo.padraoMin} min`
            : 'Vazio volta ao padrão';

  return (
    <label className={`campo-tempo ${estado.tipo === 'erro' ? 'campo-tempo--erro' : ''}`}>
      <span className="campo-tempo__rotulo">Tempo estimado (min)</span>
      <input
        type="number"
        inputMode="numeric"
        min={MIN}
        max={MAX}
        step="1"
        value={valor}
        placeholder={tempo ? String(tempo.padraoMin) : ''}
        disabled={!tempo}
        onFocus={() => (editando.current = true)}
        onChange={(e) => {
          setValor(e.target.value);
          if (estado.tipo === 'erro') setEstado({ tipo: 'ocioso' });
        }}
        onBlur={salvar}
        onKeyDown={aoTeclar}
        aria-describedby="dica-tempo"
      />
      <span id="dica-tempo" className="campo-tempo__dica" aria-live="polite">
        {dica}
      </span>
    </label>
  );
}
