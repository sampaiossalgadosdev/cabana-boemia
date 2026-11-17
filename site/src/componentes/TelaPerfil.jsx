import { useCallback, useEffect, useState } from 'react';
import { formatarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../cliente/ClienteContext.jsx';
import { sessaoExpirou } from '../cliente/sessao.js';
import * as api from '../lib/api.js';
import { EntrarComGoogle } from './EntrarComGoogle.jsx';
import { PassoTelefone } from './Checkout.jsx';
import { FormEndereco, textoEndereco } from './FormEndereco.jsx';

const ERRO_GENERICO = 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';

function Endereco({ endereco, onEditar, onPrincipal, onRemover, ocupado }) {
  const [confirmando, setConfirmando] = useState(false);
  const { bairro } = endereco;
  return (
    <li className="perfil-endereco">
      <div>
        <strong>{textoEndereco(endereco)}</strong>
        {endereco.principal && <span className="perfil-endereco__selo">Principal</span>}
        <small>
          {bairro.nome}
          {endereco.referencia ? ` · ${endereco.referencia}` : ''}
          {!bairro.ativo && ' · não entregamos mais aqui'}
        </small>
      </div>
      {confirmando ? (
        <div className="perfil-endereco__acoes">
          <span>Remover este endereço?</span>
          <button type="button" className="botao botao--texto" onClick={() => setConfirmando(false)} disabled={ocupado}>
            Não
          </button>
          <button type="button" className="botao botao--texto botao--perigo" onClick={onRemover} disabled={ocupado}>
            Sim, remover
          </button>
        </div>
      ) : (
        <div className="perfil-endereco__acoes">
          <button type="button" className="botao botao--texto" onClick={onEditar} disabled={ocupado}>
            Editar
          </button>
          {!endereco.principal && bairro.ativo && (
            <button type="button" className="botao botao--texto" onClick={onPrincipal} disabled={ocupado}>
              Tornar principal
            </button>
          )}
          <button type="button" className="botao botao--texto" onClick={() => setConfirmando(true)} disabled={ocupado}>
            Remover
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Aba "Perfil": nome e e-mail do Google, telefone e endereços (editar,
 * principal, remover, novo) e "Sair". Sem login, pede o login com Google.
 */
export function TelaPerfil() {
  const { token, cliente, status, sair } = useCliente();
  const [enderecos, setEnderecos] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [editando, setEditando] = useState(null); // null | 'telefone' | 'novo' | endereço
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const tratarErro = useCallback(
    (err) => {
      if (sessaoExpirou(err)) sair();
      else setErro(err?.status ? err.message : ERRO_GENERICO);
    },
    [sair],
  );

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [{ enderecos: lista }, { bairros: b }] = await Promise.all([api.listarEnderecos(token), api.buscarBairros()]);
      setEnderecos(lista);
      setBairros(b);
    } catch (err) {
      tratarErro(err);
    }
  }, [token, tratarErro]);

  useEffect(() => {
    if (status === 'logado') carregar();
    else {
      setEnderecos(null);
      setEditando(null);
    }
  }, [status, carregar]);

  if (status === 'carregando') return <p className="nota">Carregando…</p>;
  if (status !== 'logado') {
    return (
      <div className="pagina-cliente">
        <h1 className="pagina-cliente__titulo">Perfil</h1>
        <EntrarComGoogle
          titulo="Entre na sua conta"
          texto="Com sua conta Google seus dados de entrega ficam salvos para os próximos pedidos."
        />
      </div>
    );
  }

  const acao = async (fn) => {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      await carregar();
    } catch (err) {
      tratarErro(err);
    } finally {
      setOcupado(false);
    }
  };

  if (editando === 'telefone' || !cliente.telefone) {
    return (
      <div className="pagina-cliente">
        <h1 className="pagina-cliente__titulo">Perfil</h1>
        <PassoTelefone
          titulo="Nome e telefone"
          texto="O telefone é por onde falamos com você sobre o pedido."
          rotuloBotao="Salvar"
          onSalvo={() => setEditando(null)}
          onCancelar={cliente.telefone ? () => setEditando(null) : null}
        />
      </div>
    );
  }

  if (editando) {
    const novo = editando === 'novo';
    return (
      <div className="pagina-cliente">
        <h1 className="pagina-cliente__titulo">Perfil</h1>
        <FormEndereco
          bairros={bairros}
          endereco={novo ? null : editando}
          titulo={novo ? 'Novo endereço' : 'Editar endereço'}
          onCancelar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null);
            await carregar();
          }}
        />
      </div>
    );
  }

  return (
    <div className="pagina-cliente">
      <h1 className="pagina-cliente__titulo">Perfil</h1>

      <section className="perfil-cartao" aria-labelledby="perfil-dados">
        <h2 id="perfil-dados" className="perfil-cartao__titulo">
          Seus dados
        </h2>
        <dl className="perfil-dados">
          <div>
            <dt>Nome</dt>
            <dd>{cliente.nome}</dd>
          </div>
          <div>
            <dt>E-mail (Google)</dt>
            <dd>{cliente.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Telefone</dt>
            <dd>{formatarTelefone(cliente.telefone)}</dd>
          </div>
        </dl>
        <button type="button" className="botao botao--texto" onClick={() => setEditando('telefone')}>
          Alterar nome ou telefone
        </button>
      </section>

      <section className="perfil-cartao" aria-labelledby="perfil-enderecos">
        <h2 id="perfil-enderecos" className="perfil-cartao__titulo">
          Endereços
        </h2>
        {enderecos === null ? (
          !erro && <p className="nota nota--esquerda">Carregando seus endereços…</p>
        ) : enderecos.length === 0 ? (
          <p className="nota nota--esquerda">Nenhum endereço salvo ainda.</p>
        ) : (
          <ul className="perfil-enderecos">
            {enderecos.map((e) => (
              <Endereco
                key={e.id}
                endereco={e}
                ocupado={ocupado}
                onEditar={() => setEditando(e)}
                onPrincipal={() =>
                  acao(() =>
                    api.atualizarEndereco(token, e.id, {
                      rua: e.rua,
                      numero: e.numero,
                      complemento: e.complemento,
                      referencia: e.referencia,
                      bairroId: e.bairro.id,
                      principal: true,
                    }),
                  )
                }
                onRemover={() => acao(() => api.removerEndereco(token, e.id))}
              />
            ))}
          </ul>
        )}
        {erro && (
          <p className="erro" role="alert">
            {erro}
          </p>
        )}
        {enderecos !== null && enderecos.length < 10 && (
          <button type="button" className="botao botao--texto" onClick={() => setEditando('novo')} disabled={ocupado}>
            + Novo endereço
          </button>
        )}
      </section>

      <button type="button" className="botao botao--secundario botao--bloco" onClick={sair}>
        Sair
      </button>
    </div>
  );
}
