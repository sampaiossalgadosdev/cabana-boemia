/**
 * Fila de impressão do agente do PDV (balcão). O agente busca os pendentes,
 * imprime em ordem de id e só confirma depois que a impressora aceitou.
 * Confirmar é idempotente (UPDATE condicionado): o mesmo id duas vezes não
 * muda nada. Falha só incrementa `tentativas`; o trabalho continua PENDENTE
 * e volta na próxima busca (nada se perde).
 */
import { ErroHttp } from '../lib/erros.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { localParaUtc, partesLocais } from '../lib/fuso.js';
import * as impressaoRepo from '../repositories/impressao.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as configRepo from '../repositories/configuracao.repository.js';
import { pedidoPublico } from './pedido.service.js';
import { resumoParaCupom } from './caixa.service.js';

/** Quantos trabalhos por busca (o agente busca de novo enquanto vier cheio). */
export const LIMITE_PENDENTES = 50;
/** Além do dia local, pega as últimas horas (pedido de 23h50 impresso depois da meia-noite). */
const HORAS_ANTES_DO_DIA = 2;
const MAX_ERRO = 500;

/**
 * A partir de quando um pendente ainda vale: início do dia local ou
 * `HORAS_ANTES_DO_DIA` atrás, o que vier antes. Evita que um PDV ligado pela
 * primeira vez (ou depois de dias sem impressora) despeje cupons antigos.
 */
export function inicioDaJanela(agora) {
  const p = partesLocais(agora);
  const inicioDoDia = localParaUtc(p.ano, p.mes, p.dia, 0);
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
  ...(t.pedido ? { pedido: pedidoPublico(t.pedido) } : {}),
});

/** FECHAMENTO não tem pedido: leva o resumo do caixa (sem esperado nem diferença). */
async function comResumoDoCaixa(t) {
  const publico = trabalhoPublico(t);
  if (t.caixaId) publico.caixa = await resumoParaCupom(t.caixaId);
  return publico;
}

/** @returns {{ restaurante: { nome: string }, limite: number, trabalhos: object[] }} */
export async function listarPendentes(agora = new Date()) {
  const [config, trabalhos] = await Promise.all([
    configRepo.buscar(),
    impressaoRepo.listarPendentes({ desde: inicioDaJanela(agora), limite: LIMITE_PENDENTES }),
  ]);
  return {
    restaurante: { nome: config?.nomeRestaurante ?? 'Cabana Boemia' },
    limite: LIMITE_PENDENTES,
    trabalhos: await Promise.all(trabalhos.map(comResumoDoCaixa)),
  };
}

/**
 * Idempotente: a primeira chamada marca IMPRESSO; as seguintes devolvem o
 * mesmo trabalho com `jaConfirmado: true` (200, sem mudar `impressoEm`).
 */
export async function confirmar(id, agora = new Date()) {
  const mudou = await impressaoRepo.confirmarSeNaoImpresso(id, agora);
  const trabalho = await impressaoRepo.buscar(id);
  if (!trabalho) throw new ErroHttp(404, 'Trabalho de impressão não encontrado', { codigo: 'NAO_ENCONTRADO' });
  return { trabalho: trabalhoPublico(trabalho), jaConfirmado: mudou === 0 };
}

/** Incrementa `tentativas` e guarda o erro. Já impresso = 409 (não volta a pendente). */
export async function registrarFalha(id, erro) {
  const mensagem = String(erro ?? '').trim().slice(0, MAX_ERRO) || 'Falha na impressão';
  const mudou = await impressaoRepo.registrarFalhaSePendente(id, mensagem);
  const trabalho = await impressaoRepo.buscar(id);
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
export async function reimprimir(pedidoId) {
  const pedido = await pedidoRepo.buscarStatus(pedidoId);
  if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
  const tipo = pedido.status === 'CANCELADO' ? 'CANCELAMENTO' : 'PEDIDO';
  const trabalho = await pedidoRepo.criarTrabalhoImpressao({ pedidoId, tipo, status: 'PENDENTE' });
  emitirParaEquipe('impressao:nova', trabalho);
  return trabalho;
}
