/** Tela "Turnos e horários": regras puras (testadas). */
import { acharSobreposicao, mensagemSobreposicao } from '@restaurante/shared/horarios';
import { DIAS_SEMANA, horariosParaApi } from './formatar.js';

/** Colunas da tabela em ordem alfabética: Almoço antes de Lanches. */
export const ordenarTurnos = (turnos) => [...turnos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

const mesmaLista = (a, b) =>
  a.length === b.length && a.every((x, i) => x.diaSemana === b[i].diaSemana && x.inicio === b[i].inicio && x.fim === b[i].fim);

/**
 * Confere as linhas editadas de todos os turnos antes de gravar.
 * Mesma regra da API: o turno gravado não pode cruzar a si mesmo nem os
 * outros turnos ATIVOS (com os horários que estão na tela).
 * @param {{ id: number, nome: string, ativo: boolean, horarios: object[] }[]} turnos (do servidor)
 * @param {Record<number, { diaSemana: number, inicio: string, fim: string }[]>} linhas por turnoId
 * @returns {{ erro: string } | { gravar: { turno: object, horarios: object[] }[] }}
 */
export function prepararGravacao(turnos, linhas) {
  const novos = new Map();
  for (const t of turnos) {
    const { horarios, erro } = horariosParaApi(linhas[t.id] ?? []);
    if (erro) return { erro: `${t.nome}, ${erro.charAt(0).toLowerCase()}${erro.slice(1)}` };
    novos.set(t.id, horarios);
  }
  const doTurno = (t) => novos.get(t.id).map((horario) => ({ turno: t, horario }));

  const gravar = [];
  for (const t of turnos) {
    const antes = horariosParaApi(t.horarios).horarios;
    if (mesmaLista(antes, novos.get(t.id))) continue;
    const conflito = acharSobreposicao([...doTurno(t), ...turnos.filter((o) => o.id !== t.id && o.ativo).flatMap(doTurno)]);
    if (conflito) return { erro: mensagemSobreposicao(conflito) };
    gravar.push({ turno: t, horarios: novos.get(t.id) });
  }
  return { gravar };
}

/**
 * Grava turno a turno. A API confere contra o que está no banco, então numa
 * troca (Almoço vai para onde estava Lanches) a ordem importa: quem leva
 * HORARIO_SOBREPOSTO fica para depois dos outros. Para quando ninguém avança.
 * @param {{ turno: { id: number }, horarios: object[] }[]} lista
 * @param {(turnoId: number, horarios: object[]) => Promise<unknown>} definir
 * @returns {Promise<{ gravados: number[], erro: Error | null }>}
 */
export async function gravarEmOrdem(lista, definir) {
  let pendentes = lista;
  const gravados = [];
  while (pendentes.length) {
    const restantes = [];
    let ultimoErro = null;
    for (const item of pendentes) {
      try {
        await definir(item.turno.id, item.horarios);
        gravados.push(item.turno.id);
      } catch (err) {
        if (err?.codigo !== 'HORARIO_SOBREPOSTO') return { gravados, erro: err };
        restantes.push(item);
        ultimoErro = err;
      }
    }
    if (restantes.length === pendentes.length) return { gravados, erro: ultimoErro };
    pendentes = restantes;
  }
  return { gravados, erro: null };
}

