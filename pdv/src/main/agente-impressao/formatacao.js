/**
 * Cupom (linhas do shared/cupom.js) → bytes ESC/POS ou texto. A montagem do
 * conteúdo fica no shared; aqui só entram as opções da impressora.
 */
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import { cupomParaTexto } from '@restaurante/shared/cupom';

/** Linhas de avanço antes do corte (a guilhotina fica acima da cabeça de impressão). */
const AVANCO_ANTES_DO_CORTE = 4;
/** Sem guilhotina: avança o bastante para destacar o papel na serrilha. */
const AVANCO_SEM_GUILHOTINA = 6;

/**
 * @param {{ texto: string, negrito?: boolean, grande?: boolean }[]} linhas
 * @param {{ largura: 48 | 32, tabela: 'cp860' | 'cp850', guilhotina: boolean }} opcoes
 * @returns {Uint8Array}
 */
export function cupomParaEscPos(linhas, { largura, tabela, guilhotina }) {
  const e = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: largura,
    feedBeforeCut: AVANCO_ANTES_DO_CORTE,
    // Tabela fixa (sem "auto"): o mesmo byte para "ç" em todo cupom.
    codepageMapping: 'epson',
  });
  e.initialize().codepage(tabela);
  for (const l of linhas) {
    if (l.negrito) e.bold(true);
    if (l.grande) e.size(2, 2);
    // Texto já vem alinhado e com a largura exata do shared/cupom.js.
    e.line(l.texto);
    if (l.grande) e.size(1, 1);
    if (l.negrito) e.bold(false);
  }
  if (guilhotina) e.cut('partial');
  else e.newline(AVANCO_SEM_GUILHOTINA);
  return e.encode();
}

export { cupomParaTexto };
