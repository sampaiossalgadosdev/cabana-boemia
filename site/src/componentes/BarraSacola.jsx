import { progressoFreteGratis } from '@restaurante/shared/frete';
import { useCarrinho } from '../carrinho/CarrinhoContext.jsx';
import { formatarPreco } from '../lib/dinheiro.js';
import { logoUrl } from '../lib/logo.js';
import { rotuloItens } from '../sacola/sacola.js';

/**
 * Linha de frete grátis acima da sacola. Usa o subtotal dos itens (sem a
 * taxa). Desligado na retaguarda (`freteGratis` null): não aparece.
 */
export function LinhaFreteGratis({ subtotalCentavos, freteGratis }) {
  const p = progressoFreteGratis(subtotalCentavos, freteGratis);
  if (!p) return null;
  return (
    <div className={`frete-gratis${p.atingido ? ' frete-gratis--atingido' : ''}`}>
      <p className="frete-gratis__texto" aria-live="polite">
        {p.atingido ? (
          <>
            Você ganhou frete grátis! <span aria-hidden="true">🎉</span>
          </>
        ) : (
          <>
            Faltam <strong>{formatarPreco(p.faltaCentavos)}</strong> para frete grátis
          </>
        )}
      </p>
      <div
        className="frete-gratis__trilho"
        role="progressbar"
        aria-label="Progresso para o frete grátis"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percentual}
      >
        <div className="frete-gratis__barra" style={{ transform: `scaleX(${p.percentual / 100})` }} />
      </div>
    </div>
  );
}

/** Barra da sacola (fixa, acima da navegação); some com a sacola vazia. */
export function BarraSacola({ onAbrir, freteGratis }) {
  const { totalItens, totalCentavos } = useCarrinho();
  if (!totalItens) return null;
  return (
    <div className="barra-sacola">
      <div className="barra-sacola__cartao">
        <LinhaFreteGratis subtotalCentavos={totalCentavos} freteGratis={freteGratis} />
        <div className="barra-sacola__linha">
          <img className="barra-sacola__logo" src={logoUrl} alt="" />
          <p className="barra-sacola__resumo">
            <strong>{formatarPreco(totalCentavos)}</strong>
            <span className="barra-sacola__separador" aria-hidden="true">
              /
            </span>
            <span>{rotuloItens(totalItens)}</span>
          </p>
          <button type="button" className="botao botao--primario barra-sacola__botao" onClick={onAbrir}>
            Ver sacola
          </button>
        </div>
      </div>
    </div>
  );
}
