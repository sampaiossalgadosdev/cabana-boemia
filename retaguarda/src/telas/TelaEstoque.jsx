import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { NOMES_MOVIMENTACAO, comSinal, errosPorCampo, formatarDataHora } from '../lib/formatar.js';
import { Campo, Dialogo, EstadoCarga, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Estoque: bebidas (estoque próprio) e insumos. Entrada soma; Ajuste grava o
 * saldo contado. Ambos ficam no histórico com quem fez e o motivo.
 */
export function TelaEstoque() {
  const [aba, setAba] = useState('saldos');
  const [filtroHistorico, setFiltroHistorico] = useState('');
  const carga = useCarregar(() => api.estoque.obter());

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Estoque</h1>
          <p className="pagina__sub">As vendas baixam na hora do lançamento; cancelamentos devolvem.</p>
        </div>
      </div>
      <div className="abas" role="tablist" aria-label="Estoque">
        {[
          ['saldos', 'Saldos'],
          ['historico', 'Histórico'],
        ].map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            className="aba"
            aria-selected={aba === valor}
            onClick={() => {
              setAba(valor);
              if (valor === 'saldos') carga.recarregar();
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <EstadoCarga carga={carga}>
        {(dados) =>
          aba === 'saldos' ? (
            <Saldos
              dados={dados}
              recarregar={carga.recarregar}
              verHistorico={(filtro) => {
                setFiltroHistorico(filtro);
                setAba('historico');
              }}
            />
          ) : (
            <Historico dados={dados} filtroInicial={filtroHistorico} />
          )
        }
      </EstadoCarga>
    </>
  );
}

// ───────── Saldos ─────────

function Saldos({ dados, recarregar, verHistorico }) {
  const [movimento, setMovimento] = useState(null); // { tipo, item, alvo }
  const [insumo, setInsumo] = useState(null); // insumo | 'novo'
  const avisar = useAvisar();
  const abaixo = [...dados.produtos, ...dados.insumos].filter((x) => x.abaixoDoMinimo).length;

  const acoes = (item, alvo, chave) => (
    <div className="acoes" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="botao botao--pequeno" onClick={() => setMovimento({ tipo: 'ENTRADA', item, alvo })}>
        Entrada
      </button>
      <button type="button" className="botao botao--pequeno" onClick={() => setMovimento({ tipo: 'AJUSTE', item, alvo })}>
        Ajuste
      </button>
      <button type="button" className="botao botao--pequeno botao--texto" onClick={() => verHistorico(chave)}>
        Histórico
      </button>
    </div>
  );

  const saldo = (item) => (
    <td className="num">
      <strong>{item.estoque}</strong>
      {item.abaixoDoMinimo && (
        <>
          {' '}
          <span className="etiqueta etiqueta--alerta">abaixo do mínimo</span>
        </>
      )}
    </td>
  );

  return (
    <>
      {abaixo > 0 && (
        <div className="alerta" role="status">
          {abaixo === 1 ? '1 item abaixo do mínimo.' : `${abaixo} itens abaixo do mínimo.`}
        </div>
      )}

      <section className="cartao tabela-rolagem">
        <div className="cartao__topo">
          <h2 className="cartao__titulo">Bebidas e produtos com estoque</h2>
          <span className="suave">O mínimo é definido no cadastro do produto.</span>
        </div>
        <table className="tabela">
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Saldo</th>
              <th className="num">Mínimo</th>
              <th className="fim">
                <span className="visualmente-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.produtos.map((p) => (
              <tr key={p.id} className={p.abaixoDoMinimo ? 'linha--alerta' : p.ativo ? undefined : 'linha--inativa'}>
                <td className="produto-nome">
                  {p.nome}
                  <small>
                    {p.categoria.nome}
                    {p.ativo ? '' : ' · inativo'}
                  </small>
                </td>
                {saldo(p)}
                <td className="num">{p.estoqueMinimo ?? '—'}</td>
                <td className="fim">{acoes(p, { produtoId: p.id }, `p:${p.id}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dados.produtos.length && <div className="tabela-vazia">Nenhum produto controla estoque.</div>}
      </section>

      <section className="cartao tabela-rolagem">
        <div className="cartao__topo">
          <h2 className="cartao__titulo">Insumos</h2>
          <button type="button" className="botao botao--pequeno" onClick={() => setInsumo('novo')}>
            + Novo insumo
          </button>
        </div>
        <table className="tabela">
          <thead>
            <tr>
              <th>Insumo</th>
              <th className="num">Saldo</th>
              <th className="num">Mínimo</th>
              <th className="fim">
                <span className="visualmente-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.insumos.map((i) => (
              <tr key={i.id} className={i.abaixoDoMinimo ? 'linha--alerta' : undefined}>
                <td className="produto-nome">
                  {i.nome}
                  <small>{i.produtos.length ? `Usado em: ${i.produtos.map((p) => p.nome).join(', ')}` : 'Nenhum produto usa'}</small>
                </td>
                {saldo(i)}
                <td className="num">
                  {i.estoqueMinimo}{' '}
                  <button type="button" className="botao botao--texto botao--pequeno" onClick={() => setInsumo(i)}>
                    editar
                  </button>
                </td>
                <td className="fim">{acoes(i, { insumoId: i.id }, `i:${i.id}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dados.insumos.length && <div className="tabela-vazia">Nenhum insumo.</div>}
      </section>

      <FormMovimento
        movimento={movimento}
        aoFechar={() => setMovimento(null)}
        aoSalvar={async (mensagem) => {
          setMovimento(null);
          avisar(mensagem);
          await recarregar();
        }}
      />
      <FormInsumo
        insumo={insumo}
        aoFechar={() => setInsumo(null)}
        aoSalvar={async (mensagem) => {
          setInsumo(null);
          avisar(mensagem);
          await recarregar();
        }}
      />
    </>
  );
}

function FormMovimento({ movimento, aoFechar, aoSalvar }) {
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [de, setDe] = useState(null);
  if (movimento !== de) {
    setDe(movimento);
    setQuantidade(movimento?.tipo === 'AJUSTE' ? String(movimento.item.estoque) : '');
    setMotivo('');
    setErros({});
    setErroGeral('');
    setSalvando(false);
  }
  if (!movimento) return <Dialogo aberto={false} titulo="" aoFechar={aoFechar} />;

  const { tipo, item, alvo } = movimento;
  const ajuste = tipo === 'AJUSTE';
  const numero = quantidade === '' ? null : Number(quantidade);
  const delta = ajuste && numero != null ? numero - item.estoque : null;

  async function salvar() {
    const e = {};
    if (numero == null || !Number.isInteger(numero) || (!ajuste && numero < 1)) {
      e.quantidade = ajuste ? 'Informe o saldo contado' : 'Informe a quantidade (1 ou mais)';
    }
    if (ajuste && !motivo.trim()) e.motivo = 'Informe o motivo do ajuste';
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    setErroGeral('');
    try {
      if (ajuste) {
        const r = await api.estoque.ajuste({ ...alvo, saldoContado: numero, motivo: motivo.trim() });
        await aoSalvar(
          r.movimentacao ? `${item.nome}: saldo ajustado para ${numero} (${comSinal(r.movimentacao.quantidade)}).` : `${item.nome}: saldo confere, nada mudou.`,
        );
      } else {
        const r = await api.estoque.entrada({ ...alvo, quantidade: numero, motivo: motivo.trim() || null });
        await aoSalvar(`${item.nome}: +${numero}, saldo ${r.item.estoque}.`);
      }
    } catch (err) {
      const porCampo = errosPorCampo(err);
      setErros({ quantidade: porCampo.saldoContado ?? porCampo.quantidade, motivo: porCampo.motivo });
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`${ajuste ? 'Ajuste' : 'Entrada'}: ${item.nome}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Salvando…' : ajuste ? 'Ajustar saldo' : 'Registrar entrada'}
          </button>
        </>
      }
    >
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      <p style={{ marginTop: 0 }}>
        Saldo atual: <strong>{item.estoque}</strong>
      </p>
      <Campo
        rotulo={ajuste ? 'Saldo contado' : 'Quantidade que entrou'}
        erro={erros.quantidade}
        ajuda={
          ajuste
            ? delta == null || Number.isNaN(delta)
              ? 'Quanto tem de verdade agora.'
              : delta === 0
                ? 'Igual ao saldo: nada muda.'
                : `Diferença: ${comSinal(delta)}`
            : numero
              ? `Saldo vai para ${item.estoque + numero}.`
              : 'Ex.: 12 (um fardo).'
        }
      >
        {(id, d) => (
          <input
            id={id}
            className="entrada entrada--curta"
            inputMode="numeric"
            autoFocus
            value={quantidade}
            aria-invalid={Boolean(erros.quantidade) || undefined}
            aria-describedby={d}
            onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
      </Campo>
      <Campo rotulo={ajuste ? 'Motivo' : 'Motivo (opcional)'} erro={erros.motivo}>
        {(id, d) => (
          <input
            id={id}
            className="entrada"
            maxLength={200}
            placeholder={ajuste ? 'Ex.: contagem do fim de semana, latas amassadas' : 'Ex.: compra no atacado'}
            value={motivo}
            aria-describedby={d}
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}
      </Campo>
    </Dialogo>
  );
}

function FormInsumo({ insumo, aoFechar, aoSalvar }) {
  const novo = insumo === 'novo';
  const [nome, setNome] = useState('');
  const [minimo, setMinimo] = useState('0');
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [de, setDe] = useState(null);
  if (insumo !== de) {
    setDe(insumo);
    setNome(insumo && !novo ? insumo.nome : '');
    setMinimo(insumo && !novo ? String(insumo.estoqueMinimo) : '0');
    setErros({});
    setSalvando(false);
  }

  async function salvar() {
    const e = {};
    if (!nome.trim()) e.nome = 'Informe o nome';
    if (minimo === '') e.estoqueMinimo = 'Informe o mínimo (0 = sem aviso)';
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    try {
      const dados = { nome: nome.trim(), estoqueMinimo: Number(minimo) };
      if (novo) await api.estoque.criarInsumo(dados);
      else await api.estoque.alterarInsumo(insumo.id, dados);
      await aoSalvar(novo ? `${dados.nome} criado com saldo 0.` : `${dados.nome} salvo.`);
    } catch (err) {
      const porCampo = errosPorCampo(err);
      setErros(Object.keys(porCampo).length ? porCampo : { nome: err.message });
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={Boolean(insumo)}
      titulo={novo ? 'Novo insumo' : 'Editar insumo'}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <Campo rotulo="Nome" erro={erros.nome}>
        {(id, d) => (
          <input id={id} className="entrada" maxLength={60} autoFocus value={nome} aria-describedby={d} onChange={(e) => setNome(e.target.value)} />
        )}
      </Campo>
      <Campo rotulo="Estoque mínimo" erro={erros.estoqueMinimo} ajuda="Abaixo disso a linha fica vermelha.">
        {(id, d) => (
          <input
            id={id}
            className="entrada entrada--curta"
            inputMode="numeric"
            value={minimo}
            aria-describedby={d}
            onChange={(e) => setMinimo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
      </Campo>
      {novo && <p className="suave">O saldo começa em 0; registre a primeira Entrada depois.</p>}
    </Dialogo>
  );
}

// ───────── Histórico ─────────

function Historico({ dados, filtroInicial }) {
  const [item, setItem] = useState(filtroInicial);
  const [tipo, setTipo] = useState('');
  const [lista, setLista] = useState([]);
  const [proximo, setProximo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const filtro = useCallback(() => {
    const [qual, id] = item.split(':');
    return { produtoId: qual === 'p' ? id : null, insumoId: qual === 'i' ? id : null, tipo: tipo || null };
  }, [item, tipo]);

  const buscar = useCallback(
    async (antesDeId) => {
      setCarregando(true);
      setErro('');
      try {
        const r = await api.estoque.movimentacoes({ ...filtro(), antesDeId });
        setLista((l) => (antesDeId ? [...l, ...r.movimentacoes] : r.movimentacoes));
        setProximo(r.proximo);
      } catch (err) {
        setErro(err.message);
      } finally {
        setCarregando(false);
      }
    },
    [filtro],
  );

  useEffect(() => {
    buscar(null);
  }, [buscar]);

  return (
    <>
      <div className="filtros">
        <select className="entrada" aria-label="Item" value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">Todos os itens</option>
          <optgroup label="Produtos">
            {dados.produtos.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.nome}
              </option>
            ))}
          </optgroup>
          <optgroup label="Insumos">
            {dados.insumos.map((i) => (
              <option key={i.id} value={`i:${i.id}`}>
                {i.nome}
              </option>
            ))}
          </optgroup>
        </select>
        <select className="entrada" aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(NOMES_MOVIMENTACAO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </select>
      </div>
      {erro && <div className="alerta">{erro}</div>}
      <section className="cartao tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Item</th>
              <th>Tipo</th>
              <th className="num">Qtd.</th>
              <th>Motivo / pedido</th>
              <th>Quem</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatarDataHora(m.criadoEm)}</td>
                <td>{m.produto?.nome ?? m.insumo?.nome}</td>
                <td>
                  <span className={`etiqueta${m.tipo === 'AJUSTE' ? ' etiqueta--aviso' : m.tipo === 'ENTRADA' ? ' etiqueta--ok' : ''}`}>
                    {NOMES_MOVIMENTACAO[m.tipo]}
                  </span>
                </td>
                <td className={`num delta ${m.quantidade > 0 ? 'delta--mais' : 'delta--menos'}`}>{comSinal(m.quantidade)}</td>
                <td>
                  {m.motivo ?? (m.pedido ? `Pedido #${m.pedido.numeroDia}` : <span className="suave">—</span>)}
                </td>
                <td>{m.usuario?.nome ?? <span className="suave">{m.pedido?.canal === 'SITE' ? 'Site' : m.pedido?.canal === 'APP' ? 'App' : '—'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!carregando && !lista.length && <div className="tabela-vazia">Nenhuma movimentação.</div>}
        {carregando && <div className="tabela-vazia">Carregando…</div>}
      </section>
      {proximo && !carregando && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button type="button" className="botao" onClick={() => buscar(proximo)}>
            Carregar mais
          </button>
        </div>
      )}
    </>
  );
}
