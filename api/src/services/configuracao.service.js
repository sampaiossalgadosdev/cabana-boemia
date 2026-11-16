/**
 * Configurações gerais (retaguarda): nome do restaurante, WhatsApp e tempo
 * estimado padrão. O tempo manual do dia continua no PDV (/equipe/config).
 */
import { dddValido } from '@restaurante/shared/telefone';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as configRepo from '../repositories/configuracao.repository.js';

const PADRAO = { nomeRestaurante: 'Cabana Boemia', whatsappNumero: '', tempoEstimadoPadraoMin: 40, horaViradaDia: 4 };

const publica = (c) => ({
  nomeRestaurante: c.nomeRestaurante,
  whatsappNumero: c.whatsappNumero,
  tempoEstimadoPadraoMin: c.tempoEstimadoPadraoMin,
  horaViradaDia: c.horaViradaDia,
});

/**
 * Função pura: número do WhatsApp para o link wa.me (só dígitos, com o 55 do
 * Brasil). Aceita formatação. DDD + número (10 ou 11 dígitos) ganha o 55;
 * 12 ou 13 dígitos precisam começar com 55. DDD fora da lista da Anatel ou
 * outro tamanho = null. Aceita fixo (8 dígitos) além de celular.
 */
export function normalizarWhatsapp(valor) {
  let d = String(valor ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1); // "0 43 ..." (DDD com zero de operadora)
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d) || !dddValido(d.slice(2, 4))) return null; // 55 + DDD + 8 ou 9 dígitos
  return d;
}

export async function obter() {
  return publica((await configRepo.buscar()) ?? PADRAO);
}

/** @param {{ nomeRestaurante: string, whatsappNumero: string, tempoEstimadoPadraoMin: number, horaViradaDia: number }} dados (já validados) */
export async function atualizar(dados) {
  const config = await configRepo.atualizarGerais(dados);
  avisarCardapioAtualizado('config');
  return publica(config);
}
