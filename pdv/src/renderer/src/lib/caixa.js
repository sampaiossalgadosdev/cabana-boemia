/**
 * Caixa no PDV: leitura de valores, aviso de caixa esquecido aberto e a lista
 * de pedidos que bloqueiam o fechamento. Lógica pura (testada com node:test).
 * O PDV nunca recebe o esperado nem a diferença (fechamento cego).
 */
import { lerReais } from './lancamento.js';

export const VALOR_CAIXA_MAX = 10_000_000;

/**
 * Campo de valor em reais → centavos.
 * @returns {{ centavos: number | null, erro: string | null }}
 */
export function lerValorCaixa(texto, { minimo = 0, obrigatorio = true } = {}) {
  const centavos = lerReais(texto);
  if (centavos == null) return { centavos: null, erro: obrigatorio ? 'Informe o valor' : null };
  if (Number.isNaN(centavos)) return { centavos: null, erro: 'Valor inválido' };
  if (centavos < minimo) return { centavos: null, erro: minimo > 0 ? 'O valor precisa ser maior que zero' : 'Valor inválido' };
  if (centavos > VALOR_CAIXA_MAX) return { centavos: null, erro: 'Valor alto demais' };
  return { centavos, erro: null };
}

const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const diaMes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
const horaMin = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

// Hora da virada do dia operacional (Configuracao.horaViradaDia), recebida em
// GET /equipe/caixa/atual. Padrão 4 até a primeira resposta.
let horaViradaAtual = 4;
export const definirHoraVirada = (h) => {
  if (Number.isInteger(h) && h >= 0 && h <= 12) horaViradaAtual = h;
};
export const horaVirada = () => horaViradaAtual;

/**
 * Dia OPERACIONAL "YYYY-MM-DD" (vira às `horaVirada`:00, não à meia-noite).
 * Desloca o instante pela virada e pega o dia local (o Brasil não tem horário
 * de verão; mesma regra da API em lib/fuso.js).
 */
export const diaOperacional = (instante, horaVirada = horaViradaAtual) =>
  dia.format(new Date(new Date(instante).getTime() - horaVirada * 3_600_000));

/** Caixa aberto num dia operacional anterior a hoje (esquecido aberto)? */
export const abertoAntesDeHoje = (abertoEm, agora = new Date(), horaVirada = horaViradaAtual) =>
  diaOperacional(abertoEm, horaVirada) < diaOperacional(agora, horaVirada);

/** "Caixa aberto desde 14/11 às 19:02" se esquecido; senão null. */
export function avisoCaixaEsquecido(caixa, agora = new Date(), horaVirada = horaViradaAtual) {
  if (!caixa || !abertoAntesDeHoje(caixa.abertoEm, agora, horaVirada)) return null;
  const d = new Date(caixa.abertoEm);
  return `Caixa aberto desde ${diaMes.format(d)} às ${horaMin.format(d)}`;
}

const NOME_CANAL = { SITE: 'Site', APP: 'App', WHATSAPP: 'WhatsApp', SALAO: 'Comanda' };

/** "Comanda #3 · Maria (Mesa 2)" / "WhatsApp #5 · João". */
export function descreverPendente(p) {
  const mesa = p.mesaRotulo ? ` (Mesa ${p.mesaRotulo})` : '';
  return `${NOME_CANAL[p.canal] ?? p.canal} #${p.numeroDia} · ${p.nomeCliente}${mesa}`;
}

/**
 * O que dá para fazer com o pedido pendente direto da lista do 409.
 * Comanda sem itens não fecha (409 COMANDA_VAZIA na API): só excluir.
 */
export function acoesDoPendente(p) {
  const comandaVazia = p.canal === 'SALAO' && p.quantidadeItens === 0;
  return {
    finalizar: !comandaVazia,
    rotuloFinalizar: p.canal === 'SALAO' ? 'Fechar conta' : 'Finalizar',
    rotuloCancelar: comandaVazia ? 'Excluir' : 'Cancelar',
    avisoCancelar:
      p.canal === 'SALAO' ? 'O estoque dos itens volta.' : 'O estoque volta e sai um cupom de cancelamento.',
  };
}

export const removerPendente = (lista, id) => lista.filter((p) => p.id !== id);
