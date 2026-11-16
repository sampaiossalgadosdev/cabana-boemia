import { useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { lerValorCaixa } from '../../lib/caixa.js';

/**
 * Sem caixa aberto: pede o fundo de troco. A fila de pedidos continua montada
 * por trás (o alerta do site segue tocando); finalizar só depois de abrir.
 */
export function TelaAbrirCaixa({ usuario, aoAbrir }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function abrir(e) {
    e.preventDefault();
    const { centavos, erro: invalido } = lerValorCaixa(texto);
    if (invalido) {
      setErro(invalido);
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      const { caixa } = await chamar(pdv.caixa.abrir(centavos));
      aoAbrir(caixa);
    } catch (err) {
      // Outro PDV abriu no mesmo instante: segue com o caixa dele.
      if (err.codigo === 'CAIXA_JA_ABERTO') aoAbrir(null, { recarregar: true });
      else setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <section className="abrir-caixa" aria-labelledby="titulo-abrir-caixa">
      <form className="abrir-caixa__cartao" onSubmit={abrir}>
        <h2 id="titulo-abrir-caixa">Abrir caixa</h2>
        <p className="texto-suave">
          Olá, {usuario.nome}. Conte o dinheiro da gaveta e informe o fundo de troco para começar.
        </p>
        <label className="campo">
          Valor inicial (R$)
          <input className="campo__grande" inputMode="decimal" placeholder="0,00" value={texto} autoFocus
            disabled={enviando} aria-invalid={Boolean(erro)}
            onChange={(e) => {
              setTexto(e.target.value);
              setErro('');
            }} />
        </label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button type="submit" className="botao botao--grande botao--largo" disabled={enviando}>
          {enviando ? 'Abrindo…' : 'Abrir caixa'}
        </button>
        <p className="texto-suave abrir-caixa__nota">Pedidos do site continuam chegando na fila (com o aviso sonoro).</p>
      </form>
    </section>
  );
}
