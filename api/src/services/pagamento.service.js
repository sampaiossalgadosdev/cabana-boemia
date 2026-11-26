/**
 * Pagamento online do pedido do app (Etapa 4 de docs/pagamento-online.md): Pix no Mercado Pago
 * com o token DA LOJA, webhook, conciliação, expiração aos 15 minutos e o desligamento quando a
 * loja desconecta. Toda chamada ao Mercado Pago passa por lib/mercadoPago.js.
 *
 * - A fonte da verdade é a consulta do pagamento (`consultarPagamento`): o webhook e o app só
 *   avisam que algo pode ter mudado. Nada muda pelo corpo da notificação.
 * - Transições só para frente e condicionadas: o pedido sai de AGUARDANDO_PAGAMENTO uma vez
 *   (aprovado → CONFIRMADO, ou EXPIRADO), com a linha travada (FOR UPDATE).
 * - `aprovar` é uma só para webhook, consulta do app e rotina: número e dia operacional da
 *   aprovação, campanha usada, cupom e `pedido:novo`/`impressao:nova` como um pedido comum.
 * - Pago depois de expirar: o pedido não revive; pagamento A_ESTORNAR + alerta (estorno: Etapa 5).
 * - Divergência (valor, pedido, comissão ou loja): alerta para o ADMIN, nunca aprovação.
 *
 * Nunca registra token, QR nem dado do pagador em log (só ids, status e códigos).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { decifrar, chaveDoAmbiente } from '../lib/cifra.js';
import { criarClienteMercadoPago, validarAssinaturaWebhook } from '../lib/mercadoPago.js';
import { faltasParaConectar, segredoDoWebhook } from '../lib/pagamentoOnline.js';
import { diaOperacional, paraCampoData } from '../lib/fuso.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { formatarDinheiro } from '@restaurante/shared/cupom';
import { horaViradaDe } from './diaOperacional.service.js';
import { usarCampanha, liberarCampanha } from './campanha.service.js';
import { alertarUmaVez, criarAlerta } from './alerta.service.js';
import { estornarVendas, pedidoDaEquipe, pedidoPublico, OPCOES_TRANSACAO } from './pedido.service.js';
import * as pagamentoRepo from '../repositories/pagamento.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as conexaoRepo from '../repositories/conexaoMp.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';

/** O Mercado Pago exige no mínimo 30 minutos no date_of_expiration (Decisão 5). */
export const PRAZO_PIX_MERCADO_PAGO_MS = 30 * 60 * 1000;
/** A tela do Pix consulta a nossa API a cada 5 s; nós consultamos o Mercado Pago no máximo a cada 30 s. */
export const INTERVALO_CONSULTA_APP_MS = 30 * 1000;
/** A rotina roda a cada minuto e consulta cada pendente no máximo uma vez por minuto. */
export const INTERVALO_ROTINA_MS = 60 * 1000;
/** Mais de 3 falhas ao gerar Pix na mesma loja em 1 hora = alerta (Decisão 5 da Etapa 4). */
export const LIMITE_FALHAS_PIX = 3;
export const JANELA_FALHAS_PIX_MS = 60 * 60 * 1000;

const STATUS_MP_RECUSADO = { rejected: 'RECUSADO', cancelled: 'CANCELADO' };

/** Pagamento como o app vê (sem valores internos como a comissão). */
export function pagamentoParaCliente(p) {
  return {
    id: p.id,
    metodo: p.metodo,
    status: p.status,
    qrCode: p.status === 'PENDENTE' ? p.pixQrCode : null,
    qrCodeBase64: p.status === 'PENDENTE' ? p.pixQrCodeBase64 : null,
    expiraEm: p.expiraEm,
    valorCentavos: p.valorTotalCentavos,
  };
}

/** Resumo da resposta do Mercado Pago guardado no pagamento (sem dado pessoal nem QR). */
const resumoMp = (r) => ({
  id: r.id,
  status: r.status,
  statusDetail: r.statusDetail,
  valorCentavos: r.valorCentavos,
  comissaoCentavos: r.comissaoCentavos,
  aprovadoEm: r.aprovadoEm,
});

/**
 * Problemas do pagamento do Mercado Pago em relação ao nosso (lista vazia = confere). Pedido,
 * id e loja sempre; valor e comissão só na aprovação (é quando o dinheiro conta). A comissão só
 * é conferida quando o Mercado Pago a informa.
 */
export function divergencias(pagamento, r, lojaIdDaConta = null) {
  const problemas = [];
  if (r.referenciaExterna !== String(pagamento.pedidoId)) problemas.push(`pedido ${r.referenciaExterna ?? '-'} no Mercado Pago`);
  if (pagamento.mpPaymentId && pagamento.mpPaymentId !== r.id) problemas.push('id do pagamento diferente');
  if (lojaIdDaConta != null && pagamento.pedido?.lojaId !== lojaIdDaConta) problemas.push('conta Mercado Pago de outra loja');
  if (r.status !== 'approved') return problemas;
  if (r.valorCentavos !== pagamento.valorTotalCentavos) {
    problemas.push(`valor ${r.valorCentavos == null ? '-' : formatarDinheiro(r.valorCentavos)} (esperado ${formatarDinheiro(pagamento.valorTotalCentavos)})`);
  }
  if (r.comissaoCentavos != null && r.comissaoCentavos !== pagamento.valorPlataformaCentavos) {
    problemas.push(`comissão ${formatarDinheiro(r.comissaoCentavos)} (esperada ${formatarDinheiro(pagamento.valorPlataformaCentavos)})`);
  }
  return problemas;
}

/**
 * @param {{ mercadoPago?: ReturnType<typeof criarClienteMercadoPago>, env?: object, log?: Pick<Console, 'warn'>,
 *           estornarPagamentoAtrasado?: (pagamento: object) => Promise<void> }} [opcoes]
 *   `estornarPagamentoAtrasado`: ponto da Etapa 5 (estorno automático do pago depois de expirar).
 */
export function criarServicoPagamentos({ mercadoPago, env = process.env, log = console, estornarPagamentoAtrasado = async () => {} } = {}) {
  const mp = mercadoPago ?? criarClienteMercadoPago();
  const emAndamento = new Set();

  async function tokenDaLoja(lojaId) {
    const conexao = await conexaoRepo.buscarDaLoja(lojaId);
    if (!conexao?.accessTokenCifrado) return null;
    return decifrar(conexao.accessTokenCifrado, chaveDoAmbiente(env));
  }

  async function resposta(pedidoId) {
    const [pedido, pagamento] = await Promise.all([pedidoRepo.buscarPorId(pedidoId), pagamentoRepo.ultimoDoPedido(pedidoId)]);
    return { pedido: pedidoPublico(pedido), pagamento: pagamento ? pagamentoParaCliente(pagamento) : null };
  }

  /**
   * Encerra o pedido que esperava o pagamento: EXPIRADO, estoque devolvido, campanha liberada e
   * o pagamento pendente com `statusPagamento`. Condicionado: já encerrado = nada (false).
   */
  async function expirarPedido(pedidoId, { statusPagamento = 'EXPIRADO', dadosMp, agora = new Date() } = {}) {
    return prisma.$transaction(async (tx) => {
      const linha = await pagamentoRepo.travarPedido(pedidoId, tx);
      if (linha?.status !== 'AGUARDANDO_PAGAMENTO') return false;
      await tx.pedido.update({ where: { id: pedidoId }, data: { status: 'EXPIRADO' } });
      await estornarVendas(tx, await pedidoRepo.vendasDoPedido(pedidoId, tx));
      await liberarCampanha(tx, pedidoId);
      await tx.pagamento.updateMany({
        where: { pedidoId, status: 'PENDENTE' },
        data: { status: statusPagamento, ...(dadosMp && { dadosMp }), consultadoEm: agora },
      });
      return true;
    }, OPCOES_TRANSACAO);
  }

  /** Mais de 3 Pix que falharam na loja em 1 hora: alerta (um por hora). */
  async function conferirFalhasDaLoja(lojaId, agora) {
    const desde = new Date(agora.getTime() - JANELA_FALHAS_PIX_MS);
    const falhas = await pagamentoRepo.contarFalhasDeCriacao(lojaId, desde);
    if (falhas <= LIMITE_FALHAS_PIX) return;
    const loja = await lojaRepo.buscarPorId(lojaId);
    await alertarUmaVez({
      tipo: 'PIX_FALHANDO',
      lojaId,
      desde,
      mensagem:
        `O Mercado Pago recusou ${falhas} Pix da loja ${loja?.nome ?? lojaId} na última hora. Confira a conexão da loja ` +
        'em "Pagamento online" e a situação da conta no Mercado Pago.',
    });
  }

  /**
   * Cria (ou devolve o já criado) Pix do pedido AGUARDANDO_PAGAMENTO. Falhou no Mercado Pago:
   * pedido EXPIRADO (estoque e campanha de volta) e 502 PAGAMENTO_FALHOU (Decisão 5 da Etapa 4).
   * @param {number} pedidoId
   * @param {{ email: string, agora?: Date }} dados
   */
  async function gerarPix(pedidoId, { email, agora = new Date() }) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    // Chave reaproveitada de um pedido pago na entrega: devolve o pedido como está (sem Pix).
    if (!pagamento) return resposta(pedidoId);
    const { pedido } = pagamento;
    if (pedido.status !== 'AGUARDANDO_PAGAMENTO') {
      if (pedido.status === 'EXPIRADO') {
        throw new ErroHttp(409, 'Este Pix expirou. Faça o pedido de novo.', { codigo: 'PIX_EXPIRADO' });
      }
      return resposta(pedidoId); // já aprovado (reenvio depois da aprovação)
    }
    if (pagamento.mpPaymentId && pagamento.pixQrCode) return resposta(pedidoId); // reenvio da mesma chave

    const loja = await lojaRepo.buscarPorId(pedido.lojaId);
    let r;
    try {
      const token = await tokenDaLoja(pedido.lojaId);
      r = await mp.criarPix(token, {
        valorCentavos: pagamento.valorTotalCentavos,
        comissaoCentavos: pagamento.valorPlataformaCentavos,
        pedidoId,
        descricao: `Pedido ${loja?.nome ?? 'Taaki Delivery'}`,
        email,
        expiraEm: new Date(agora.getTime() + PRAZO_PIX_MERCADO_PAGO_MS),
        idempotencyKey: pagamento.idempotencyKey,
      });
    } catch (err) {
      // Qualquer falha aqui (Mercado Pago, rede, token ilegível) deixa o cliente sem Pix: encerra.
      log.warn(`[pagamento] pedido ${pedidoId}: Pix não criado (status ${err.status ?? '-'}, ${err.codigo ?? err.message})`);
      await expirarPedido(pedidoId, { statusPagamento: 'RECUSADO', dadosMp: { erro: err.codigo ?? 'FALHA', status: err.status ?? null }, agora });
      await conferirFalhasDaLoja(pedido.lojaId, agora).catch((e) => log.warn(`[pagamento] alerta de falhas: ${e.message}`));
      throw new ErroHttp(502, 'Não foi possível gerar o Pix agora. Tente de novo ou escolha outra forma de pagamento.', {
        codigo: 'PAGAMENTO_FALHOU',
      });
    }
    await pagamentoRepo.atualizar(pagamento.id, {
      mpPaymentId: r.id,
      pixQrCode: r.qrCode,
      pixQrCodeBase64: r.qrCodeBase64,
      dadosMp: resumoMp(r),
      consultadoEm: agora,
    });
    // Resposta incomum (já aprovado ou recusado na criação): concilia na hora.
    if (r.status !== 'pending') await conciliar(await pagamentoRepo.buscarPorId(pagamento.id), r, { agora });
    return resposta(pedidoId);
  }

  /**
   * Aprovação (a única): numa transação com o pedido travado, AGUARDANDO_PAGAMENTO → CONFIRMADO
   * com número e dia operacional da aprovação, forma PIX, campanha usada e cupom PEDIDO; depois do
   * commit, `pedido:novo` e `impressao:nova`. Pedido já EXPIRADO: não revive (A_ESTORNAR + alerta).
   */
  async function aprovar(pagamento, r, agora = new Date()) {
    const resultado = await prisma.$transaction(async (tx) => {
      const linha = await pagamentoRepo.travarPedido(pagamento.pedidoId, tx);
      if (linha?.status === 'AGUARDANDO_PAGAMENTO') {
        const loja = await lojaRepo.buscarPorId(linha.lojaId, tx);
        const dia = diaOperacional(agora, horaViradaDe(loja));
        const numeroDia = await pedidoRepo.proximoNumeroDoDia(linha.lojaId, dia, tx);
        await tx.pedido.update({
          where: { id: pagamento.pedidoId },
          data: { status: 'CONFIRMADO', numeroDia, dataRef: paraCampoData(dia), formaPagamento: 'PIX', trocoParaCentavos: null },
        });
        await usarCampanha(tx, pagamento.pedidoId, agora);
        await tx.pagamento.update({
          where: { id: pagamento.id },
          data: { status: 'APROVADO', aprovadoEm: agora, dadosMp: resumoMp(r), consultadoEm: agora, mpPaymentId: r.id },
        });
        const trabalho = await pedidoRepo.criarTrabalhoImpressao(
          { lojaId: linha.lojaId, pedidoId: pagamento.pedidoId, tipo: 'PEDIDO', status: 'PENDENTE' },
          tx,
        );
        return { situacao: 'APROVADO', lojaId: linha.lojaId, pedido: await pedidoRepo.buscarPorId(pagamento.pedidoId, tx), trabalho };
      }
      if (linha?.status === 'EXPIRADO') {
        const mudou = await pagamentoRepo.atualizarSeEm(
          pagamento.id,
          ['PENDENTE', 'EXPIRADO', 'CANCELADO', 'RECUSADO'],
          { status: 'A_ESTORNAR', aprovadoEm: agora, dadosMp: resumoMp(r), consultadoEm: agora, mpPaymentId: r.id },
          tx,
        );
        if (mudou) {
          await criarAlerta(
            {
              tipo: 'PAGO_APOS_EXPIRAR',
              lojaId: linha.lojaId,
              pedidoId: pagamento.pedidoId,
              mensagem:
                `O Pix de ${formatarDinheiro(pagamento.valorTotalCentavos)} do pedido ${pagamento.pedidoId} foi pago depois que o ` +
                'pedido expirou. O pedido não foi para a loja e o valor precisa voltar ao cliente (estorno).',
            },
            tx,
          );
        }
        return { situacao: mudou ? 'A_ESTORNAR' : 'JA_TRATADO' };
      }
      return { situacao: 'JA_TRATADO' };
    }, OPCOES_TRANSACAO);

    if (resultado.situacao === 'APROVADO') {
      emitirParaEquipe(resultado.lojaId, 'pedido:novo', pedidoDaEquipe(resultado.pedido));
      emitirParaEquipe(resultado.lojaId, 'impressao:nova', resultado.trabalho);
    }
    if (resultado.situacao === 'A_ESTORNAR') {
      await estornarPagamentoAtrasado(await pagamentoRepo.buscarPorId(pagamento.id)).catch((e) =>
        log.warn(`[pagamento] estorno do pedido ${pagamento.pedidoId}: ${e.message}`),
      );
    }
    return resultado.situacao;
  }

  /**
   * Concilia o nosso pagamento com a resposta do Mercado Pago (já consultada). Devolve o que
   * aconteceu (texto curto para o registro do webhook).
   */
  async function conciliar(pagamento, r, { agora = new Date(), lojaIdDaConta = null } = {}) {
    const problemas = divergencias(pagamento, r, lojaIdDaConta);
    if (problemas.length) {
      log.warn(`[pagamento] pedido ${pagamento.pedidoId}: divergência com o Mercado Pago (${problemas.length})`);
      await alertarUmaVez({
        tipo: 'PAGAMENTO_DIVERGENTE',
        lojaId: pagamento.pedido?.lojaId ?? null,
        pedidoId: pagamento.pedidoId,
        mensagem:
          `O pagamento ${r.id} do Mercado Pago (${r.status}) não confere com o pedido ${pagamento.pedidoId}: ` +
          `${problemas.join('; ')}. O pedido não foi aprovado; confira no Mercado Pago.`,
      });
      return 'DIVERGENTE';
    }
    if (r.status === 'approved') return aprovar(pagamento, r, agora);
    if (STATUS_MP_RECUSADO[r.status]) {
      const expirou = await expirarPedido(pagamento.pedidoId, { statusPagamento: STATUS_MP_RECUSADO[r.status], dadosMp: resumoMp(r), agora });
      return expirou ? 'EXPIRADO' : 'JA_TRATADO';
    }
    // pending / in_process / outros (estorno e contestação são da Etapa 5): só registra a consulta.
    await pagamentoRepo.atualizar(pagamento.id, { consultadoEm: agora, dadosMp: resumoMp(r) });
    return 'SEM_MUDANCA';
  }

  /** Consulta o Mercado Pago com o token da loja do pedido e concilia. */
  async function consultarEConciliar(pagamento, agora = new Date()) {
    if (!pagamento.mpPaymentId) return 'SEM_ID';
    const token = await tokenDaLoja(pagamento.pedido.lojaId);
    const r = await mp.consultarPagamento(token, pagamento.mpPaymentId);
    return conciliar(pagamento, r, { agora });
  }

  /**
   * Pendente que passou dos 15 minutos: consulta uma última vez (pago no último segundo vence),
   * cancela no Mercado Pago e expira o pedido. Falha no Mercado Pago não impede a expiração
   * (se ele aprovar depois, o webhook marca A_ESTORNAR).
   */
  async function expirarPendente(pagamento, agora = new Date(), statusPagamento = 'EXPIRADO') {
    if (pagamento.mpPaymentId) {
      try {
        const token = await tokenDaLoja(pagamento.pedido.lojaId);
        const r = await mp.consultarPagamento(token, pagamento.mpPaymentId);
        if (r.status === 'approved') return conciliar(pagamento, r, { agora });
        if (r.status === 'pending' || r.status === 'in_process') await mp.cancelarPagamento(token, pagamento.mpPaymentId);
      } catch (err) {
        log.warn(`[pagamento] pedido ${pagamento.pedidoId}: cancelamento no Mercado Pago falhou (${err.status ?? '-'}, ${err.codigo ?? err.message})`);
      }
    }
    return (await expirarPedido(pagamento.pedidoId, { statusPagamento, agora })) ? 'EXPIRADO' : 'JA_TRATADO';
  }

  /** Situação do Pix para a tela do app (só o dono do pedido; outro = 404). */
  async function situacaoParaCliente(clienteId, pedidoId, agora = new Date()) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    if (!pagamento || pagamento.pedido.clienteId !== clienteId) {
      throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
    }
    if (pagamento.status === 'PENDENTE') {
      try {
        if (pagamento.expiraEm <= agora) await expirarPendente(pagamento, agora);
        else if (!pagamento.consultadoEm || agora - pagamento.consultadoEm >= INTERVALO_CONSULTA_APP_MS) {
          await consultarEConciliar(pagamento, agora);
        }
      } catch (err) {
        log.warn(`[pagamento] consulta do pedido ${pedidoId} falhou (${err.status ?? '-'}, ${err.codigo ?? err.message})`);
      }
    }
    return resposta(pedidoId);
  }

  /** Rotina de 1 minuto: expira os vencidos e consulta os outros pendentes (webhook perdido). */
  async function rodarRotina(agora = new Date()) {
    const r = { expirados: 0, aprovados: 0, consultados: 0, falhas: 0 };
    for (const p of await pagamentoRepo.pendentes()) {
      try {
        if (p.expiraEm <= agora) {
          const s = await expirarPendente(p, agora);
          if (s === 'EXPIRADO') r.expirados += 1;
          if (s === 'APROVADO') r.aprovados += 1;
        } else if (p.mpPaymentId && (!p.consultadoEm || agora - p.consultadoEm >= INTERVALO_ROTINA_MS)) {
          r.consultados += 1;
          if ((await consultarEConciliar(p, agora)) === 'APROVADO') r.aprovados += 1;
        }
      } catch (err) {
        r.falhas += 1;
        log.warn(`[pagamento] rotina, pedido ${p.pedidoId}: ${err.status ?? '-'} ${err.codigo ?? err.message}`);
      }
    }
    return r;
  }

  /**
   * Desconectar a loja (Decisão 17): cancela no Mercado Pago os Pix pendentes (antes de apagar os
   * tokens) e expira os pedidos aguardando pagamento. Devolve quantos encerrou.
   */
  async function cancelarPendentesDaLoja(lojaId, agora = new Date()) {
    let cancelados = 0;
    for (const p of await pagamentoRepo.pendentes({ lojaId })) {
      if (p.mpPaymentId) {
        try {
          await mp.cancelarPagamento(await tokenDaLoja(lojaId), p.mpPaymentId);
        } catch (err) {
          log.warn(`[pagamento] desconectar, pedido ${p.pedidoId}: cancelamento falhou (${err.status ?? '-'}, ${err.codigo ?? err.message})`);
        }
      }
      if (await expirarPedido(p.pedidoId, { statusPagamento: 'CANCELADO', agora })) cancelados += 1;
    }
    return cancelados;
  }

  /** mp-connect: a loja desvinculou a conta no Mercado Pago. */
  async function desvincularConta(mpUserId, agora = new Date()) {
    const conexao = await conexaoRepo.buscarPorMpUserId(mpUserId);
    if (!conexao) return 'CONTA_DESCONHECIDA';
    await cancelarPendentesDaLoja(conexao.lojaId, agora);
    const loja = await lojaRepo.buscarPorId(conexao.lojaId);
    await prisma.$transaction(async (tx) => {
      await conexaoRepo.atualizar(
        conexao.lojaId,
        { status: 'DESCONECTADA', accessTokenCifrado: null, refreshTokenCifrado: null, publicKey: null, expiraEm: null },
        tx,
      );
      await conexaoRepo.definirPagamentoOnlineAtivo(conexao.lojaId, false, tx);
      await criarAlerta(
        {
          tipo: 'MP_DESVINCULADA',
          lojaId: conexao.lojaId,
          mensagem:
            `A loja ${loja?.nome ?? conexao.lojaId} desvinculou a conta do Mercado Pago. O pagamento online da loja foi ` +
            'desligado; para voltar, o dono conecta de novo em "Pagamento online".',
        },
        tx,
      );
    });
    return 'DESCONECTADA';
  }

  async function processarNotificacao({ tipo, acao, dataId, userId }, agora) {
    if (tipo === 'mp-connect') {
      return /deauthoriz/i.test(acao ?? '') ? desvincularConta(userId, agora) : 'IGNORADO';
    }
    if (tipo !== 'payment' || !dataId) return 'IGNORADO';
    const conexao = userId != null ? await conexaoRepo.buscarPorMpUserId(userId) : null;
    if (!conexao?.accessTokenCifrado) return 'LOJA_DESCONHECIDA';
    const r = await mp.consultarPagamento(decifrar(conexao.accessTokenCifrado, chaveDoAmbiente(env)), dataId);
    let pagamento = await pagamentoRepo.buscarPorMpPaymentId(r.id);
    if (!pagamento && /^\d+$/.test(r.referenciaExterna ?? '')) pagamento = await pagamentoRepo.ultimoDoPedido(Number(r.referenciaExterna));
    if (!pagamento) return 'PAGAMENTO_DESCONHECIDO';
    return conciliar(pagamento, r, { agora, lojaIdDaConta: conexao.lojaId });
  }

  /**
   * Notificação do Mercado Pago. Assinatura inválida = 401. Repetida (mesmo id de notificação)
   * = nada. Senão grava o evento e processa sem a requisição esperar (o Mercado Pago quer 200 rápido).
   * @returns {Promise<{ duplicado: boolean, processamento?: Promise<string> }>}
   */
  async function receberWebhook({ assinatura, requestId, dataIdQuery, corpo }, agora = new Date()) {
    const dataId = dataIdQuery ?? corpo?.data?.id ?? null;
    if (!validarAssinaturaWebhook({ assinatura, requestId, dataId, segredo: segredoDoWebhook(env) })) {
      throw new ErroHttp(401, 'Assinatura inválida', { codigo: 'ASSINATURA_INVALIDA' });
    }
    const tipo = String(corpo?.type ?? corpo?.topic ?? 'desconhecido').slice(0, 60);
    const notificacao = { tipo, acao: corpo?.action ?? null, dataId: dataId != null ? String(dataId) : null, userId: corpo?.user_id ?? null };
    const chave = `${tipo}:${corpo?.id ?? requestId ?? dataId}:${notificacao.acao ?? ''}`.slice(0, 200);
    let evento;
    try {
      evento = await prisma.eventoWebhook.create({ data: { chave, tipo, recursoId: notificacao.dataId?.slice(0, 60) ?? null, recebidoEm: agora } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { duplicado: true };
      throw err;
    }
    const processamento = processarNotificacao(notificacao, agora)
      .then(
        async (resultado) => {
          await prisma.eventoWebhook
            .update({ where: { id: evento.id }, data: { processadoEm: new Date(), resultado: String(resultado).slice(0, 200) } })
            .catch(() => {});
          return resultado;
        },
        async (err) => {
          // Falhou (ex.: Mercado Pago fora do ar): apaga o evento para o reenvio do Mercado
          // Pago ser processado (a rotina de 1 minuto também consulta os Pix pendentes).
          log.warn(`[pagamento] webhook ${evento.id} (${tipo}): ${err.status ?? '-'} ${err.codigo ?? err.message}`);
          await prisma.eventoWebhook.delete({ where: { id: evento.id } }).catch(() => {});
          return `ERRO ${err.codigo ?? 'INTERNO'}`;
        },
      )
      .finally(() => emAndamento.delete(processamento));
    emAndamento.add(processamento);
    return { duplicado: false, processamento };
  }

  /** Testes: espera os webhooks em processamento. */
  async function aguardarProcessamentos() {
    await Promise.all([...emAndamento]);
  }

  /** Roda a cada minuto (timer `unref`). Sem o Mercado Pago configurado, não roda. Devolve o "parar". */
  function iniciarRotina() {
    if (faltasParaConectar(env).length) return () => {};
    let rodando = false;
    const rodar = async () => {
      if (rodando) return;
      rodando = true;
      try {
        const r = await rodarRotina();
        if (r.expirados + r.aprovados + r.falhas) {
          log.warn(`[pagamento] rotina: ${r.aprovados} aprovado(s), ${r.expirados} expirado(s), ${r.falhas} falha(s)`);
        }
      } catch (err) {
        log.warn(`[pagamento] rotina falhou: ${err?.message ?? err}`);
      } finally {
        rodando = false;
      }
    };
    const timer = setInterval(rodar, INTERVALO_ROTINA_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return {
    gerarPix,
    aprovar,
    conciliar,
    expirarPedido,
    situacaoParaCliente,
    rodarRotina,
    cancelarPendentesDaLoja,
    desvincularConta,
    receberWebhook,
    aguardarProcessamentos,
    iniciarRotina,
  };
}

let padrao;
/** Serviço com o Mercado Pago de verdade (o mesmo para as rotas e o server.js). */
export function pagamentosPadrao() {
  padrao ??= criarServicoPagamentos();
  return padrao;
}
