/**
 * Tema do PDV pela loja (lógica pura, testada): a cor primária da loja nos
 * destaques (barra, botões, abas, assistente do novo pedido), a base clara
 * continua para a leitura. Sem loja (login, ADMIN escolhendo) ou cor ilegível:
 * o tema padrão do Táqui Delivery. A regra de contraste é a do shared.
 */
import { TEMA_PADRAO, variaveisDoTema } from '@restaurante/shared/cores';

/** @param {{ nome: string, corPrimaria?: string | null, logoDataUrl?: string | null } | null} loja */
export function temaDaLoja(loja) {
  return {
    nome: loja?.nome ?? TEMA_PADRAO.nome,
    logo: loja?.logoDataUrl ?? null,
    variaveis: variaveisDoTema(loja?.corPrimaria ?? null),
    titulo: loja ? `${loja.nome} · PDV` : 'Táqui PDV',
  };
}

/** Aplica no documento (variáveis CSS e título da janela). */
export function aplicarTema(loja, doc = document) {
  const tema = temaDaLoja(loja);
  for (const [nome, valor] of Object.entries(tema.variaveis)) doc.documentElement.style.setProperty(nome, valor);
  doc.title = tema.titulo;
  return tema;
}
