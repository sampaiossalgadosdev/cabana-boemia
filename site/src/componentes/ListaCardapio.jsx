import { formatarPreco } from '../lib/dinheiro.js';
import { idSecao } from '../hooks/useCategoriaAtiva.js';

function CardProduto({ produto, desabilitado, onAdicionar }) {
  return (
    <li className="card">
      <h3 className="card__nome">{produto.nome}</h3>
      {produto.descricao && <p className="card__descricao">{produto.descricao}</p>}
      <div className="card__rodape">
        <span className="preco">{formatarPreco(produto.precoCentavos)}</span>
        <button
          type="button"
          className="botao botao--primario"
          disabled={desabilitado}
          onClick={() => onAdicionar(produto)}
          aria-label={desabilitado ? `${produto.nome}: fechado agora` : `Adicionar ${produto.nome}`}
        >
          {desabilitado ? 'Fechado' : 'Adicionar'}
        </button>
      </div>
    </li>
  );
}

function SecaoCategoria({ categoria, desabilitado, onAdicionar }) {
  const tituloId = `${idSecao(categoria.id)}-titulo`;
  return (
    <section
      id={idSecao(categoria.id)}
      data-categoria={categoria.id}
      className="secao"
      aria-labelledby={tituloId}
    >
      <h2 id={tituloId} className="secao__titulo">
        {categoria.nome}
      </h2>
      <ul className="lista-produtos">
        {categoria.produtos.map((p) => (
          <CardProduto key={p.id} produto={p} desabilitado={desabilitado} onAdicionar={onAdicionar} />
        ))}
      </ul>
    </section>
  );
}

export function ListaCardapio({ categorias, desabilitado, onAdicionar }) {
  if (!categorias.length) {
    return <p className="vazio">Nenhum item disponível no momento.</p>;
  }
  return categorias.map((c) => (
    <SecaoCategoria key={c.id} categoria={c} desabilitado={desabilitado} onAdicionar={onAdicionar} />
  ));
}

export function EstadoCarregando() {
  return (
    <div className="secao" aria-busy="true" aria-label="Carregando cardápio">
      <div className="lista-produtos">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="esqueleto" />
        ))}
      </div>
    </div>
  );
}
