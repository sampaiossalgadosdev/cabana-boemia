import { prisma } from '../lib/prisma.js';

/** Conexão da loja (com os tokens cifrados: só para o service). */
export function buscarDaLoja(lojaId, db = prisma) {
  return db.conexaoMercadoPago.findUnique({ where: { lojaId } });
}

/** A conta Mercado Pago já está CONECTADA ou EXPIRADA em outra loja? */
export function contaEmOutraLoja(mpUserId, lojaId, db = prisma) {
  return db.conexaoMercadoPago.findFirst({
    where: { mpUserId, lojaId: { not: lojaId }, status: { in: ['CONECTADA', 'EXPIRADA'] } },
    select: { lojaId: true },
  });
}

/** Grava (ou regrava) a conexão da loja como CONECTADA. */
export function gravarConectada(lojaId, dados, db = prisma) {
  const campos = { ...dados, status: 'CONECTADA' };
  return db.conexaoMercadoPago.upsert({ where: { lojaId }, create: { lojaId, ...campos }, update: campos });
}

export function atualizar(lojaId, dados, db = prisma) {
  return db.conexaoMercadoPago.update({ where: { lojaId }, data: dados });
}

/** Conectadas que vencem antes de `limite` (renovação diária). */
export function vencendoAte(limite, db = prisma) {
  return db.conexaoMercadoPago.findMany({
    where: { status: 'CONECTADA', expiraEm: { lt: limite } },
    orderBy: { lojaId: 'asc' },
  });
}

/** Pagamentos online PENDENTES dos pedidos da loja (aviso antes de desconectar). */
export function contarPagamentosPendentes(lojaId, db = prisma) {
  return db.pagamento.count({ where: { status: 'PENDENTE', pedido: { lojaId } } });
}

export function definirPagamentoOnlineAtivo(lojaId, ativo, db = prisma) {
  return db.loja.update({ where: { id: lojaId }, data: { pagamentoOnlineAtivo: ativo }, select: { pagamentoOnlineAtivo: true } });
}

/** Conexão da conta Mercado Pago (pelo user_id das notificações), CONECTADA ou EXPIRADA. */
export function buscarPorMpUserId(mpUserId, db = prisma) {
  return db.conexaoMercadoPago.findFirst({ where: { mpUserId: String(mpUserId), status: { in: ['CONECTADA', 'EXPIRADA'] } } });
}
