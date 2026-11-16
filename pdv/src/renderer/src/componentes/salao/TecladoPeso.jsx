import { useEffect, useRef, useState } from 'react';
import { formatarPreco } from '../../lib/formatar.js';
import { PESO_MAX_GRAMAS, lerGramas, teclarPeso, valorPorPeso } from '../../lib/salao.js';

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'limpar', '0', 'apagar'];
const ROTULO = { limpar: 'C', apagar: '⌫' };

/**
 * Teclado numérico do prato por kg: a atendente digita as gramas que a
 * balança mostrou (toque ou teclado físico; Enter lança, Esc fecha).
 * O valor exibido é só prévia: o oficial é calculado pela API.
 */
export function TecladoPeso({ produto, aoLancar, aoFechar }) {
  const dialogo = useRef(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const gramas = lerGramas(texto);

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  async function lancar() {
    if (!gramas || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await aoLancar(gramas);
      dialogo.current?.close();
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  function teclar(tecla) {
    setErro('');
    setTexto((t) => teclarPeso(t, tecla));
  }

  function aoTeclar(e) {
    if (/^\d$/.test(e.key)) teclar(e.key);
    else if (e.key === 'Backspace') teclar('apagar');
    else if (e.key === 'Delete') teclar('limpar');
    else if (e.key === 'Enter') lancar();
    else return;
    e.preventDefault();
  }

  return (
    <dialog ref={dialogo} className="painel teclado-peso" onClose={aoFechar} onKeyDown={aoTeclar}
      aria-labelledby="titulo-peso">
      <div className="painel__corpo">
        <div className="painel__topo">
          <h2 id="titulo-peso">{produto.nome}</h2>
          <span className="texto-suave">{formatarPreco(produto.precoCentavos)}/kg</span>
        </div>

        <output className="teclado-peso__visor" aria-live="polite">
          <span className="teclado-peso__gramas">{texto || '0'} g</span>
          <span className="teclado-peso__valor">{gramas ? formatarPreco(valorPorPeso(produto.precoCentavos, gramas)) : '—'}</span>
        </output>

        <div className="teclado-peso__teclas" role="group" aria-label="Teclado numérico">
          {TECLAS.map((t) => (
            <button key={t} type="button" className={`tecla ${ROTULO[t] ? 'tecla--acao' : ''}`} disabled={enviando}
              aria-label={t === 'apagar' ? 'Apagar' : t === 'limpar' ? 'Limpar' : t} onClick={() => teclar(t)}>
              {ROTULO[t] ?? t}
            </button>
          ))}
        </div>

        <p className="texto-suave">Digite as gramas da balança (até {PESO_MAX_GRAMAS} g).</p>
        {erro && <p className="erro" role="alert">{erro}</p>}

        <div className="painel__acoes">
          <button type="button" className="botao botao--contorno" disabled={enviando} onClick={() => dialogo.current?.close()}>
            Cancelar
          </button>
          <button type="button" className="botao botao--grande" disabled={!gramas || enviando} onClick={lancar}>
            {enviando ? 'Lançando…' : 'Lançar prato'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
