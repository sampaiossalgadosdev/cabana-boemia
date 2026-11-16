import { useState } from 'react';
import { api } from '../lib/api.js';
import { errosPorCampo } from '../lib/formatar.js';
import { Campo, Confirmar, Dialogo, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Equipe: criar atendente, desativar/reativar e trocar senha. Desativar e
 * trocar senha derrubam as sessões dessa pessoa (o PDV pede login de novo).
 */
export function TelaEquipe() {
  const carga = useCarregar(() => api.usuarios.listar());
  const [criando, setCriando] = useState(false);
  const [senhaDe, setSenhaDe] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const avisar = useAvisar();

  function pedirAlternar(u) {
    setConfirmar(
      u.ativo
        ? {
            titulo: `Desativar ${u.nome}`,
            texto: `${u.nome} sai do PDV na hora e não consegue mais entrar. Os pedidos lançados continuam no histórico.`,
            confirmar: 'Desativar',
            acao: async () => {
              await api.usuarios.desativar(u.id);
              avisar(`${u.nome} desativado.`);
              await carga.recarregar();
            },
          }
        : {
            titulo: `Reativar ${u.nome}`,
            texto: `${u.nome} volta a poder entrar no PDV com a senha atual.`,
            confirmar: 'Reativar',
            acao: async () => {
              await api.usuarios.reativar(u.id);
              avisar(`${u.nome} reativado.`);
              await carga.recarregar();
            },
          },
    );
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Equipe</h1>
          <p className="pagina__sub">Atendentes entram só no PDV. Ninguém é excluído: desative quem saiu.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setCriando(true)}>
          + Novo atendente
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {({ usuarios }) => (
          <section className="cartao tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Papel</th>
                  <th>Situação</th>
                  <th className="fim">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} className={u.ativo ? undefined : 'linha--inativa'}>
                    <td className="produto-nome">{u.nome}</td>
                    <td>{u.email}</td>
                    <td>{u.papel === 'DONO' ? <span className="etiqueta etiqueta--ouro">Dono</span> : 'Atendente'}</td>
                    <td>
                      {u.ativo ? <span className="etiqueta etiqueta--ok">Ativo</span> : <span className="etiqueta">Desativado</span>}
                    </td>
                    <td className="fim">
                      {u.papel === 'ATENDENTE' && (
                        <div className="acoes" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="botao botao--pequeno" onClick={() => setSenhaDe(u)}>
                            Trocar senha
                          </button>
                          <button
                            type="button"
                            className={`botao botao--pequeno${u.ativo ? ' botao--perigo' : ''}`}
                            onClick={() => pedirAlternar(u)}
                          >
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </EstadoCarga>

      <FormAtendente
        aberto={criando}
        aoFechar={() => setCriando(false)}
        aoSalvar={async (nome) => {
          setCriando(false);
          avisar(`${nome} criado. Já pode entrar no PDV.`);
          await carga.recarregar();
        }}
      />
      <FormSenha
        usuario={senhaDe}
        aoFechar={() => setSenhaDe(null)}
        aoSalvar={(nome) => {
          setSenhaDe(null);
          avisar(`Senha de ${nome} trocada. O PDV vai pedir login de novo.`);
        }}
      />
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}

const MIN_SENHA = 8;

function FormAtendente({ aberto, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ nome: '', email: '', senha: '' });
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [estava, setEstava] = useState(false);
  if (aberto !== estava) {
    setEstava(aberto);
    if (aberto) {
      setF({ nome: '', email: '', senha: '' });
      setErros({});
      setErroGeral('');
      setSalvando(false);
    }
  }

  async function salvar() {
    const e = {};
    if (!f.nome.trim()) e.nome = 'Informe o nome';
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Email inválido';
    if (f.senha.length < MIN_SENHA) e.senha = `Pelo menos ${MIN_SENHA} caracteres`;
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    setErroGeral('');
    try {
      await api.usuarios.criar({ nome: f.nome.trim(), email: f.email.trim(), senha: f.senha });
      await aoSalvar(f.nome.trim());
    } catch (err) {
      setErros(errosPorCampo(err));
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  const campo = (nome, rotulo, props = {}) => (
    <Campo rotulo={rotulo} erro={erros[nome]} ajuda={props.ajuda}>
      {(id, d) => (
        <input
          id={id}
          className="entrada"
          value={f[nome]}
          aria-invalid={Boolean(erros[nome]) || undefined}
          aria-describedby={d}
          onChange={(e) => {
            setF((x) => ({ ...x, [nome]: e.target.value }));
            setErros((x) => ({ ...x, [nome]: undefined }));
          }}
          {...props.input}
        />
      )}
    </Campo>
  );

  return (
    <Dialogo
      aberto={aberto}
      titulo="Novo atendente"
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Criando…' : 'Criar'}
          </button>
        </>
      }
    >
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      {campo('nome', 'Nome', { input: { maxLength: 100, autoFocus: true, autoComplete: 'off' } })}
      {campo('email', 'Email (login do PDV)', { input: { type: 'email', autoComplete: 'off' } })}
      {campo('senha', 'Senha inicial', {
        ajuda: `Pelo menos ${MIN_SENHA} caracteres. Entregue a senha pessoalmente.`,
        input: { type: 'password', autoComplete: 'new-password', maxLength: 72 },
      })}
    </Dialogo>
  );
}

function FormSenha({ usuario, aoFechar, aoSalvar }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [de, setDe] = useState(null);
  if (usuario !== de) {
    setDe(usuario);
    setSenha('');
    setErro('');
    setSalvando(false);
  }

  async function salvar() {
    if (senha.length < MIN_SENHA) {
      setErro(`Pelo menos ${MIN_SENHA} caracteres`);
      return;
    }
    setSalvando(true);
    try {
      await api.usuarios.trocarSenha(usuario.id, senha);
      aoSalvar(usuario.nome);
    } catch (err) {
      setErro(errosPorCampo(err).senha ?? err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(usuario)}
      titulo={`Trocar senha de ${usuario?.nome ?? ''}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Trocar senha'}
          </button>
        </>
      }
    >
      <Campo rotulo="Nova senha" erro={erro} ajuda="O PDV vai pedir login de novo.">
        {(id, d) => (
          <input
            id={id}
            className="entrada"
            type="password"
            autoComplete="new-password"
            maxLength={72}
            autoFocus
            value={senha}
            aria-describedby={d}
            onChange={(e) => setSenha(e.target.value)}
          />
        )}
      </Campo>
    </Dialogo>
  );
}
