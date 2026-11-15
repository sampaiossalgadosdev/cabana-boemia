import { useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { Logo } from '../componentes/Logo.jsx';

export function TelaLogin({ apiUrl, aviso, aoEntrar, aoConfigurar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function entrar(e) {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      aoEntrar(await chamar(pdv.sessao.entrar(email, senha)));
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="tela-centro">
      <form className="cartao-login" onSubmit={entrar}>
        <Logo className="cartao-login__logo" />
        <h1 className="cartao-login__titulo">Entrar no PDV</h1>
        {aviso && <p className="aviso" role="status">{aviso}</p>}

        <label className="campo">
          <span>Email</span>
          <input type="email" autoComplete="username" autoFocus required value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input type="password" autoComplete="current-password" required value={senha}
            onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <p className="erro" role="alert">{erro}</p>}

        <button type="submit" className="botao botao--largo" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="cartao-login__servidor">
          Servidor: <span>{apiUrl}</span>{' '}
          <button type="button" className="link" onClick={aoConfigurar}>alterar</button>
        </p>
      </form>
    </div>
  );
}
