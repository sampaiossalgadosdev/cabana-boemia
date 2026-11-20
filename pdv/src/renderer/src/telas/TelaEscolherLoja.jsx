import { useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { Logo } from '../componentes/Logo.jsx';

/**
 * Só o ADMIN (plataforma) chega aqui: ele não tem loja, então escolhe em qual
 * o PDV vai trabalhar (pedidos, caixa, cupons e tempo real daquela loja).
 * A escolha fica guardada neste computador.
 */
export function TelaEscolherLoja({ usuario, aoEscolher, aoSair }) {
  const [lojas, setLojas] = useState(null);
  const [erro, setErro] = useState('');
  const [escolhendo, setEscolhendo] = useState(null);

  async function carregar() {
    setErro('');
    try {
      setLojas(await chamar(pdv.loja.listar()));
    } catch (err) {
      setErro(err.message);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function escolher(slug) {
    setEscolhendo(slug);
    setErro('');
    try {
      aoEscolher(await chamar(pdv.loja.escolher(slug)));
    } catch (err) {
      setErro(err.message);
      setEscolhendo(null);
    }
  }

  return (
    <div className="tela-centro">
      <div className="cartao-login">
        <Logo className="cartao-login__logo" />
        <h1 className="cartao-login__titulo">Em qual loja?</h1>
        <p className="cartao-login__texto">
          {usuario.nome}, você é administrador da plataforma. Escolha a loja em que este PDV vai trabalhar.
        </p>
        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}
        {!lojas && !erro && <p className="cartao-login__texto">Carregando lojas…</p>}
        {lojas && (
          <div className="lista-lojas">
            {lojas.map((l) => (
              <button
                key={l.slug}
                type="button"
                className="lista-lojas__item"
                disabled={escolhendo !== null}
                onClick={() => escolher(l.slug)}
              >
                <span className="lista-lojas__cor" style={{ background: l.corPrimaria ?? 'var(--cor-primaria)' }} aria-hidden="true" />
                {escolhendo === l.slug ? 'Abrindo…' : l.nome}
                {!l.ativa && <span className="lista-lojas__inativa">inativa</span>}
              </button>
            ))}
          </div>
        )}
        {erro && !lojas && (
          <button type="button" className="botao botao--largo" onClick={carregar}>
            Tentar de novo
          </button>
        )}
        <button type="button" className="botao botao--contorno botao--largo" onClick={aoSair}>
          Sair
        </button>
      </div>
    </div>
  );
}
