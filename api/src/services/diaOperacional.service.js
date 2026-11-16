/**
 * Dia operacional (CLAUDE.md › Dia operacional): o "dia" do restaurante vira
 * às Configuracao.horaViradaDia (padrão 4h) local, não à meia-noite. Vale para
 * dataRef/numeroDia, relatório, caixas do dia, tempo manual e fila de impressão.
 */
import { ErroHttp } from '../lib/erros.js';
import { HORA_VIRADA_PADRAO, diaOperacional, intervaloDoDia } from '../lib/fuso.js';
import * as configRepo from '../repositories/configuracao.repository.js';

/** Hora da virada gravada (ou o padrão, se a linha de configuração não existir). */
export const horaViradaDe = (config) => config?.horaViradaDia ?? HORA_VIRADA_PADRAO;

export async function horaVirada(db) {
  return horaViradaDe(await configRepo.buscar(db));
}

/**
 * "hoje" | "YYYY-MM-DD" → dia operacional e intervalo UTC. Data inexistente
 * (31/02) ou no futuro = 400 VALIDACAO.
 */
export async function resolverDia(data, agora = new Date(), db) {
  const virada = await horaVirada(db);
  const hoje = diaOperacional(agora, virada);
  const dia = data === 'hoje' ? hoje : data;
  const [a, m, d] = dia.split('-').map(Number);
  const real = new Date(Date.UTC(a, m - 1, d));
  if (real.getUTCFullYear() !== a || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    throw new ErroHttp(400, 'Data inválida', { codigo: 'VALIDACAO', detalhes: [{ campo: 'data', mensagem: 'Data inválida' }] });
  }
  if (dia > hoje) {
    throw new ErroHttp(400, 'Data no futuro', { codigo: 'VALIDACAO', detalhes: [{ campo: 'data', mensagem: 'Escolha hoje ou um dia passado' }] });
  }
  return { dia, hoje, horaVirada: virada, ...intervaloDoDia(dia, virada) };
}
