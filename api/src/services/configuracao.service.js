/**
 * Configurações gerais da loja (retaguarda): nome do restaurante, WhatsApp, tempo
 * estimado padrão, virada do dia e frete grátis. Moram na tabela Loja (antes,
 * na linha única Configuracao); as chaves da resposta continuam as mesmas.
 * O tempo manual do dia continua no PDV (/equipe/config).
 */
import { dddValido } from '@restaurante/shared/telefone';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import * as lojaService from './loja.service.js';

const publica = (c) => ({
  nomeRestaurante: c.nome,
  whatsappNumero: c.whatsapp,
  tempoEstimadoPadraoMin: c.tempoEstimadoPadraoMin,
  horaViradaDia: c.horaViradaDia,
  freteGratisAtivo: c.freteGratisAtivo ?? false,
  freteGratisMinimoCentavos: c.freteGratisMinimoCentavos ?? null,
  freteGratisWhatsapp: c.freteGratisWhatsapp ?? true,
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

export async function obter(lojaId) {
  return publica(await lojaService.buscar(lojaId));
}

/**
 * @param {{ nomeRestaurante: string, whatsappNumero: string, tempoEstimadoPadraoMin: number, horaViradaDia: number,
 *   freteGratisAtivo: boolean, freteGratisMinimoCentavos: number | null, freteGratisWhatsapp?: boolean }} dados (já validados; ligado exige mínimo)
 */
export async function atualizar(lojaId, dados) {
  await lojaService.buscar(lojaId);
  const config = await lojaRepo.atualizarGerais(lojaId, dados);
  avisarCardapioAtualizado(lojaId, 'config');
  return publica(config);
}
