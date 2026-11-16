import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import { errosPorCampo, paraBusca } from '../lib/formatar.js';
import { Campo, CampoDinheiro, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

async function carregarTudo() {
  const [{ produtos }, { categorias }, { turnos }, { insumos }] = await Promise.all([
    api.produtos.listar(),
    api.categorias.listar(),
    api.turnos.listar(),
    api.estoque.obter(),
  ]);
  return { produtos, categorias, turnos, insumos };
}

export function TelaProdutos({ ir }) {
  const carga = useCarregar(carregarTudo);
  const [editando, setEditando] = useState(null); // produto | 'novo'

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Produtos</h1>
          <p className="pagina__sub">Preço, turnos, estoque e receita. Produto não é excluído: desative.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')} disabled={!carga.dados}>
          + Novo produto
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {(dados) => (
          <>
            <ListaProdutos dados={dados} aoEditar={setEditando} />
            <FormProduto
              aberto={editando != null}
              produto={editando === 'novo' ? null : editando}
              dados={dados}
              aoFechar={() => setEditando(null)}
              aoSalvar={async () => {
                setEditando(null);
                await carga.recarregar();
              }}
              irParaEstoque={() => ir('estoque')}
            />
          </>
        )}
      </EstadoCarga>
    </>
  );
}

function ListaProdutos({ dados, aoEditar }) {
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [situacao, setSituacao] = useState('ativos');

  const filtrados = useMemo(() => {
    const termo = paraBusca(busca);
    return dados.produtos.filter(
      (p) =>
        (!termo || paraBusca(p.nome).includes(termo)) &&
        (!categoriaId || p.categoria.id === Number(categoriaId)) &&
        (situacao === 'todos' || (situacao === 'ativos' ? p.ativo : !p.ativo)),
    );
  }, [dados.produtos, busca, categoriaId, situacao]);

  return (
    <>
      <div className="filtros">
        <input
          className="entrada"
          type="search"
          placeholder="Buscar produto"
          aria-label="Buscar produto"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select className="entrada" aria-label="Categoria" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
          <option value="">Todas as categorias</option>
          {dados.categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
              {c.ativo ? '' : ' (inativa)'}
            </option>
          ))}
        </select>
        <select className="entrada" aria-label="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      <section className="cartao tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th className="num">Preço</th>
              <th>Turnos</th>
              <th>Estoque</th>
              <th className="fim">
                <span className="visualmente-oculto">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <tr key={p.id} className={p.ativo ? undefined : 'linha--inativa'}>
                <td className="produto-nome">
                  {p.nome}
                  <div className="etiquetas" style={{ marginTop: 4 }}>
                    {!p.ativo && <span className="etiqueta">Inativo</span>}
                    {!p.vendidoNoSite && <span className="etiqueta">Só no PDV</span>}
                    {!p.categoria.ativo && <span className="etiqueta etiqueta--aviso">Categoria inativa</span>}
                  </div>
                </td>
                <td>{p.categoria.nome}</td>
                <td className="num">
                  {formatarReais(p.precoCentavos)}
                  {p.tipoPreco === 'POR_KG' && <span className="suave">/kg</span>}
                </td>
                <td>
                  <div className="etiquetas">
                    {p.turnos.map((t) => (
                      <span key={t.id} className="etiqueta etiqueta--ouro">
                        {t.nome}
                      </span>
                    ))}
                    {!p.turnos.length && <span className="etiqueta etiqueta--aviso">Nenhum</span>}
                  </div>
                </td>
                <td>
                  {p.controlaEstoque ? (
                    <span className={p.estoqueMinimo != null && p.estoque < p.estoqueMinimo ? 'etiqueta etiqueta--alerta' : ''}>
                      {p.estoque} un.
                    </span>
                  ) : p.insumos.length ? (
                    <span className="suave">{p.insumos.map((i) => i.nome).join(', ')}</span>
                  ) : (
                    <span className="suave">—</span>
                  )}
                </td>
                <td className="fim">
                  <button type="button" className="botao botao--pequeno" onClick={() => aoEditar(p)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtrados.length && <div className="tabela-vazia">Nenhum produto encontrado.</div>}
      </section>
    </>
  );
}

const vazio = (dados) => ({
  nome: '',
  descricao: '',
  categoriaId: dados.categorias.find((c) => c.ativo)?.id ?? '',
  tipoPreco: 'UNIDADE',
  precoCentavos: null,
  ativo: true,
  vendidoNoSite: true,
  controlaEstoque: false,
  estoqueMinimo: '',
  ordem: 0,
  turnoIds: [],
  insumos: [],
});

const doProduto = (p) => ({
  nome: p.nome,
  descricao: p.descricao,
  categoriaId: p.categoria.id,
  tipoPreco: p.tipoPreco,
  precoCentavos: p.precoCentavos,
  ativo: p.ativo,
  vendidoNoSite: p.vendidoNoSite,
  controlaEstoque: p.controlaEstoque,
  estoqueMinimo: p.estoqueMinimo ?? '',
  ordem: p.ordem,
  turnoIds: p.turnos.map((t) => t.id),
  insumos: p.insumos.map((i) => ({ insumoId: i.insumoId, quantidade: i.quantidade })),
});

function FormProduto({ aberto, produto, dados, aoFechar, aoSalvar, irParaEstoque }) {
  const avisar = useAvisar();
  const [f, setF] = useState(null);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [chave, setChave] = useState(null);

  // Reinicia o formulário a cada abertura.
  const chaveAtual = aberto ? (produto?.id ?? 'novo') : null;
  if (chaveAtual !== chave) {
    setChave(chaveAtual);
    setF(aberto ? (produto ? doProduto(produto) : vazio(dados)) : null);
    setErros({});
    setErroGeral('');
    setSalvando(false);
  }

  const mudar = (campo, valor) => {
    setF((x) => ({ ...x, [campo]: valor }));
    setErros((e) => (e[campo] ? { ...e, [campo]: undefined } : e));
  };
  const porKg = f?.tipoPreco === 'POR_KG';

  function validar() {
    const e = {};
    if (!f.nome.trim()) e.nome = 'Informe o nome';
    if (!f.categoriaId) e.categoriaId = 'Escolha a categoria';
    if (f.precoCentavos == null) e.precoCentavos = 'Preço inválido';
    else if (f.ativo && f.precoCentavos <= 0) e.precoCentavos = 'Defina o preço antes de ativar';
    if (f.estoqueMinimo !== '' && !/^\d+$/.test(String(f.estoqueMinimo))) e.estoqueMinimo = 'Use um número inteiro';
    if (!/^\d+$/.test(String(f.ordem))) e.ordem = 'Use um número inteiro';
    if (f.insumos.some((i) => !i.insumoId || !(i.quantidade >= 1))) e.insumos = 'Escolha o insumo e a quantidade';
    if (new Set(f.insumos.map((i) => i.insumoId)).size !== f.insumos.length) e.insumos = 'Insumo repetido';
    return e;
  }

  async function salvar() {
    const e = validar();
    setErros(e);
    if (Object.keys(e).length) return;
    const corpo = {
      nome: f.nome.trim(),
      descricao: f.descricao.trim(),
      categoriaId: Number(f.categoriaId),
      tipoPreco: f.tipoPreco,
      precoCentavos: f.precoCentavos,
      ativo: f.ativo,
      vendidoNoSite: f.vendidoNoSite,
      controlaEstoque: porKg ? false : f.controlaEstoque,
      estoqueMinimo: !porKg && f.controlaEstoque && f.estoqueMinimo !== '' ? Number(f.estoqueMinimo) : null,
      ordem: Number(f.ordem),
      turnoIds: f.turnoIds,
      insumos: porKg ? [] : f.insumos.map((i) => ({ insumoId: Number(i.insumoId), quantidade: Number(i.quantidade) })),
    };
    setSalvando(true);
    setErroGeral('');
    try {
      if (produto) await api.produtos.alterar(produto.id, corpo);
      else await api.produtos.criar(corpo);
      avisar(produto ? `${corpo.nome} salvo.` : `${corpo.nome} criado.`);
      await aoSalvar();
    } catch (err) {
      setErros(errosPorCampo(err));
      setErroGeral(err.message);
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      largo
      titulo={produto ? `Editar ${produto.nome}` : 'Novo produto'}
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
      {f && (
        <>
          {erroGeral && <div className="alerta">{erroGeral}</div>}
          <div className="grade-form">
            <Campo rotulo="Nome" erro={erros.nome} className="inteiro">
              {(id, d) => (
                <input
                  id={id}
                  className="entrada"
                  maxLength={80}
                  value={f.nome}
                  aria-invalid={Boolean(erros.nome) || undefined}
                  aria-describedby={d}
                  onChange={(e) => mudar('nome', e.target.value)}
                />
              )}
            </Campo>
            <Campo rotulo="Descrição" erro={erros.descricao} className="inteiro">
              {(id) => (
                <textarea
                  id={id}
                  className="entrada"
                  rows={2}
                  maxLength={500}
                  value={f.descricao}
                  onChange={(e) => mudar('descricao', e.target.value)}
                />
              )}
            </Campo>
            <Campo rotulo="Categoria" erro={erros.categoriaId}>
              {(id, d) => (
                <select
                  id={id}
                  className="entrada"
                  value={f.categoriaId}
                  aria-describedby={d}
                  onChange={(e) => mudar('categoriaId', e.target.value)}
                >
                  <option value="">Escolha…</option>
                  {dados.categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.ativo ? '' : ' (inativa)'}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            <div className="campo">
              <span className="campo__rotulo">Tipo de preço</span>
              <div className="opcoes" role="radiogroup" aria-label="Tipo de preço">
                {[
                  ['UNIDADE', 'Por unidade'],
                  ['POR_KG', 'Por quilo'],
                ].map(([valor, rotulo]) => (
                  <label key={valor} className="opcao">
                    <input
                      type="radio"
                      name="tipoPreco"
                      checked={f.tipoPreco === valor}
                      onChange={() => mudar('tipoPreco', valor)}
                    />
                    {rotulo}
                  </label>
                ))}
              </div>
            </div>
            <Campo rotulo={porKg ? 'Preço do quilo (R$)' : 'Preço (R$)'} erro={erros.precoCentavos}>
              {(id, d) => (
                <CampoDinheiro
                  id={id}
                  valor={f.precoCentavos}
                  invalido={Boolean(erros.precoCentavos)}
                  descritoPor={d}
                  aoMudar={(c) => mudar('precoCentavos', c)}
                />
              )}
            </Campo>
            <Campo rotulo="Ordem na categoria" erro={erros.ordem} ajuda="Menor aparece primeiro">
              {(id, d) => (
                <input
                  id={id}
                  className="entrada entrada--curta"
                  inputMode="numeric"
                  value={f.ordem}
                  aria-describedby={d}
                  onChange={(e) => mudar('ordem', e.target.value.replace(/\D/g, ''))}
                />
              )}
            </Campo>

            <div className="campo inteiro">
              <span className="campo__rotulo">Turnos</span>
              <div className="opcoes">
                {dados.turnos.map((t) => (
                  <label key={t.id} className="opcao">
                    <input
                      type="checkbox"
                      checked={f.turnoIds.includes(t.id)}
                      onChange={(e) =>
                        mudar('turnoIds', e.target.checked ? [...f.turnoIds, t.id] : f.turnoIds.filter((x) => x !== t.id))
                      }
                    />
                    {t.nome}
                  </label>
                ))}
              </div>
              {!f.turnoIds.length && <span className="campo__ajuda">Sem turno, o produto não aparece em lugar nenhum.</span>}
            </div>

            <div className="campo">
              <Interruptor ligado={f.ativo} aoMudar={(v) => mudar('ativo', v)} rotulo="Ativo" />
            </div>
            <div className="campo">
              <Interruptor ligado={f.vendidoNoSite} aoMudar={(v) => mudar('vendidoNoSite', v)} rotulo="Vendido no site" />
            </div>
          </div>

          <fieldset className="cartao" style={{ padding: '12px 16px 4px', margin: '4px 0 16px', boxShadow: 'none' }}>
            <legend className="campo__rotulo" style={{ padding: '0 4px' }}>
              Estoque
            </legend>
            {porKg ? (
              <p className="suave" style={{ marginTop: 0 }}>
                Produto por quilo não controla estoque nem consome insumos.
              </p>
            ) : (
              <>
                <div className="campo">
                  <Interruptor
                    ligado={f.controlaEstoque}
                    aoMudar={(v) => mudar('controlaEstoque', v)}
                    rotulo="Controla estoque próprio (ex.: bebidas)"
                  />
                </div>
                {f.controlaEstoque && (
                  <div className="grade-form">
                    <Campo rotulo="Estoque mínimo" erro={erros.estoqueMinimo} ajuda="Abaixo disso fica vermelho em Estoque">
                      {(id, d) => (
                        <input
                          id={id}
                          className="entrada entrada--curta"
                          inputMode="numeric"
                          placeholder="Sem mínimo"
                          value={f.estoqueMinimo}
                          aria-describedby={d}
                          onChange={(e) => mudar('estoqueMinimo', e.target.value.replace(/\D/g, ''))}
                        />
                      )}
                    </Campo>
                    <div className="campo">
                      <span className="campo__rotulo">Saldo</span>
                      <span>
                        {produto?.controlaEstoque ? `${produto.estoque} un.` : 'Começa em 0'} ·{' '}
                        <button type="button" className="botao botao--texto" onClick={irParaEstoque}>
                          entrada e ajuste em Estoque
                        </button>
                      </span>
                    </div>
                  </div>
                )}

                <div className="campo">
                  <span className="campo__rotulo">Insumos que consome (por unidade vendida)</span>
                  {f.insumos.map((linha, i) => (
                    <div key={i} className="linha-insumo">
                      <select
                        className="entrada"
                        aria-label="Insumo"
                        value={linha.insumoId}
                        onChange={(e) =>
                          mudar(
                            'insumos',
                            f.insumos.map((x, k) => (k === i ? { ...x, insumoId: Number(e.target.value) } : x)),
                          )
                        }
                      >
                        <option value="">Escolha…</option>
                        {dados.insumos.map((ins) => (
                          <option key={ins.id} value={ins.id}>
                            {ins.nome}
                          </option>
                        ))}
                      </select>
                      <input
                        className="entrada"
                        aria-label="Quantidade"
                        inputMode="numeric"
                        value={linha.quantidade}
                        onChange={(e) =>
                          mudar(
                            'insumos',
                            f.insumos.map((x, k) =>
                              k === i ? { ...x, quantidade: Number(e.target.value.replace(/\D/g, '')) || '' } : x,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="botao botao--icone botao--perigo"
                        aria-label="Remover insumo"
                        onClick={() => mudar('insumos', f.insumos.filter((_, k) => k !== i))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {erros.insumos && <span className="campo__erro">{erros.insumos}</span>}
                  <div>
                    <button
                      type="button"
                      className="botao botao--pequeno"
                      disabled={!dados.insumos.length}
                      onClick={() => mudar('insumos', [...f.insumos, { insumoId: '', quantidade: 1 }])}
                    >
                      + Insumo
                    </button>
                  </div>
                </div>
              </>
            )}
          </fieldset>
        </>
      )}
    </Dialogo>
  );
}
