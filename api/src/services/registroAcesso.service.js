import { prisma } from '../lib/prisma.js';

/**
 * Registros de acesso do cliente (Marco Civil da Internet, art. 15): IP e
 * data/hora de login, refresh, envio de pedido e exclusão de conta. Guardados
 * por 6 meses; a rotina diária (`iniciarLimpezaDiaria`, ligada no server.js)
 * apaga os mais antigos. Sobrevivem à exclusão da conta (obrigação legal).
 */
export const EVENTOS = ['LOGIN', 'REFRESH', 'PEDIDO', 'EXCLUSAO_CONTA'];
export const RETENCAO_MESES = 6;
export const INTERVALO_LIMPEZA_MS = 24 * 60 * 60 * 1000;

/**
 * Instante de corte: registros criados ANTES dele já têm mais de 6 meses.
 * Meses de calendário (UTC) com o dia limitado ao fim do mês: 31/08 → 28/02
 * (nunca 03/03, que apagaria registro com menos de 6 meses).
 */
export function limiteRetencao(agora = new Date(), meses = RETENCAO_MESES) {
  const a = new Date(agora);
  const ano = a.getUTCFullYear();
  const mes = a.getUTCMonth() - meses;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(ano, mes, Math.min(a.getUTCDate(), ultimoDia), a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds(), a.getUTCMilliseconds()),
  );
}

/** "::ffff:203.0.113.5" → "203.0.113.5"; vazio → "desconhecido"; no máximo 45 caracteres (IPv6). */
export function normalizarIp(ip) {
  const s = String(ip ?? '').trim().replace(/^::ffff:/i, '');
  return (s || 'desconhecido').slice(0, 45);
}

/**
 * Grava um registro. Nunca derruba a requisição: falha vira aviso no log (o
 * pedido do cliente não pode falhar por causa do registro).
 * @param {{ clienteId?: number | null, ip?: string, evento: 'LOGIN' | 'REFRESH' | 'PEDIDO' | 'EXCLUSAO_CONTA' }} dados
 * @returns {Promise<boolean>} se gravou
 */
export async function registrarAcesso({ clienteId = null, ip, evento }, db = prisma) {
  try {
    await db.registroAcesso.create({ data: { clienteId: clienteId ?? null, ip: normalizarIp(ip), evento } });
    return true;
  } catch (erro) {
    console.warn(`Registro de acesso não gravado (${evento}): ${erro.message}`);
    return false;
  }
}

/** Apaga os registros com mais de 6 meses. @returns {Promise<number>} quantos */
export async function apagarAntigos(agora = new Date(), db = prisma) {
  const r = await db.registroAcesso.deleteMany({ where: { criadoEm: { lt: limiteRetencao(agora) } } });
  return r.count;
}

/**
 * Roda a limpeza ao iniciar e depois a cada 24 h (timer `unref`: não segura o
 * processo). Com uma instância só da API no Railway, basta. Devolve a função
 * que para a rotina.
 */
export function iniciarLimpezaDiaria({ intervaloMs = INTERVALO_LIMPEZA_MS, agora = () => new Date(), db = prisma } = {}) {
  const rodar = () =>
    apagarAntigos(agora(), db)
      .then((n) => n > 0 && console.log(`Registros de acesso: ${n} com mais de ${RETENCAO_MESES} meses apagados.`))
      .catch((erro) => console.warn(`Limpeza dos registros de acesso falhou: ${erro.message}`));
  rodar();
  const timer = setInterval(rodar, intervaloMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
