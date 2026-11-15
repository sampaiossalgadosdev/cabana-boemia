import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { formatarPreco, formatarTelefone } from '../../lib/formatar.js';
import { pareceTelefone, textoEndereco } from '../../lib/lancamento.js';
import { CamposEndereco, ENDERECO_VAZIO, enderecoParaEnvio } from './FormEndereco.jsx';

const ESPERA_BUSCA_MS = 250;

/**
 * Passo 1: busca com autocomplete (↑ ↓ Enter) ou cadastro rápido; com o
 * cliente escolhido, telefone e endereços aparecem para confirmar.
 * `modo` é controlado pelo pai (o Esc fecha o cadastro antes de sair).
 */
export function PassoCliente({
  cliente,
  enderecoId,
  bairros,
  modo,
  buscaInicial,
  aoMudarModo,
  aoEscolher,
  aoEscolherEndereco,
  aoContinuar,
}) {
  if (modo === 'cadastro') {
    return (
      <CadastroRapido
        buscaInicial={buscaInicial}
        bairros={bairros}
        aoCriado={(c) => {
          aoEscolher(c);
          aoMudarModo('busca');
        }}
        aoCancelar={() => aoMudarModo('busca')}
      />
    );
  }
  if (modo === 'endereco' && cliente) {
    return (
      <NovoEndereco
        cliente={cliente}
        bairros={bairros}
        aoSalvo={(c) => {
          aoEscolher(c);
          aoMudarModo('busca');
        }}
        aoCancelar={() => aoMudarModo('busca')}
      />
    );
  }
  if (cliente) {
    return (
      <ConfirmarCliente
        cliente={cliente}
        enderecoId={enderecoId}
        aoEscolherEndereco={aoEscolherEndereco}
        aoTrocar={() => aoEscolher(null)}
        aoNovoEndereco={() => aoMudarModo('endereco')}
        aoContinuar={aoContinuar}
      />
    );
  }
  return <BuscaCliente aoEscolher={aoEscolher} aoCadastrar={(busca) => aoMudarModo('cadastro', busca)} />;
}

function BuscaCliente({ aoEscolher, aoCadastrar }) {
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState({ clientes: [], buscou: '' });
  const [destaque, setDestaque] = useState(0);
  const [erro, setErro] = useState('');
  const [buscando, setBuscando] = useState(false);
  const ultima = useRef(0);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setResultado({ clientes: [], buscou: '' });
      return undefined;
    }
    const id = setTimeout(async () => {
      const minha = (ultima.current += 1);
      setBuscando(true);
      try {
        const { clientes } = await chamar(pdv.clientes.buscar(termo));
        if (minha !== ultima.current) return; // resposta atrasada de uma busca antiga
        setResultado({ clientes, buscou: termo });
        setDestaque(0);
        setErro('');
      } catch (err) {
        if (minha === ultima.current) setErro(err.message);
      } finally {
        if (minha === ultima.current) setBuscando(false);
      }
    }, ESPERA_BUSCA_MS);
    return () => clearTimeout(id);
  }, [busca]);

  function aoTeclar(e) {
    const n = resultado.clientes.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setDestaque((d) => (d + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      setDestaque((d) => (d - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (n) aoEscolher(resultado.clientes[destaque]);
    }
  }

  const termo = busca.trim();
  const semResultado = resultado.buscou === termo && termo.length >= 2 && !resultado.clientes.length && !buscando;

  return (
    <div className="passo">
      <label className="campo">
        <span>Buscar cliente (nome ou telefone)</span>
        <input
          className="campo__grande"
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={aoTeclar}
          placeholder="Ex.: Maria ou 99999"
          role="combobox"
          aria-expanded={resultado.clientes.length > 0}
          aria-controls="lista-clientes"
          aria-activedescendant={resultado.clientes.length ? `cliente-${resultado.clientes[destaque]?.id}` : undefined}
        />
      </label>
      {erro && <p className="erro" role="alert">{erro}</p>}

      <ul className="lista-clientes" id="lista-clientes" role="listbox">
        {resultado.clientes.map((c, i) => {
          const principal = c.enderecos[0];
          return (
            <li key={c.id} id={`cliente-${c.id}`} role="option" aria-selected={i === destaque}>
              <button
                type="button"
                className={`cliente-item ${i === destaque ? 'cliente-item--destaque' : ''}`}
                onMouseEnter={() => setDestaque(i)}
                onClick={() => aoEscolher(c)}
              >
                <strong>{c.nome}</strong>
                <span>{c.telefone ? formatarTelefone(c.telefone) : 'sem telefone'}</span>
                <span className="cliente-item__endereco">
                  {principal ? `${textoEndereco(principal)} · ${principal.bairro.nome}` : 'sem endereço'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {semResultado && <p className="texto-suave">Nenhum cliente encontrado para “{termo}”.</p>}

      <button type="button" className="botao botao--contorno" onClick={() => aoCadastrar(termo)}>
        + Cadastrar cliente novo
      </button>
    </div>
  );
}

function ConfirmarCliente({ cliente, enderecoId, aoEscolherEndereco, aoTrocar, aoNovoEndereco, aoContinuar }) {
  const escolhido = cliente.enderecos.find((e) => e.id === enderecoId);
  const podeContinuar = Boolean(escolhido?.bairro.ativo && cliente.telefone);
  return (
    <form
      className="passo"
      onSubmit={(e) => {
        e.preventDefault();
        if (podeContinuar) aoContinuar();
      }}
    >
      <div className="confirmar-cliente">
        <div>
          <p className="confirmar-cliente__nome">{cliente.nome}</p>
          <p className="confirmar-cliente__telefone">
            {cliente.telefone ? formatarTelefone(cliente.telefone) : <span className="erro">Sem telefone</span>}
          </p>
        </div>
        <button type="button" className="botao botao--contorno botao--pequeno" onClick={aoTrocar}>
          Trocar cliente
        </button>
      </div>

      <fieldset className="enderecos">
        <legend>Confirme o endereço de entrega</legend>
        {cliente.enderecos.length === 0 && <p className="texto-suave">Cliente sem endereço. Cadastre um.</p>}
        {cliente.enderecos.map((e) => (
          <label key={e.id} className={`endereco-opcao ${e.id === enderecoId ? 'endereco-opcao--marcada' : ''}`}>
            <input
              type="radio"
              name="endereco"
              checked={e.id === enderecoId}
              disabled={!e.bairro.ativo}
              onChange={() => aoEscolherEndereco(e.id)}
            />
            <span>
              <strong>{textoEndereco(e)}</strong>
              <span className="endereco-opcao__bairro">
                {e.bairro.nome} ·{' '}
                {e.bairro.ativo ? `entrega ${formatarPreco(e.bairro.taxaCentavos)}` : 'não entregamos mais neste bairro'}
              </span>
            </span>
          </label>
        ))}
        <button type="button" className="link" onClick={aoNovoEndereco}>
          + Outro endereço
        </button>
      </fieldset>

      <div className="passo__acoes">
        <button type="submit" className="botao" disabled={!podeContinuar} autoFocus>
          Continuar → Itens
        </button>
      </div>
    </form>
  );
}

function CadastroRapido({ buscaInicial = '', bairros, aoCriado, aoCancelar }) {
  // Pré-preenche com o que foi digitado na busca (telefone ou nome).
  const [form, setForm] = useState(() => ({
    nome: pareceTelefone(buscaInicial) ? '' : buscaInicial,
    telefone: pareceTelefone(buscaInicial) ? buscaInicial : '',
    endereco: ENDERECO_VAZIO,
  }));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null); // { mensagem, existente? }

  async function salvar(e) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const { cliente } = await chamar(
        pdv.clientes.criar({ ...form, endereco: enderecoParaEnvio(form.endereco) }),
      );
      aoCriado(cliente);
    } catch (err) {
      setErro({ mensagem: err.message, existente: err.detalhes?.cliente ?? null });
      setEnviando(false);
    }
  }

  return (
    <form className="passo" onSubmit={salvar}>
      <h3 className="passo__titulo">Cadastro rápido</h3>
      <div className="form-grade">
        <label className="campo campo--largo">
          <span>Nome</span>
          <input required maxLength={100} autoFocus value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </label>
        <label className="campo">
          <span>Telefone (WhatsApp)</span>
          <input required inputMode="tel" placeholder="(43) 99999-0000" value={form.telefone}
            onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
        </label>
      </div>
      <CamposEndereco valor={form.endereco} bairros={bairros} aoMudar={(endereco) => setForm({ ...form, endereco })} />
      {erro && (
        <div className="aviso" role="alert">
          {erro.mensagem}
          {erro.existente && (
            <button type="button" className="botao botao--pequeno" onClick={() => aoCriado(erro.existente)}>
              Usar {erro.existente.nome}
            </button>
          )}
        </div>
      )}
      <div className="passo__acoes">
        <button type="button" className="botao botao--contorno" onClick={aoCancelar} disabled={enviando}>
          Voltar à busca
        </button>
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Cadastrar e usar'}
        </button>
      </div>
    </form>
  );
}

function NovoEndereco({ cliente, bairros, aoSalvo, aoCancelar }) {
  const [endereco, setEndereco] = useState(ENDERECO_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(e) {
    e.preventDefault();
    setEnviando(true);
    setErro('');
    try {
      const r = await chamar(pdv.clientes.adicionarEndereco(cliente.id, enderecoParaEnvio(endereco)));
      aoSalvo(r.cliente);
    } catch (err) {
      setErro(err.message);
      setEnviando(false);
    }
  }

  return (
    <form className="passo" onSubmit={salvar}>
      <h3 className="passo__titulo">Novo endereço de {cliente.nome}</h3>
      <CamposEndereco valor={endereco} bairros={bairros} aoMudar={setEndereco} autoFocus />
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className="passo__acoes">
        <button type="button" className="botao botao--contorno" onClick={aoCancelar} disabled={enviando}>
          Voltar
        </button>
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar endereço'}
        </button>
      </div>
    </form>
  );
}
