import { useEffect, useRef, useState } from 'react';
import { useCliente } from '../cliente/ClienteContext.jsx';
import { obterConfig } from '../lib/config.js';
import { desenharBotaoGoogle } from '../lib/google.js';

const ERRO_GENERICO = 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';

/** Botão "Entrar com Google" com título e explicação (checkout, Pedidos e Perfil). */
export function EntrarComGoogle({ titulo, texto }) {
  const { entrar } = useCliente();
  const alvo = useRef(null);
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const aoReceber = async (credential) => {
      setErro('');
      setEntrando(true);
      try {
        await entrar(credential);
      } catch {
        if (vivo) setErro('Não conseguimos confirmar seu login. Tente de novo.');
      } finally {
        if (vivo) setEntrando(false);
      }
    };

    obterConfig()
      .then(({ googleClientId: clientId }) => {
        if (!vivo || !alvo.current) return;
        if (!clientId) {
          setErro('Login indisponível no momento. Peça pelo WhatsApp.');
          return;
        }
        return desenharBotaoGoogle(alvo.current, {
          clientId,
          onCredencial: aoReceber,
          largura: alvo.current.clientWidth,
        });
      })
      .catch(() => vivo && setErro(ERRO_GENERICO));

    return () => {
      vivo = false;
    };
  }, [entrar]);

  return (
    <section className="checkout-passo" aria-labelledby="titulo-login">
      <h3 id="titulo-login" className="checkout-passo__titulo">
        {titulo}
      </h3>
      <p className="checkout-passo__texto">{texto}</p>
      <div ref={alvo} className="botao-google" aria-busy={entrando} />
      {entrando && <p className="nota">Entrando…</p>}
      {erro && (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
