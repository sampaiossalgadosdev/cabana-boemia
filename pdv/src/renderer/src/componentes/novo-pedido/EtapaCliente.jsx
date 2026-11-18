import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { formatarPreco, formatarTelefone } from '../../lib/formatar.js';
import { textoEndereco } from '../../lib/lancamento.js';
import { paraBusca } from '../../lib/painel.js';
import { formatarCep } from '../../lib/novoPedido.js';
import { Destaque } from '../Destaque.jsx';
import { IconeLupa } from '../Icones.jsx';

const ESPERA_BUSCA_MS = 250;

/**
 * Etapa 2: busca do cliente (autocomplete ↑ ↓ Enter) e o cadastro, sempre
 * editável. Sem cliente escolhido, preencher e avançar CRIA o cliente;
 * escolhido, o que mudar (nome, telefone, endereço) atualiza o MESMO cliente
 * (mesmo ID). A gravação acontece ao avançar (NovoPedido). Layout em linhas
 * com campos sublinhados, sem rolagem em 1366×768.
 */
export function EtapaCliente({
  tipo,
  cliente,
  form,
  endereco,
  enderecoId,
  retirarNoBalcao,
  bairros,
  erros,
  aoEscolherCliente,
  aoDesvincular,
  aoMudarForm,
  aoMudarEndereco,
  aoEscolherEndereco,
  aoMudarRetirar,
  agendamento,
  aoMudarAgendamento,
  erroAgendamento,
  horaVirada,
}) {
  const doSite = Boolean(cliente?.doSite);
  const comEntrega = !(tipo === 'encomenda' && retirarNoBalcao);
  const mudar = (campo) => (e) => aoMudarForm({ ...form, [campo]: e.target.value });
  const mudarEnd = (campo) => (e) => aoMudarEndereco({ ...endereco, [campo]: e.target.value });

  return (
    <div className="etapa-cliente">
      <div className="etapa-cliente__busca">
        <BuscaCliente aoEscolher={aoEscolherCliente} autoFocus={!cliente} />
        {cliente ? (
          <span className="cliente-vinculado" title={doSite ? 'Nome e e-mail vêm do login do cliente no site' : undefined}>
            Cliente {cliente.id}
            {doSite && <span className="selo selo--site">Site</span>}
            <button type="button" className="cliente-vinculado__x" onClick={aoDesvincular}
              aria-label="Desvincular cliente (os campos ficam vazios para um cliente novo)" title="Limpar e cadastrar outro">×</button>
          </span>
        ) : (
          <span className="cliente-vinculado cliente-vinculado--novo">Cliente novo</span>
        )}
      </div>

      <div className="linha-form">
        <Campo rotulo="Nome do cliente" erro={erros.nome} classe="c-5">
          <input maxLength={100} value={form.nome} onChange={mudar('nome')} readOnly={doSite} />
        </Campo>
        <Campo rotulo="Telefone" erro={erros.telefone} classe="c-3">
          <input inputMode="tel" placeholder="(43) 99999-0000" value={form.telefone} onChange={mudar('telefone')}
            readOnly={doSite && Boolean(cliente?.telefone)} />
        </Campo>
        <Campo rotulo="E-mail (opcional)" erro={erros.email} classe="c-4">
          <input type="email" maxLength={120} value={form.email} onChange={mudar('email')} readOnly={doSite} />
        </Campo>
        <Campo rotulo="Observação do cliente" classe="c-12">
          <input maxLength={300} value={form.observacao} onChange={mudar('observacao')} placeholder="Ex.: portão azul, cliente antigo" />
        </Campo>
      </div>

      <div className="etapa-cliente__secao">
        <span className="etapa-cliente__titulo">Dados do endereço</span>
        {!comEntrega && <span className="texto-suave">Retirada no balcão: sem endereço e sem taxa.</span>}
        {comEntrega && cliente?.enderecos?.length > 0 && (
          <select className="etapa-cliente__enderecos" aria-label="Endereço salvo" value={enderecoId ?? ''}
            onChange={(e) => aoEscolherEndereco(e.target.value ? Number(e.target.value) : null)}>
            {cliente.enderecos.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.bairro.ativo}>
                {textoEndereco(e)} · {e.bairro.nome}
                {e.bairro.ativo ? '' : ' (não entregamos mais)'}
              </option>
            ))}
            <option value="">+ Novo endereço</option>
          </select>
        )}
      </div>

      {comEntrega && (
        <div className="linha-form">
          <CampoCep endereco={endereco} bairros={bairros} erro={erros.cep} aoMudar={aoMudarEndereco} />
          <Campo rotulo="Endereço" erro={erros.rua} classe="c-5">
            <input maxLength={120} value={endereco.rua} onChange={mudarEnd('rua')} placeholder="Rua, avenida…" />
          </Campo>
          <Campo rotulo="Número" erro={erros.numero} classe="c-2">
            <input maxLength={20} value={endereco.numero} onChange={mudarEnd('numero')} />
          </Campo>
          <Campo rotulo="Complemento" classe="c-3">
            <input maxLength={120} value={endereco.complemento} onChange={mudarEnd('complemento')} placeholder="Casa, apto…" />
          </Campo>
          <Campo rotulo="Bairro" erro={erros.bairroId} classe="c-3">
            <select value={endereco.bairroId} onChange={mudarEnd('bairroId')}>
              <option value="">Escolha…</option>
              {bairros.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome} · {formatarPreco(b.taxaCentavos)}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Referência" classe="c-4">
            <input maxLength={200} value={endereco.referencia} onChange={mudarEnd('referencia')} placeholder="Perto de…" />
          </Campo>
          <Campo rotulo="Cidade" classe="c-3">
            <input maxLength={60} value={endereco.cidade} onChange={mudarEnd('cidade')} />
          </Campo>
          <Campo rotulo="Estado" classe="c-2">
            <input maxLength={30} value={endereco.estado} onChange={mudarEnd('estado')} />
          </Campo>
        </div>
      )}

      {tipo === 'encomenda' && (
        <div className="linha-form linha-form--encomenda">
          <div className="c-3 etapa-cliente__rotulo-encomenda">
            <span className="etapa-cliente__titulo">Data da encomenda</span>
            <span className="texto-suave">
              Só o expediente de hoje (até {String(horaVirada).padStart(2, '0')}:00 de amanhã)
            </span>
          </div>
          <Campo rotulo="Data" erro={erroAgendamento} classe="c-3">
            <input type="date" value={agendamento.data} onChange={(e) => aoMudarAgendamento({ ...agendamento, data: e.target.value })} />
          </Campo>
          <Campo rotulo="Horário" classe="c-2">
            <input type="time" value={agendamento.hora} onChange={(e) => aoMudarAgendamento({ ...agendamento, hora: e.target.value })} />
          </Campo>
          <label className="interruptor c-4">
            <input type="checkbox" checked={retirarNoBalcao} onChange={(e) => aoMudarRetirar(e.target.checked)} />
            <span>Retirar no balcão (sem endereço e sem taxa)</span>
          </label>
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, erro, largo = false, classe = '', children }) {
  return (
    <label className={`campo ${largo ? 'campo--largo' : ''} ${erro ? 'campo--erro' : ''} ${classe}`}>
      <span>{rotulo}</span>
      {children}
      {erro && <span className="erro campo__erro">{erro}</span>}
    </label>
  );
}

/** CEP: com 8 números, consulta o ViaCEP (pelo main) e preenche rua, cidade, estado e o bairro, se existir na lista. */
function CampoCep({ endereco, bairros, erro, aoMudar }) {
  const [estado, setEstado] = useState(''); // '' | 'buscando' | mensagem de erro
  const ultimo = useRef('');

  async function consultar(valor) {
    const digitos = valor.replace(/\D/g, '');
    if (digitos.length !== 8 || digitos === ultimo.current) return;
    ultimo.current = digitos;
    setEstado('buscando');
    try {
      const r = await chamar(pdv.cep.consultar(digitos));
      const bairro = bairros.find((b) => paraBusca(b.nome) === paraBusca(r.bairro));
      aoMudar({
        ...endereco,
        cep: formatarCep(digitos),
        rua: r.rua || endereco.rua,
        cidade: r.cidade || endereco.cidade,
        estado: r.estado || endereco.estado,
        bairroId: bairro ? String(bairro.id) : endereco.bairroId,
      });
      setEstado(r.rua ? '' : 'CEP geral da cidade: preencha a rua.');
    } catch (err) {
      setEstado(err.message);
    }
  }

  return (
    <Campo rotulo="CEP" erro={erro} classe="c-2">
      <input inputMode="numeric" placeholder="00000-000" maxLength={9} value={endereco.cep}
        onChange={(e) => {
          const cep = formatarCep(e.target.value);
          aoMudar({ ...endereco, cep });
          if (cep.replace(/\D/g, '').length === 8) consultar(cep);
        }} />
      {estado && <span className="texto-suave campo__dica">{estado === 'buscando' ? 'Buscando CEP…' : estado}</span>}
    </Campo>
  );
}

/** Autocomplete: "CÓDIGO - NOME - (TELEFONE) - ENDEREÇO/REFERÊNCIA", com o trecho buscado em negrito. */
function BuscaCliente({ aoEscolher, autoFocus }) {
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState({ clientes: [], buscou: '' });
  const [destaque, setDestaque] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState('');
  const ultima = useRef(0);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setResultado({ clientes: [], buscou: '' });
      return undefined;
    }
    const id = setTimeout(async () => {
      const minha = (ultima.current += 1);
      try {
        const { clientes } = await chamar(pdv.clientes.buscar(termo));
        if (minha !== ultima.current) return; // resposta atrasada de uma busca antiga
        setResultado({ clientes, buscou: termo });
        setDestaque(0);
        setAberto(true);
        setErro('');
      } catch (err) {
        if (minha === ultima.current) setErro(err.message);
      }
    }, ESPERA_BUSCA_MS);
    return () => clearTimeout(id);
  }, [busca]);

  function escolher(c) {
    aoEscolher(c);
    setBusca('');
    setAberto(false);
  }

  function aoTeclar(e) {
    const n = aberto ? resultado.clientes.length : 0;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setDestaque((d) => (d + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      setDestaque((d) => (d - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (n) escolher(resultado.clientes[destaque]);
    } else if (e.key === 'Escape' && (aberto || busca)) {
      // Esc fecha a lista (e limpa a busca) antes de voltar a etapa.
      e.preventDefault();
      setAberto(false);
      setBusca('');
    }
  }

  const termo = busca.trim();
  const mostrar = aberto && resultado.buscou === termo && termo.length >= 2;

  return (
    <div className="autocomplete">
      <div className="autocomplete__campo">
        <IconeLupa className="campo__icone" />
        <input className="campo__grande" autoFocus={autoFocus} value={busca} placeholder="Cliente (telefone ou nome)"
          onChange={(e) => setBusca(e.target.value)} onKeyDown={aoTeclar} onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 150)}
          role="combobox" aria-expanded={mostrar} aria-controls="lista-busca-cliente" aria-label="Pesquisar cliente"
          aria-activedescendant={mostrar && resultado.clientes.length ? `busca-cliente-${resultado.clientes[destaque]?.id}` : undefined} />
      </div>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {mostrar && (
        <ul className="autocomplete__lista" id="lista-busca-cliente" role="listbox">
          {resultado.clientes.length === 0 && <li className="autocomplete__vazio">Nenhum cliente encontrado para “{termo}”. Preencha os campos abaixo para cadastrar.</li>}
          {resultado.clientes.map((c, i) => {
            const e = c.enderecos[0];
            return (
              <li key={c.id} id={`busca-cliente-${c.id}`} role="option" aria-selected={i === destaque}
                className={`autocomplete__item ${i === destaque ? 'autocomplete__item--destaque' : ''}`}
                onMouseEnter={() => setDestaque(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => escolher(c)}>
                {`${c.id} - `}
                <Destaque texto={c.nome} busca={termo} />
                {' - '}
                <Destaque texto={c.telefone ? formatarTelefone(c.telefone) : 'sem telefone'} busca={termo} />
                {e ? ` - ${textoEndereco(e)} · ${e.bairro.nome}` : ' - sem endereço'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
