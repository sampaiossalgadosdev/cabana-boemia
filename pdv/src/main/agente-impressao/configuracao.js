/**
 * Configuração da impressora do PDV (guardada no config.json do userData).
 * Nenhum valor de impressora fica fixo no código: estes são só os padrões
 * até a configuração ser salva na tela "Impressora".
 *
 * `modo`:
 *  - "desligado": este computador não imprime (padrão). Importante: se dois
 *    PDVs imprimissem, cada cupom sairia duas vezes.
 *  - "impressora": envio RAW para a impressora instalada no Windows.
 *  - "arquivo": modo teste, grava cada cupom em .txt (sem impressora).
 */
export const MODOS = ['desligado', 'impressora', 'arquivo'];
export const LARGURAS = [48, 32];
export const TABELAS = ['cp860', 'cp850'];

export const PADRAO_IMPRESSAO = Object.freeze({
  modo: 'desligado',
  impressora: '',
  largura: 48,
  tabela: 'cp860',
  guilhotina: true,
});

/**
 * Valida o que vem da tela. Lança Error com mensagem pronta.
 * @returns {typeof PADRAO_IMPRESSAO}
 */
export function validarConfigImpressao(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const modo = d.modo ?? PADRAO_IMPRESSAO.modo;
  if (!MODOS.includes(modo)) throw new Error('Modo de impressão inválido');
  const impressora = typeof d.impressora === 'string' ? d.impressora.trim() : '';
  if (impressora.length > 256) throw new Error('Nome da impressora muito longo');
  if (modo === 'impressora' && !impressora) throw new Error('Escolha a impressora instalada no Windows');
  const largura = Number(d.largura ?? PADRAO_IMPRESSAO.largura);
  if (!LARGURAS.includes(largura)) throw new Error('Largura deve ser 48 ou 32 colunas');
  const tabela = d.tabela ?? PADRAO_IMPRESSAO.tabela;
  if (!TABELAS.includes(tabela)) throw new Error('Tabela de caracteres deve ser cp860 ou cp850');
  const guilhotina = d.guilhotina ?? PADRAO_IMPRESSAO.guilhotina;
  if (typeof guilhotina !== 'boolean') throw new Error('Guilhotina: ligada ou desligada');
  return { modo, impressora, largura, tabela, guilhotina };
}

/** Lê o salvo; o que estiver inválido volta ao padrão (nunca lança). */
export function lerConfigImpressao(salvo) {
  try {
    return validarConfigImpressao({ ...PADRAO_IMPRESSAO, ...(salvo ?? {}) });
  } catch {
    return { ...PADRAO_IMPRESSAO };
  }
}
