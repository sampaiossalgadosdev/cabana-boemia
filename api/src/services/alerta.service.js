/**
 * Alertas para o ADMIN (tela "Alertas" da plataforma; Decisão 12 da Etapa 3). Genéricos:
 * cada etapa acrescenta tipos ao enum TipoAlerta. Nunca levam token nem dado pessoal além
 * do necessário para o ADMIN agir (loja, pedido, mensagem).
 */
import { ErroHttp } from '../lib/erros.js';
import * as alertaRepo from '../repositories/alerta.repository.js';

const publico = (a) => ({
  id: a.id,
  tipo: a.tipo,
  mensagem: a.mensagem,
  criadoEm: a.criadoEm,
  resolvidoEm: a.resolvidoEm,
  resolvidoPor: a.resolvidoPor?.nome ?? null,
  loja: a.loja,
  pedidoId: a.pedidoId,
});

/** @param {{ tipo: string, lojaId?: number | null, pedidoId?: number | null, mensagem: string }} dados */
export function criarAlerta({ tipo, lojaId = null, pedidoId = null, mensagem }, db) {
  return alertaRepo.criar({ tipo, lojaId, pedidoId, mensagem: mensagem.slice(0, 500) }, db);
}

/** Abertos (mais novos primeiro) e os últimos 50 resolvidos. */
export async function listar() {
  const [abertos, resolvidos] = await Promise.all([alertaRepo.listarAbertos(), alertaRepo.listarResolvidos(50)]);
  return { abertos: abertos.map(publico), resolvidos: resolvidos.map(publico) };
}

export const contarAbertos = () => alertaRepo.contarAbertos();

/** Marca como resolvido (já resolvido ou inexistente = 404). */
export async function resolver(id, usuarioId, agora = new Date()) {
  if ((await alertaRepo.resolverSeAberto(id, usuarioId, agora)) === 0) {
    throw new ErroHttp(404, 'Alerta não encontrado ou já resolvido', { codigo: 'NAO_ENCONTRADO' });
  }
}
