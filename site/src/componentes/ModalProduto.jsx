import { useState } from 'react';
import { Dialogo } from './Dialogo.jsx';
import { ImagemProduto } from './ImagemProduto.jsx';
import { formatarPreco } from '../lib/dinheiro.js';
import { OBSERVACAO_MAX, QUANTIDADE_MAX } from '../carrinho/carrinho.js';

function SeletorQuantidade({ valor, onMudar }) {
  return (
    <div className="campo">
      <span className="campo__rotulo" id="rotulo-qtd">
        Quantidade
      </span>
      <div className="quantidade" role="group" aria-labelledby="rotulo-qtd">
        <button
          type="button"
          onClick={() => onMudar(valor - 1)}
          disabled={valor <= 1}
          aria-label="Diminuir"
        >
          −
        </button>
        <output aria-live="polite">{valor}</output>
        <button
          type="button"
          onClick={() => onMudar(valor + 1)}
          disabled={valor >= QUANTIDADE_MAX}
          aria-label="Aumentar"
        >
          +
        </button>
      </div>
    </div>
  );
}

function CampoObservacao({ valor, onMudar }) {
  return (
    <div className="campo">
      <label className="campo__rotulo" htmlFor="observacao">
        Observação
        <span className="campo__dica">
          {valor.length}/{OBSERVACAO_MAX}
        </span>
      </label>
      <textarea
        id="observacao"
        value={valor}
        maxLength={OBSERVACAO_MAX}
        placeholder="Ex.: sem cebola, ponto da carne…"
        onChange={(e) => onMudar(e.target.value)}
      />
    </div>
  );
}

/**
 * Adiciona um produto ou edita uma linha do carrinho (quando `item` vem).
 * Monte com `key` diferente a cada abertura para reiniciar o formulário.
 * @param {{ produto: { nome: string, descricao?: string, precoCentavos: number } | null,
 *           item?: { quantidade: number, observacao: string } | null,
 *           onConfirmar: (dados: { quantidade: number, observacao: string }) => void,
 *           onFechar: () => void }} props
 */
export function ModalProduto({ produto, item, onConfirmar, onFechar }) {
  const [quantidade, setQuantidade] = useState(item?.quantidade ?? 1);
  const [observacao, setObservacao] = useState(item?.observacao ?? '');
  const editando = Boolean(item);

  const confirmar = () => onConfirmar({ quantidade, observacao });
  const total = produto ? formatarPreco(produto.precoCentavos * quantidade) : '';

  return (
    <Dialogo
      aberto={Boolean(produto)}
      titulo={produto?.nome ?? ''}
      onFechar={onFechar}
      rodape={
        <button type="button" className="botao botao--primario botao--bloco" onClick={confirmar}>
          {editando ? 'Salvar alterações' : 'Adicionar'} · {total}
        </button>
      }
    >
      {produto && (
        <>
          {/* Sem foto (ou falhou): o modal fica como antes, sem placeholder grande. */}
          <ImagemProduto src={produto.imagemUrl} className="modal-produto__imagem" carregamento="eager" placeholder={false} />
          {produto.descricao && <p className="modal-produto__descricao">{produto.descricao}</p>}
          <span className="preco">{formatarPreco(produto.precoCentavos)}</span>
          <SeletorQuantidade valor={quantidade} onMudar={setQuantidade} />
          <CampoObservacao valor={observacao} onMudar={setObservacao} />
        </>
      )}
    </Dialogo>
  );
}
