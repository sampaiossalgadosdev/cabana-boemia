import { formatarPreco } from '../lib/dinheiro.js';
import { idSecao } from '../hooks/useCategoriaAtiva.js';
import { ImagemProduto } from './ImagemProduto.jsx';

/**
 * Card horizontal (texto à esquerda, foto à direita). O card inteiro abre o
 * modal do produto: o botão fica no nome (título acessível) e se estica sobre o
 * card. Loja fechada: prévia, botão desabilitado.
 */
function CardProduto({ produto, desabilitado, onAdicionar }) {
  return (
    <li className={`produto${desabilitado ? ' produto--fechado' : ''}`}>
      <div className="produto__texto">
        <h3 className="produto__nome">
          <button
            type="button"
            className="produto__abrir"
            disabled={desabilitado}
            onClick={() => onAdicionar(produto)}
            aria-label={desabilitado ? `${produto.nome}: fechado agora` : undefined}
          >
            {produto.nome}
          </button>
        </h3>
        {produto.descricao && <p className="produto__descricao">{produto.descricao}</p>}
        <span className="produto__rodape">
          <span className="preco">{formatarPreco(produto.precoCentavos)}</span>
          {desabilitado && <span className="produto__fechado">Fechado agora</span>}
        </span>
      </div>
      <ImagemProduto src={produto.imagemUrl} className="produto__imagem" />
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
      <div className="lista-carregando">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="esqueleto" />
        ))}
      </div>
    </div>
  );
}
