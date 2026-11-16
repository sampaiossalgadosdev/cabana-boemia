import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import { Confirmar, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/**
 * Cardápio do dia: o dono liga/desliga o que tem hoje e edita a descrição
 * (ex.: a marmita do dia). `disponivelHoje` não reseta sozinho.
 */
export function TelaCardapioDoDia() {
  const [turnoId, setTurnoId] = useState(null);
  const carga = useCarregar(() => api.cardapioDoDia.obter(turnoId), [turnoId]);
  const [confirmar, setConfirmar] = useState(null);
  const avisar = useAvisar();

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Cardápio do dia</h1>
          <p className="pagina__sub">O que está desligado não aparece no site. Nada desliga sozinho na virada do dia.</p>
        </div>
      </div>
      <EstadoCarga carga={carga}>
        {(dados) => (
          <ConteudoDia
            dados={dados}
            aoTrocarTurno={setTurnoId}
            aoMudarProduto={() => carga.recarregar()}
            aoLiberarTudo={() =>
              setConfirmar({
                titulo: 'Liberar tudo',
                texto: `Ligar todos os produtos ativos do turno ${dados.turno.nome} para hoje?`,
                confirmar: 'Liberar tudo',
                acao: async () => {
                  const { liberados } = await api.cardapioDoDia.liberarTudo(dados.turno.id);
                  await carga.recarregar();
                  avisar(liberados ? `${liberados} produto(s) liberado(s).` : 'Tudo já estava liberado.');
                },
              })
            }
          />
        )}
      </EstadoCarga>
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}

function ConteudoDia({ dados, aoTrocarTurno, aoMudarProduto, aoLiberarTudo }) {
  const [produtos, setProdutos] = useState(dados.produtos);
  useEffect(() => setProdutos(dados.produtos), [dados.produtos]);
  const atualizar = (novo) => setProdutos((ps) => ps.map((p) => (p.id === novo.id ? novo : p)));

  const ligados = produtos.filter((p) => p.disponivelHoje).length;
  const grupos = [];
  for (const p of produtos) {
    let g = grupos.at(-1);
    if (g?.id !== p.categoria.id) grupos.push((g = { id: p.categoria.id, nome: p.categoria.nome, produtos: [] }));
    g.produtos.push(p);
  }

  return (
    <>
      <div className="abas" role="tablist" aria-label="Turno">
        {dados.turnos.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="aba"
            aria-selected={t.id === dados.turno?.id}
            onClick={() => aoTrocarTurno(t.id)}
          >
            {t.nome}
            {dados.turnoAtivo?.id === t.id && ' · aberto agora'}
          </button>
        ))}
      </div>

      {!dados.turno ? (
        <div className="estado">Nenhum turno cadastrado.</div>
      ) : (
        <section className="cartao">
          <div className="cartao__topo">
            <div>
              <h2 className="cartao__titulo">{dados.turno.nome}</h2>
              <span className="suave">
                {ligados} de {produtos.length} disponíveis hoje
              </span>
            </div>
            <button type="button" className="botao botao--primario" onClick={aoLiberarTudo} disabled={!produtos.length}>
              Liberar tudo
            </button>
          </div>
          {!produtos.length && (
            <div className="tabela-vazia">Nenhum produto ativo neste turno. Cadastre em Produtos.</div>
          )}
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="secao-categoria">{g.nome}</div>
              {g.produtos.map((p) => (
                <ItemDoDia key={p.id} produto={p} aoMudar={atualizar} aoFalhar={aoMudarProduto} />
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function ItemDoDia({ produto, aoMudar, aoFalhar }) {
  const avisar = useAvisar();
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(produto.descricao);
  const campo = useRef(null);

  useEffect(() => {
    if (!editando) setTexto(produto.descricao);
  }, [produto.descricao, editando]);
  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  async function alternar(ligar) {
    setSalvando(true);
    aoMudar({ ...produto, disponivelHoje: ligar });
    try {
      aoMudar((await api.produtos.disponivelHoje(produto.id, ligar)).produto);
    } catch (err) {
      aoMudar(produto);
      avisar(err.message, 'erro');
      aoFalhar();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarDescricao() {
    if (!editando) return;
    const nova = texto.trim();
    setEditando(false);
    if (nova === produto.descricao) return;
    try {
      aoMudar((await api.produtos.descricao(produto.id, nova)).produto);
      avisar(`Descrição de ${produto.nome} salva.`);
    } catch (err) {
      setTexto(produto.descricao);
      avisar(err.message, 'erro');
    }
  }

  const preco =
    produto.tipoPreco === 'POR_KG' ? `${formatarReais(produto.precoCentavos)}/kg` : formatarReais(produto.precoCentavos);

  return (
    <div className={`item-dia${produto.disponivelHoje ? '' : ' item-dia--desligado'}`}>
      <Interruptor
        ligado={produto.disponivelHoje}
        aoMudar={alternar}
        desabilitado={salvando}
        rotulo={`${produto.nome} disponível hoje`}
        ocultarRotulo
      />
      <div>
        <div className="item-dia__nome">
          <span>{produto.nome}</span>
          <span className="suave">{preco}</span>
          {produto.esgotado && <span className="etiqueta etiqueta--alerta">Sem estoque</span>}
          {!produto.vendidoNoSite && <span className="etiqueta">Só no PDV</span>}
          {!produto.disponivelHoje && <span className="etiqueta">Fora de hoje</span>}
        </div>
        <div className="item-dia__descricao">
          {editando ? (
            <>
              <textarea
                ref={campo}
                className="entrada"
                value={texto}
                maxLength={500}
                rows={2}
                aria-label={`Descrição de ${produto.nome}`}
                onChange={(e) => setTexto(e.target.value)}
                onBlur={salvarDescricao}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setTexto(produto.descricao);
                    setEditando(false);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    salvarDescricao(); // fecha o campo; o onBlur não roda depois (o textarea some)
                  }
                }}
              />
              <span className="campo__ajuda">Enter salva · Esc desfaz · Shift+Enter quebra a linha</span>
            </>
          ) : (
            <button type="button" className="item-dia__descricao-texto" onClick={() => setEditando(true)}>
              {produto.descricao || <em>Sem descrição. Toque para escrever.</em>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
