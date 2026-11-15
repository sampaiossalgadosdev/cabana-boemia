import { useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { Logo } from '../componentes/Logo.jsx';

/** Endereço da API. Na primeira execução do app instalado, é a primeira tela. */
export function TelaConfiguracao({ apiUrl, aoSalvar, aoVoltar }) {
  const [url, setUrl] = useState(apiUrl ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(e) {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      const r = await chamar(pdv.config.definirApiUrl(url));
      aoSalvar(r.apiUrl);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="tela-centro">
      <form className="cartao-login" onSubmit={salvar}>
        <Logo className="cartao-login__logo" />
        <h1 className="cartao-login__titulo">Servidor do PDV</h1>
        <p className="cartao-login__texto">Informe o endereço da API do Cabana Boemia.</p>
        <label className="campo">
          <span>Endereço da API</span>
          <input type="url" required autoFocus placeholder="https://…up.railway.app" value={url}
            onChange={(e) => setUrl(e.target.value)} />
        </label>
        {erro && <p className="erro" role="alert">{erro}</p>}
        <button type="submit" className="botao botao--largo" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
        {aoVoltar && (
          <button type="button" className="botao botao--contorno botao--largo" onClick={aoVoltar}>
            Voltar
          </button>
        )}
      </form>
    </div>
  );
}
