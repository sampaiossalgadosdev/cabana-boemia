/**
 * Fila de impressão do agente do PDV (balcão), por loja. O agente busca os pendentes da sua loja,
 * imprime em ordem de id e só confirma depois que a impressora aceitou.
 * Confirmar é idempotente (UPDATE condicionado): o mesmo id duas vezes não
 * muda nada. Falha só incrementa `tentativas`; o trabalho continua PENDENTE
 * e volta na próxima busca (nada se perde).
 */
import { ErroHttp } from '../lib/erros.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { HORA_VIRADA_PADRAO, diaOperacional, intervaloDoDia } from '../lib/fuso.js';
import { horaViradaDe } from './diaOperacional.service.js';
import { relatorioDoDia } from './relatorio.service.js';
import * as impressaoRepo from '../repositories/impressao.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as lojaService from './loja.service.js';
import { pedidoPublico, ehDaLoja } from './pedido.service.js';
import { resumoParaCupom } from './caixa.service.js';

/** Quantos trabalhos por busca (o agente busca de novo enquanto vier cheio). */
export const LIMITE_PENDENTES = 50;
/**
 * Quanto vale a reserva de um agente. Imprimir um cupom leva segundos (o agente
 * desiste em 30 s); se o agente cair, depois disso o trabalho volta a ficar livre.
 */
export const RESERVA_MS = 2 * 60_000;
/** Além do dia local, pega as últimas horas (pedido de 23h50 impresso depois da meia-noite). */
const HORAS_ANTES_DO_DIA = 2;
const MAX_ERRO = 500;

/**
 * A partir de quando um pendente ainda vale: início do dia OPERACIONAL ou
 * `HORAS_ANTES_DO_DIA` atrás, o que vier antes. Evita que um PDV ligado pela
 * primeira vez (ou depois de dias sem impressora) despeje cupons antigos.
 */
export function inicioDaJanela(agora, horaVirada = HORA_VIRADA_PADRAO) {
  const inicioDoDia = intervaloDoDia(diaOperacional(agora, horaVirada), horaVirada).inicio;
  return new Date(Math.min(inicioDoDia.getTime(), agora.getTime() - HORAS_ANTES_DO_DIA * 3_600_000));
}

const trabalhoPublico = (t) => ({
  id: t.id,
  tipo: t.tipo,
  status: t.status,
  tentativas: t.tentativas,
  ultimoErro: t.ultimoErro,
  criadoEm: t.criadoEm,
  impressoEm: t.impressoEm,
  pedidoId: t.pedidoId,
  caixaId: t.caixaId,
  dataRelatorio: t.dataRelatorio ? t.dataRelatorio.toISOString().slice(0, 10) : null,
  reservadoPor: t.reservadoPor ?? null,
  reservadoAte: t.reservadoAte ?? null,
  ...(t.pedido ? { pedido: pedidoPublico(t.pedido) } : {}),
});

/**
 * FECHAMENTO não tem pedido: leva o resumo do caixa (sem esperado nem
 * diferença). RELATORIO_DIA leva o relatório do dia operacional, calculado agora.
 */
async function comResumo(lojaId, t, agora) {
  const publico = trabalhoPublico(t);
  if (t.caixaId) publico.caixa = await resumoParaCupom(t.caixaId);
  if (t.dataRelatorio) publico.relatorio = await relatorioDoDia(lojaId, publico.dataRelatorio, agora);
  return publico;
}

/** @returns {{ restaurante: { nome: string }, limite: number, trabalhos: object[] }} */
export async function listarPendentes(lojaId, agora = new Date()) {
  const loja = await lojaService.buscar(lojaId);
  const trabalhos = await impressaoRepo.listarPendentes({
    lojaId,
    desde: inicioDaJanela(agora, horaViradaDe(loja)),
    limite: LIMITE_PENDENTES,
    agora,
  });
  return {
    restaurante: { nome: loja.nome },
    limite: LIMITE_PENDENTES,
    trabalhos: await Promise.all(trabalhos.map((t) => comResumo(lojaId, t, agora))),
  };
}

/**
 * Agente NOVO: reserva os pendentes livres da loja (atômico; ver
 * `reservarPendentes`) e devolve só esses, no formato de `listarPendentes`.
 * Chamar de novo com o mesmo `agente` renova a reserva dos que ele ainda tem.
 * @param {string} agente identificador do PDV (estável por computador)
 */
export async function reservarPendentes(lojaId, agente, agora = new Date(), { limite = LIMITE_PENDENTES } = {}) {
  const loja = await lojaService.buscar(lojaId);
  const ids = await impressaoRepo.reservarPendentes({
    lojaId,
    agente,
    desde: inicioDaJanela(agora, horaViradaDe(loja)),
    agora,
    ate: new Date(agora.getTime() + RESERVA_MS),
    limite: Math.min(limite, LIMITE_PENDENTES),
  });
  const trabalhos = ids.length ? await impressaoRepo.buscarVarios(lojaId, ids) : [];
  return {
    restaurante: { nome: loja.nome },
    limite: LIMITE_PENDENTES,
    reservaMs: RESERVA_MS,
    trabalhos: await Promise.all(trabalhos.map((t) => comResumo(lojaId, t, agora))),
  };
}

/** Reservado por OUTRO agente, com a reserva valendo: este não pode confirmar nem falhar. */
function conferirReserva(trabalho, agente, agora) {
  if (!agente || !trabalho?.reservadoPor) return;
  if (trabalho.reservadoPor !== agente && trabalho.reservadoAte > agora && trabalho.status === 'PENDENTE') {
    throw new ErroHttp(409, 'Este cupom está com outro computador', { codigo: 'TRABALHO_RESERVADO' });
  }
}

/**
 * Idempotente: a primeira chamada marca IMPRESSO; as seguintes devolvem o
 * mesmo trabalho com `jaConfirmado: true` (200, sem mudar `impressoEm`).
 * Com `agente` (agente novo): reservado por outro = 409 TRABALHO_RESERVADO.
 * Sem `agente` (PDV antigo): como antes.
 */
export async function confirmar(lojaId, id, agora = new Date(), { agente = null } = {}) {
  conferirReserva(await impressaoRepo.buscar(lojaId, id), agente, agora);
  const mudou = await impressaoRepo.confirmarSeNaoImpresso(lojaId, id, agora);
  const trabalho = await impressaoRepo.buscar(lojaId, id);
  if (!trabalho) throw new ErroHttp(404, 'Trabalho de impressão não encontrado', { codigo: 'NAO_ENCONTRADO' });
  return { trabalho: trabalhoPublico(trabalho), jaConfirmado: mudou === 0 };
}

/**
 * Incrementa `tentativas`, guarda o erro e libera a reserva. Já impresso = 409
 * (não volta a pendente). Com `agente`: reservado por outro = 409 TRABALHO_RESERVADO.
 */
export async function registrarFalha(lojaId, id, erro, { agente = null, agora = new Date() } = {}) {
  conferirReserva(await impressaoRepo.buscar(lojaId, id), agente, agora);
  const mensagem = String(erro ?? '').trim().slice(0, MAX_ERRO) || 'Falha na impressão';
  const mudou = await impressaoRepo.registrarFalhaSePendente(lojaId, id, mensagem);
  const trabalho = await impressaoRepo.buscar(lojaId, id);
  if (!trabalho) throw new ErroHttp(404, 'Trabalho de impressão não encontrado', { codigo: 'NAO_ENCONTRADO' });
  if (mudou === 0) {
    throw new ErroHttp(409, 'Trabalho já foi impresso', { codigo: 'TRABALHO_IMPRESSO' });
  }
  return { trabalho: trabalhoPublico(trabalho) };
}

/**
 * "Reimprimir" do PDV: um trabalho NOVO (outro id), nunca reabre o antigo.
 * Pedido cancelado reimprime o cupom de cancelamento; senão, o do pedido.
 */
export async function reimprimir(lojaId, pedidoId) {
  const pedido = await pedidoRepo.buscarStatus(pedidoId);
  if (!ehDaLoja(pedido, lojaId)) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
  const tipo = pedido.status === 'CANCELADO' ? 'CANCELAMENTO' : 'PEDIDO';
  const trabalho = await pedidoRepo.criarTrabalhoImpressao({ lojaId, pedidoId, tipo, status: 'PENDENTE' });
  emitirParaEquipe(lojaId, 'impressao:nova', trabalho);
  return trabalho;
}
