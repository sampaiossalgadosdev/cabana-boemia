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
import { ErroHttp } from '../lib/erros.js';
import { formatarDinheiro } from '@restaurante/shared/cupom';
import { minimoFreteGratisPlataforma } from '../lib/pagamentoOnline.js';

const publica = (c) => ({
  nomeRestaurante: c.nome,
  whatsappNumero: c.whatsapp,
  tempoEstimadoPadraoMin: c.tempoEstimadoPadraoMin,
  horaViradaDia: c.horaViradaDia,
  freteGratisAtivo: c.freteGratisAtivo ?? false,
  freteGratisMinimoCentavos: c.freteGratisMinimoCentavos ?? null,
  freteGratisWhatsapp: c.freteGratisWhatsapp ?? true,
  // Entregador da plataforma: o frete grátis da loja é custo da loja (ela paga a taxa
  // cheia) e o pedido mínimo tem um piso global. null = motoboy próprio (sem piso).
  modoEntrega: c.modoEntrega ?? 'PROPRIO',
  freteGratisMinimoPlataformaCentavos: c.modoEntrega === 'PLATAFORMA' ? minimoFreteGratisPlataforma() : null,
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
 * Loja com entregador da plataforma: a taxa de entrega é da plataforma e, no frete grátis
 * da loja, sai da parte da loja. Pedido mínimo pequeno faria a taxa engolir o pedido
 * (docs/pagamento-online.md, Decisões da Etapa 2, item 5): o mínimo ligado não pode
 * ficar abaixo do piso global. 400 VALIDACAO no campo do mínimo.
 */
export function conferirMinimoDoFreteGratis(loja, dados, env = process.env) {
  if (loja?.modoEntrega !== 'PLATAFORMA') return;
  const ativo = dados.freteGratisAtivo ?? loja.freteGratisAtivo;
  const minimo = dados.freteGratisMinimoCentavos === undefined ? loja.freteGratisMinimoCentavos : dados.freteGratisMinimoCentavos;
  const piso = minimoFreteGratisPlataforma(env);
  if (!ativo || minimo == null || minimo >= piso) return;
  const mensagem =
    `Nesta loja a entrega é feita pelos entregadores do Taaki e, no frete grátis, a loja paga a taxa de entrega. ` +
    `Para a taxa não ficar maior que o pedido, o frete grátis precisa começar em pelo menos ${formatarDinheiro(piso)}.`;
  throw new ErroHttp(400, mensagem, {
    codigo: 'VALIDACAO',
    detalhes: [{ campo: 'freteGratisMinimoCentavos', mensagem }],
  });
}

/**
 * @param {{ nomeRestaurante: string, whatsappNumero: string, tempoEstimadoPadraoMin: number, horaViradaDia: number,
 *   freteGratisAtivo: boolean, freteGratisMinimoCentavos: number | null, freteGratisWhatsapp?: boolean }} dados (já validados; ligado exige mínimo)
 */
export async function atualizar(lojaId, dados) {
  const loja = await lojaService.buscar(lojaId);
  conferirMinimoDoFreteGratis(loja, dados);
  const config = await lojaRepo.atualizarGerais(lojaId, dados);
  avisarCardapioAtualizado(lojaId, 'config');
  return publica(config);
}
