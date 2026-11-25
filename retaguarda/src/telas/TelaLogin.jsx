import { useState } from 'react';
import { sessao } from '../lib/api.js';
import { Campo, LogoLoja } from '../componentes/comuns.jsx';
import { temaDaLoja } from '../lib/tema.js';

export function TelaLogin({ aoEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    if (!email.trim() || !senha) {
      setErro('Informe email e senha.');
      return;
    }
    setEntrando(true);
    setErro('');
    try {
      aoEntrar(await sessao.entrar(email.trim(), senha));
    } catch (err) {
      setErro(err.message);
      setEntrando(false);
    }
  }

  // O login é da plataforma (dono, atendente e ADMIN entram por aqui): sempre o estilo do Taaki.
  const taaki = temaDaLoja(null);

  return (
    <main className="login">
      <form className="login__cartao" onSubmit={entrar} noValidate>
        <LogoLoja className="login__logo" nome={taaki.nome} logoUrl={taaki.logoUrl} />
        <p className="login__marca">{taaki.nome}</p>
        <h1 className="login__titulo">Retaguarda</h1>
        {erro && (
          <div className="alerta" role="alert">
            {erro}
          </div>
        )}
        <Campo rotulo="Email">
          {(id) => (
            <input
              id={id}
              className="entrada"
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Campo>
        <Campo rotulo="Senha">
          {(id) => (
            <input
              id={id}
              className="entrada"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          )}
        </Campo>
        <button type="submit" className="botao botao--primario" disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
