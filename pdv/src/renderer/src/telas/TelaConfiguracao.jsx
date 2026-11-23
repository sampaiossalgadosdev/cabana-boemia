import { useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { Logo } from '../componentes/Logo.jsx';

/**
 * Endereço do servidor. Na primeira execução do app instalado é a primeira tela,
 * já preenchida com o servidor de produção (`sugestao`), editável.
 */
export function TelaConfiguracao({ apiUrl, sugestao = '', aoSalvar, aoVoltar }) {
  const [url, setUrl] = useState(apiUrl ?? sugestao ?? '');
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
        <p className="cartao-login__texto">Endereço do servidor do Táqui Delivery. Confira e salve.</p>
        <label className="campo">
          <span>Endereço do servidor</span>
          <input type="url" required autoFocus placeholder="https://cabana.managerpix.com.br" value={url}
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
