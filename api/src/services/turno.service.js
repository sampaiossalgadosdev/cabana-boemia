/**
 * Turno ativo e próxima abertura, sempre no horário local (America/Sao_Paulo).
 *
 * Cada HorarioTurno vira o intervalo [inicio, fim) em minutos do dia local.
 * Se fim <= inicio, o horário cruza a meia-noite e o fim ganha +1440
 * ("00:00" = 1440 = meia-noite, fim do dia). Um turno está ativo se:
 *   - o horário de HOJE cobre `min`, ou
 *   - o horário de ONTEM cobre `min + 1440` (parte que passou da meia-noite).
 * Ex.: sábado 19:00–00:00 = [1140, 1440). Domingo 00:00 → 0 + 1440 = 1440,
 * que não é < 1440 → fechado.
 */
import { partesLocais, localParaUtc } from '../lib/fuso.js';
import * as turnoRepo from '../repositories/turno.repository.js';

const DIA = 1440;

function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Intervalo [ini, fim) em minutos, a partir da meia-noite do dia do horário. */
function intervalo(h) {
  const ini = paraMinutos(h.inicio);
  let fim = paraMinutos(h.fim);
  if (fim <= ini) fim += DIA;
  return { ini, fim };
}

/**
 * Função pura: qual turno está ativo em `agora`.
 * @param {{ id: number, nome: string, horarios: { diaSemana: number, inicio: string, fim: string }[] }[]} turnos
 * @param {Date} agora
 * @returns {{ id: number, nome: string } | null}
 */
export function calcularTurnoAtivo(turnos, agora) {
  const { diaSemana, minutos } = partesLocais(agora);
  const ontem = (diaSemana + 6) % 7;

  for (const t of turnos) {
    for (const h of t.horarios) {
      const { ini, fim } = intervalo(h);
      const cobreHoje = h.diaSemana === diaSemana && ini <= minutos && minutos < fim;
      const cobreDeOntem = h.diaSemana === ontem && ini <= minutos + DIA && minutos + DIA < fim;
      if (cobreHoje || cobreDeOntem) return { id: t.id, nome: t.nome };
    }
  }
  return null;
}

/**
 * Função pura: primeira abertura de turno estritamente depois de `agora`
 * (olha até 7 dias à frente).
 * @returns {{ turno: { id: number, nome: string }, em: Date, diaSemana: number, inicio: string } | null}
 */
export function calcularProximaAbertura(turnos, agora) {
  const local = partesLocais(agora);
  let melhor = null;

  for (let desloc = 0; desloc <= 7; desloc++) {
    const dia = (local.diaSemana + desloc) % 7;
    for (const t of turnos) {
      for (const h of t.horarios) {
        if (h.diaSemana !== dia) continue;
        const absoluto = desloc * DIA + paraMinutos(h.inicio);
        if (absoluto <= local.minutos) continue;
        if (!melhor || absoluto < melhor.absoluto) melhor = { absoluto, t, h, desloc };
      }
    }
    if (melhor) break; // dias em ordem: o primeiro dia com abertura já tem a menor
  }
  if (!melhor) return null;

  const { t, h, desloc } = melhor;
  return {
    turno: { id: t.id, nome: t.nome },
    em: localParaUtc(local.ano, local.mes, local.dia + desloc, paraMinutos(h.inicio)),
    diaSemana: h.diaSemana,
    inicio: h.inicio,
  };
}

/** Turno ativo agora, lendo os turnos ativos do banco. */
export async function turnoAtivo(agora = new Date(), db) {
  return calcularTurnoAtivo(await turnoRepo.listarAtivosComHorarios(db), agora);
}

/** Próxima abertura depois de `agora`, lendo os turnos ativos do banco. */
export async function proximaAbertura(agora = new Date(), db) {
  return calcularProximaAbertura(await turnoRepo.listarAtivosComHorarios(db), agora);
}
