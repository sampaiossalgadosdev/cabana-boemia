/**
 * Pagamento online do pedido do app (Etapas 4 a 7 de docs/pagamento-online.md): Pix e cartão
 * (Checkout Pro) no Mercado Pago com o token DA LOJA, webhook, conciliação, expiração aos 15
 * minutos, estorno e o desligamento quando a loja desconecta. Toda chamada ao Mercado Pago passa
 * por lib/mercadoPago.js.
 *
 * Cartão (Etapa 7): a preferência é criada depois do commit (como o Pix) e o cliente paga no
 * navegador do app. O id do pagamento só existe quando o cliente paga: até a aprovação, a
 * consulta e a rotina acham o pagamento pela busca por `external_reference`. Tentativa recusada
 * NÃO encerra o pedido (Decisão 3 da Etapa 7): fica registrada e o cliente tenta de novo até os
 * 15 minutos, ou desiste (`desistirDoPagamento`) para escolher outra forma.
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
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { decifrar, chaveDoAmbiente } from '../lib/cifra.js';
import {
  criarClienteMercadoPago,
  diferencaDoTsEmSegundos,
  erroNoEmailDoPagador,
  ErroMercadoPago,
  TOLERANCIA_TS_WEBHOOK_MS,
  validarAssinaturaWebhook,
} from '../lib/mercadoPago.js';
import { faltasParaConectar, segredoDoWebhook } from '../lib/pagamentoOnline.js';
import { mensagemDaRecusa, tipoDoPagamento } from '../lib/cartaoOnline.js';
import { diaOperacional, paraCampoData } from '../lib/fuso.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { formatarDinheiro } from '@restaurante/shared/cupom';
import { horaViradaDe } from './diaOperacional.service.js';
import { usarCampanha, liberarCampanha } from './campanha.service.js';
import { lancarComplemento } from './livroRazao.service.js';
import { alertarUmaVez, criarAlerta } from './alerta.service.js';
import {
  avisarCancelamento,
  cancelarNaTransacao,
  cancelarPedido,
  ehDaLoja,
  estornarVendas,
  pedidoDaEquipe,
  pedidoPublico,
  OPCOES_TRANSACAO,
  PRAZO_PIX_MS,
  STATUS_ABERTOS,
  STATUS_FORA_DO_PDV,
} from './pedido.service.js';
import * as pagamentoRepo from '../repositories/pagamento.repository.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as conexaoRepo from '../repositories/conexaoMp.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';

/** O Mercado Pago exige no mínimo 30 minutos no date_of_expiration (Decisão 5). */
export const PRAZO_PIX_MERCADO_PAGO_MS = 30 * 60 * 1000;
/** A tela do Pix consulta a nossa API a cada 5 s; nós consultamos o Mercado Pago no máximo a cada 30 s. */
export const INTERVALO_CONSULTA_APP_MS = 30 * 1000;
/** Cartão: o cliente volta do navegador logo depois de pagar; consultamos no máximo a cada 10 s. */
export const INTERVALO_CONSULTA_CARTAO_MS = 10 * 1000;
/** A rotina roda a cada minuto e consulta cada pendente no máximo uma vez por minuto. */
export const INTERVALO_ROTINA_MS = 60 * 1000;
/** Mais de 3 falhas ao gerar Pix na mesma loja em 1 hora = alerta (Decisão 5 da Etapa 4). */
export const LIMITE_FALHAS_PIX = 3;
export const JANELA_FALHAS_PIX_MS = 60 * 60 * 1000;

const STATUS_MP_RECUSADO = { rejected: 'RECUSADO', cancelled: 'CANCELADO' };
/** Status do nosso pagamento em que um "approved" do Mercado Pago ainda é a aprovação (ou a atrasada). */
const STATUS_ANTES_DA_APROVACAO = ['PENDENTE', 'EXPIRADO', 'CANCELADO', 'RECUSADO'];

/**
 * Pagamento como o app vê (sem valores internos como a comissão). Cartão pendente: o link do
 * Checkout Pro (`checkoutUrl`, para "Tentar de novo") e a última tentativa recusada (`recusa`).
 */
export function pagamentoParaCliente(p) {
  const pendente = p.status === 'PENDENTE';
  const cartao = p.metodo === 'CARTAO_ONLINE';
  return {
    id: p.id,
    metodo: p.metodo,
    status: p.status,
    qrCode: pendente ? p.pixQrCode : null,
    qrCodeBase64: pendente ? p.pixQrCodeBase64 : null,
    checkoutUrl: pendente && cartao ? (p.checkoutUrl ?? null) : null,
    recusa: pendente && cartao && p.dadosMp?.recusada ? { mensagem: mensagemDaRecusa(p.dadosMp.statusDetail) } : null,
    expiraEm: p.expiraEm,
    valorCentavos: p.valorTotalCentavos,
  };
}

/** Resumo da resposta do Mercado Pago guardado no pagamento (sem dado pessoal nem QR). */
const resumoMp = (r) => ({
  id: r.id,
  status: r.status,
  statusDetail: r.statusDetail,
  tipo: r.tipo ?? null,
  valorCentavos: r.valorCentavos,
  comissaoCentavos: r.comissaoCentavos,
  aprovadoEm: r.aprovadoEm,
});

/**
 * Problemas do pagamento do Mercado Pago em relação ao nosso (lista vazia = confere). Pedido,
 * id e loja sempre; valor e comissão só na aprovação (é quando o dinheiro conta). A comissão só
 * é conferida quando o Mercado Pago a informa.
 */
export function divergencias(pagamento, r, lojaIdDaConta = null, mpUserIdDaConta = null) {
  const problemas = [];
  if (r.referenciaExterna !== String(pagamento.pedidoId)) problemas.push(`pedido ${r.referenciaExterna ?? '-'} no Mercado Pago`);
  if (pagamento.mpPaymentId && pagamento.mpPaymentId !== r.id) problemas.push('id do pagamento diferente');
  if (lojaIdDaConta != null && pagamento.pedido?.lojaId !== lojaIdDaConta) problemas.push('conta Mercado Pago de outra loja');
  // Cartão (Etapa 7): quem recebe (collector) tem de ser a conta conectada da loja.
  if (pagamento.metodo === 'CARTAO_ONLINE' && mpUserIdDaConta != null && r.collectorId != null && r.collectorId !== String(mpUserIdDaConta)) {
    problemas.push('pagamento recebido por outra conta do Mercado Pago');
  }
  if (r.status !== 'approved') return problemas;
  // Valor e comissão só quando a notificação vai APROVAR (pagamento ainda não aprovado). Depois,
  // um estorno parcial pode mudar a comissão no Mercado Pago e não é divergência (Etapa 5).
  if (pagamento.status && !STATUS_ANTES_DA_APROVACAO.includes(pagamento.status)) return problemas;
  if (r.valorCentavos !== pagamento.valorTotalCentavos) {
    problemas.push(`valor ${r.valorCentavos == null ? '-' : formatarDinheiro(r.valorCentavos)} (esperado ${formatarDinheiro(pagamento.valorTotalCentavos)})`);
  }
  if (r.comissaoCentavos != null && r.comissaoCentavos !== pagamento.valorPlataformaCentavos) {
    problemas.push(`comissão ${formatarDinheiro(r.comissaoCentavos)} (esperada ${formatarDinheiro(pagamento.valorPlataformaCentavos)})`);
  }
  return problemas;
}

/**
 * A chamada ao Mercado Pago falhou sem dizer se o estorno foi feito? Rede, tempo esgotado, 5xx ou
 * erro nosso no meio: talvez sim. Recusa clara (4xx, estorno "rejected", sem id/token, que nem
 * chamou) = não foi feito.
 */
export function resultadoIncerto(err) {
  if (!(err instanceof ErroMercadoPago)) return true;
  if (['REDE', 'TEMPO_ESGOTADO', 'RESPOSTA_INVALIDA'].includes(err.codigo)) return true;
  return err.status != null && err.status >= 500;
}

/** Erro para o log: o código e, quando o Mercado Pago explicou, o detalhe (message + cause, já limpo). */
const textoDoErro = (err) => `${err?.codigo ?? err?.message}${err?.detalhe ? `: ${err.detalhe}` : ''}`;

/** Pedido sem aceite da loja: alerta para o ADMIN depois de 10 minutos (Decisão 7 da Etapa 5). */
export const SEM_ACEITE_ALERTA_MS = 10 * 60 * 1000;
/** Estorno "processando" há mais que isto pode ser tentado de novo (a chamada anterior caiu). */
export const ESTORNO_TRAVADO_MS = 2 * 60 * 1000;
/** Status do pagamento que ainda têm valor a estornar. */
const ESTORNAVEIS = ['APROVADO', 'REEMBOLSO_PARCIAL'];
/** Status do Mercado Pago de contestação (chargeback) ou mediação. */
const STATUS_MP_CONTESTADO = ['charged_back', 'in_mediation'];
/** Status do estorno no Mercado Pago que contam como recusa. */
const ESTORNO_MP_RECUSADO = ['rejected', 'cancelled'];

const MOTIVO = {
  LOJA: 'Recusado pela loja',
  CLIENTE: 'Cancelado pelo cliente antes do aceite da loja',
  ATRASADO: 'Pix pago depois de o pedido expirar',
};

const naoEncontrado = () => new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
const encerrado = (status) =>
  new ErroHttp(409, `Pedido já está ${status === 'CANCELADO' ? 'cancelado' : 'finalizado'}`, { codigo: 'PEDIDO_ENCERRADO' });

/** Estorno como o ADMIN vê. */
const estornoPublico = (e) => ({
  id: e.id,
  valorCentavos: e.valorCentavos,
  motivo: e.motivo,
  origem: e.origem,
  status: e.status,
  erro: e.erro,
  observacao: e.observacao,
  usuario: e.usuario?.nome ?? null,
  resolvidoPor: e.resolvidoPor?.nome ?? null,
  criadoEm: e.criadoEm,
  concluidoEm: e.concluidoEm,
});

/**
 * @param {{ mercadoPago?: ReturnType<typeof criarClienteMercadoPago>, env?: object, log?: Pick<Console, 'warn'> }} [opcoes]
 */
export function criarServicoPagamentos({ mercadoPago, env = process.env, log = console } = {}) {
  const mp = mercadoPago ?? criarClienteMercadoPago();
  const emAndamento = new Set();

  async function tokenDaLoja(lojaId) {
    return (await contaDaLoja(lojaId)).token;
  }

  /** Token (decifrado só para a chamada) e a conta (`mpUserId`) da loja no Mercado Pago. */
  async function contaDaLoja(lojaId) {
    const conexao = await conexaoRepo.buscarDaLoja(lojaId);
    if (!conexao?.accessTokenCifrado) return { token: null, mpUserId: conexao?.mpUserId ?? null };
    return { token: decifrar(conexao.accessTokenCifrado, chaveDoAmbiente(env)), mpUserId: conexao.mpUserId ?? null };
  }

  async function resposta(pedidoId) {
    const [pedido, pagamento] = await Promise.all([pedidoRepo.buscarPorId(pedidoId), pagamentoRepo.ultimoDoPedido(pedidoId)]);
    return { pedido: pedidoPublico(pedido), pagamento: pagamento ? pagamentoParaCliente(pagamento) : null };
  }

  /**
   * Encerra o pedido que esperava o pagamento: EXPIRADO, estoque devolvido, campanha liberada e
   * o pagamento pendente com `statusPagamento`. Condicionado: já encerrado = nada (false).
   */
  async function expirarPedido(pedidoId, { statusPagamento = 'EXPIRADO', dadosMp, agora = new Date(), extra = {} } = {}) {
    return prisma.$transaction(async (tx) => {
      const linha = await pagamentoRepo.travarPedido(pedidoId, tx);
      if (linha?.status !== 'AGUARDANDO_PAGAMENTO') return false;
      await tx.pedido.update({ where: { id: pedidoId }, data: { status: 'EXPIRADO' } });
      await estornarVendas(tx, await pedidoRepo.vendasDoPedido(pedidoId, tx));
      await liberarCampanha(tx, pedidoId);
      await tx.pagamento.updateMany({
        where: { pedidoId, status: 'PENDENTE' },
        data: { status: statusPagamento, ...(dadosMp && { dadosMp }), consultadoEm: agora, ...extra },
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
      log.warn(`[pagamento] pedido ${pedidoId}: Pix não criado (status ${err.status ?? '-'}, ${textoDoErro(err)})`);
      await expirarPedido(pedidoId, { statusPagamento: 'RECUSADO', dadosMp: { erro: err.codigo ?? 'FALHA', status: err.status ?? null, ...(err.detalhe && { detalhe: err.detalhe }) }, agora });
      // E-mail do pagador recusado (Decisão 0 da Etapa 5): o cliente corrige e tenta de novo.
      if (erroNoEmailDoPagador(err)) {
        throw new ErroHttp(422, 'O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo.', {
          codigo: 'EMAIL_RECUSADO_PAGAMENTO',
        });
      }
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
   * Cria (ou devolve a já criada) preferência do Checkout Pro do pedido AGUARDANDO_PAGAMENTO com
   * cartão (Etapa 7). Mesmas regras de falha do Pix: pedido EXPIRADO (estoque e campanha de
   * volta) e 502 PAGAMENTO_FALHOU; e-mail recusado = 422 EMAIL_RECUSADO_PAGAMENTO.
   */
  async function gerarCartao(pedidoId, { email, agora = new Date() }) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    if (!pagamento) return resposta(pedidoId);
    const { pedido } = pagamento;
    if (pedido.status !== 'AGUARDANDO_PAGAMENTO') {
      if (pedido.status === 'EXPIRADO') {
        throw new ErroHttp(409, 'O prazo para pagar este pedido acabou. Faça o pedido de novo.', { codigo: 'PIX_EXPIRADO' });
      }
      return resposta(pedidoId);
    }
    if (pagamento.mpPreferenceId && pagamento.checkoutUrl) return resposta(pedidoId); // reenvio da mesma chave

    const loja = await lojaRepo.buscarPorId(pedido.lojaId);
    let pref;
    try {
      pref = await mp.criarPreferencia(await tokenDaLoja(pedido.lojaId), {
        valorCentavos: pagamento.valorTotalCentavos,
        comissaoCentavos: pagamento.valorPlataformaCentavos,
        pedidoId,
        titulo: `Pedido na ${loja?.nome ?? 'Taaki Delivery'}`,
        email,
        agora,
        expiraEm: pagamento.expiraEm,
        idempotencyKey: pagamento.idempotencyKey,
      });
    } catch (err) {
      log.warn(`[pagamento] pedido ${pedidoId}: preferência do cartão não criada (status ${err.status ?? '-'}, ${textoDoErro(err)})`);
      await expirarPedido(pedidoId, { statusPagamento: 'RECUSADO', dadosMp: { erro: err.codigo ?? 'FALHA', status: err.status ?? null, ...(err.detalhe && { detalhe: err.detalhe }) }, agora });
      if (erroNoEmailDoPagador(err)) {
        throw new ErroHttp(422, 'O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo.', {
          codigo: 'EMAIL_RECUSADO_PAGAMENTO',
        });
      }
      await conferirFalhasDaLoja(pedido.lojaId, agora).catch((e) => log.warn(`[pagamento] alerta de falhas: ${e.message}`));
      throw new ErroHttp(502, 'Não foi possível abrir o pagamento com cartão agora. Tente de novo ou escolha outra forma de pagamento.', {
        codigo: 'PAGAMENTO_FALHOU',
      });
    }
    await pagamentoRepo.atualizar(pagamento.id, { mpPreferenceId: pref.id, checkoutUrl: pref.checkoutUrl });
    return resposta(pedidoId);
  }

  /** Pix ou cartão, conforme o pagamento do pedido (o controller chama depois do commit). */
  async function gerarPagamento(pedidoId, dados) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    return pagamento?.metodo === 'CARTAO_ONLINE' ? gerarCartao(pedidoId, dados) : gerarPix(pedidoId, dados);
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
        // Cartão: a forma e o tipo reais (crédito, débito, pré-pago, saldo) que o Mercado Pago informou.
        const cartao = pagamento.metodo === 'CARTAO_ONLINE' ? tipoDoPagamento(r.tipo) : null;
        await tx.pedido.update({
          where: { id: pagamento.pedidoId },
          data: {
            status: 'CONFIRMADO',
            numeroDia,
            dataRef: paraCampoData(dia),
            formaPagamento: cartao ? cartao.forma : 'PIX',
            ...(cartao && { tipoPagamentoOnline: cartao.tipo }),
            trocoParaCentavos: null,
          },
        });
        await usarCampanha(tx, pagamento.pedidoId, agora);
        // Livro-razão: a parte da taxa que a trava de 50% deixou fora do split (Decisão 2 da Etapa 6).
        const complemento = await lancarComplemento(tx, pagamento.pedidoId, pagamento.valorPlataformaCentavos, agora);
        // Alerta da trava de 50% só aqui, com o pagamento aprovado (um Pix que expira não deve ao Taaki).
        if (complemento > 0) {
          await criarAlerta(
            {
              tipo: 'TAXA_ENTREGA_COMPLEMENTO',
              lojaId: linha.lojaId,
              pedidoId: pagamento.pedidoId,
              mensagem:
                `A taxa de entrega (${formatarDinheiro(pagamento.valorPlataformaCentavos + complemento)}) passou de 50% do valor cobrado ` +
                `do pedido ${pagamento.pedidoId}. ${formatarDinheiro(complemento)} ficam como débito da loja no fechamento.`,
            },
            tx,
          );
        }
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
                `O ${pagamento.metodo === 'CARTAO_ONLINE' ? 'pagamento com cartão' : 'Pix'} de ${formatarDinheiro(pagamento.valorTotalCentavos)} do pedido ${pagamento.pedidoId} foi pago depois que o ` +
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
      // Decisão 8: estorna sozinho (o pedido continua EXPIRADO); falhou = REEMBOLSO_PENDENTE + alerta.
      await estornarPagamentoAtrasado(pagamento.id, agora).catch((e) =>
        log.warn(`[pagamento] estorno do pedido ${pagamento.pedidoId}: ${textoDoErro(e)}`),
      );
    }
    return resultado.situacao;
  }

  /**
   * Concilia o nosso pagamento com a resposta do Mercado Pago (já consultada). Devolve o que
   * aconteceu (texto curto para o registro do webhook).
   */
  async function conciliar(pagamento, r, { agora = new Date(), lojaIdDaConta = null, mpUserIdDaConta = null } = {}) {
    // Cartão: tentativa recusada (o cliente pode tentar de novo no mesmo checkout, Decisão 3 da
    // Etapa 7). Com o pedido aguardando, só registra o motivo; depois (aprovado por outra tentativa,
    // expirado, desistido) é uma tentativa antiga e não muda nada.
    if (pagamento.metodo === 'CARTAO_ONLINE' && STATUS_MP_RECUSADO[r.status] && r.referenciaExterna === String(pagamento.pedidoId)) {
      if (pagamento.status !== 'PENDENTE' || (pagamento.mpPaymentId && pagamento.mpPaymentId !== r.id)) return 'TENTATIVA_ANTIGA';
      await pagamentoRepo.atualizarSeEm(pagamento.id, ['PENDENTE'], { consultadoEm: agora, dadosMp: { ...resumoMp(r), recusada: true } });
      return 'TENTATIVA_RECUSADA';
    }
    const problemas = divergencias(pagamento, r, lojaIdDaConta, mpUserIdDaConta);
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
    if (r.status === 'approved' && STATUS_ANTES_DA_APROVACAO.includes(pagamento.status)) {
      return aprovar(pagamento, r, agora);
    }
    if (STATUS_MP_CONTESTADO.includes(r.status)) return contestar(pagamento, r, agora);
    if (r.status === 'refunded' || r.valorReembolsadoCentavos > 0) return refletirReembolso(pagamento, r, agora);
    if (r.status === 'approved') return aprovar(pagamento, r, agora);
    if (STATUS_MP_RECUSADO[r.status]) {
      const expirou = await expirarPedido(pagamento.pedidoId, { statusPagamento: STATUS_MP_RECUSADO[r.status], dadosMp: resumoMp(r), agora });
      return expirou ? 'EXPIRADO' : 'JA_TRATADO';
    }
    // pending / in_process / outros: só registra a consulta.
    await pagamentoRepo.atualizar(pagamento.id, { consultadoEm: agora, dadosMp: resumoMp(r) });
    return 'SEM_MUDANCA';
  }

  // ───────── Etapa 5: estorno ─────────

  /** Avisa o PDV que o pedido mudou (selo do pagamento), se o pedido existe para a equipe. */
  async function avisarEquipe(pedidoId) {
    const pedido = await pedidoRepo.buscarPorId(pedidoId);
    if (pedido && !STATUS_FORA_DO_PDV.includes(pedido.status)) emitirParaEquipe(pedido.lojaId, 'pedido:atualizado', pedidoDaEquipe(pedido));
    return pedido;
  }

  /**
   * Dentro da transação de quem chama: o pagamento vai para REEMBOLSO_PENDENTE (condicionado:
   * dois estornos ao mesmo tempo, só um passa) e nasce o Estorno PROCESSANDO com a chave própria.
   * O Mercado Pago só é chamado depois do commit (`executarEstorno`): se o processo cair no meio,
   * fica pendente e visível para o ADMIN (sem retentativa automática, Decisão 10).
   */
  async function reservarEstorno(tx, pagamento, { valorCentavos, motivo, origem, usuarioId = null, de = ESTORNAVEIS }) {
    const restante = pagamento.valorTotalCentavos - pagamento.valorReembolsadoCentavos;
    const valor = valorCentavos ?? restante;
    if (!Number.isInteger(valor) || valor < 1 || valor > restante) {
      throw new ErroHttp(400, `O valor do estorno vai de R$ 0,01 até ${formatarDinheiro(restante)}`, {
        codigo: 'VALIDACAO',
        detalhes: [{ campo: 'valorCentavos', mensagem: `Até ${formatarDinheiro(restante)}` }],
      });
    }
    if ((await pagamentoRepo.atualizarSeEm(pagamento.id, de, { status: 'REEMBOLSO_PENDENTE' }, tx)) === 0) {
      throw new ErroHttp(409, 'Este pagamento já tem um estorno em andamento ou não pode ser estornado.', { codigo: 'ESTORNO_INDISPONIVEL' });
    }
    return pagamentoRepo.criarEstorno(
      { pagamentoId: pagamento.id, valorCentavos: valor, motivo: motivo.slice(0, 300), origem, usuarioId, idempotencyKey: randomUUID() },
      tx,
    );
  }

  /** Estorno concluído (pelo nosso pedido, pelo webhook ou resolvido por fora): soma no pagamento. */
  async function concluirEstorno(estorno, { mpRefundId = null, agora = new Date(), status = 'CONCLUIDO', observacao, resolvidoPorId } = {}) {
    return prisma.$transaction(async (tx) => {
      await pagamentoRepo.travarPagamento(estorno.pagamentoId, tx);
      const mudou = await pagamentoRepo.atualizarEstornoSeEm(
        estorno.id,
        ['PROCESSANDO', 'FALHOU'],
        { status, concluidoEm: agora, ...(mpRefundId && { mpRefundId }), ...(observacao && { observacao }), ...(resolvidoPorId && { resolvidoPorId }) },
        tx,
      );
      if (!mudou) return false;
      const pagamento = await tx.pagamento.findUnique({ where: { id: estorno.pagamentoId } });
      const reembolsado = Math.min(pagamento.valorTotalCentavos, pagamento.valorReembolsadoCentavos + estorno.valorCentavos);
      await tx.pagamento.update({
        where: { id: pagamento.id },
        data: {
          valorReembolsadoCentavos: reembolsado,
          // Contestado continua contestado (o Mercado Pago decide); senão, total ou parcial.
          ...(pagamento.status !== 'CONTESTADO' && { status: reembolsado >= pagamento.valorTotalCentavos ? 'REEMBOLSADO' : 'REEMBOLSO_PARCIAL' }),
        },
      });
      // O alerta de reembolso que falhou deste pedido fica resolvido por quem agiu (o ADMIN que
      // tentou de novo ou resolveu por fora). Concluído sozinho (webhook): o ADMIN marca na tela.
      const quem = resolvidoPorId ?? estorno.usuarioId ?? null;
      if (quem) {
        await tx.alertaPlataforma.updateMany({
          where: { tipo: 'REEMBOLSO_FALHOU', pedidoId: pagamento.pedidoId, resolvidoEm: null },
          data: { resolvidoEm: agora, resolvidoPorId: quem },
        });
      }
      return true;
    }, OPCOES_TRANSACAO);
  }

  /** Estorno recusado ou com erro: FALHOU, pagamento continua REEMBOLSO_PENDENTE, alerta (sem retentativa). */
  async function falharEstorno(estorno, err, agora) {
    const erro = textoDoErro(err).slice(0, 300);
    log.warn(`[pagamento] pedido ${estorno.pagamento.pedidoId}: estorno ${estorno.id} falhou (${err?.status ?? '-'}, ${erro})`);
    await pagamentoRepo.atualizarEstornoSeEm(estorno.id, ['PROCESSANDO'], { status: 'FALHOU', erro, resultadoIncerto: resultadoIncerto(err) });
    const loja = await lojaRepo.buscarPorId(estorno.pagamento.pedido.lojaId);
    await alertarUmaVez({
      tipo: 'REEMBOLSO_FALHOU',
      lojaId: estorno.pagamento.pedido.lojaId,
      pedidoId: estorno.pagamento.pedidoId,
      mensagem:
        `O estorno de ${formatarDinheiro(estorno.valorCentavos)} do pedido ${estorno.pagamento.pedidoId} (${loja?.nome ?? 'loja'}) ` +
        `não foi feito pelo Mercado Pago (${erro}). Abra "Pagamentos online" para tentar de novo ou marcar como resolvido por fora.`,
    }).catch((e) => log.warn(`[pagamento] alerta de reembolso: ${e.message}`));
  }

  /**
   * Chama o Mercado Pago para um Estorno PROCESSANDO (depois do commit). Aprovado = concluído;
   * recusado ou erro = falhou + alerta; em processamento no Mercado Pago = continua PROCESSANDO
   * (o webhook "refunded" conclui). Nunca lança: devolve 'CONCLUIDO' | 'FALHOU' | 'PROCESSANDO'.
   */
  async function executarEstorno(estornoId, agora = new Date()) {
    const estorno = await pagamentoRepo.buscarEstorno(estornoId);
    const { pagamento } = estorno;
    try {
      if (!pagamento.mpPaymentId) throw new ErroMercadoPago('Pagamento sem id no Mercado Pago', { codigo: 'SEM_ID' });
      const total = estorno.valorCentavos === pagamento.valorTotalCentavos && pagamento.valorReembolsadoCentavos === 0;
      const r = await mp.estornar(await tokenDaLoja(pagamento.pedido.lojaId), pagamento.mpPaymentId, {
        valorCentavos: total ? null : estorno.valorCentavos,
        idempotencyKey: estorno.idempotencyKey,
      });
      if (ESTORNO_MP_RECUSADO.includes(r.status)) {
        throw new ErroMercadoPago('Estorno recusado pelo Mercado Pago', { codigo: `ESTORNO_${r.status.toUpperCase()}` });
      }
      if (r.status && r.status !== 'approved') {
        await pagamentoRepo.atualizarEstornoSeEm(estorno.id, ['PROCESSANDO'], { mpRefundId: r.id });
        return 'PROCESSANDO';
      }
      await concluirEstorno(estorno, { mpRefundId: r.id, agora });
      return 'CONCLUIDO';
    } catch (err) {
      await falharEstorno(estorno, err, agora);
      return 'FALHOU';
    } finally {
      await avisarEquipe(pagamento.pedidoId).catch(() => {});
    }
  }

  /** Pago depois de expirar (A_ESTORNAR): estorno total automático; o pedido continua EXPIRADO. */
  async function estornarPagamentoAtrasado(pagamentoId, agora = new Date()) {
    const estorno = await prisma.$transaction(async (tx) => {
      const pagamento = await tx.pagamento.findUnique({ where: { id: pagamentoId } });
      if (pagamento?.status !== 'A_ESTORNAR') return null;
      return reservarEstorno(tx, pagamento, { motivo: MOTIVO.ATRASADO, origem: 'AUTOMATICO', de: ['A_ESTORNAR'] });
    }, OPCOES_TRANSACAO);
    return estorno ? executarEstorno(estorno.id, agora) : 'JA_TRATADO';
  }

  /**
   * Webhook/consulta com valor reembolsado no Mercado Pago. Nosso estorno em aberto e coberto =
   * concluído. Valor a mais que nenhum estorno nosso explica = estorno feito direto no Mercado
   * Pago: registrado (origem MERCADO_PAGO) e, com o pedido aberto, alerta ESTORNO_EXTERNO
   * (Decisão 5: o pedido não é cancelado sozinho).
   */
  async function refletirReembolso(pagamento, r, agora) {
    const noMp = r.status === 'refunded' ? Math.max(r.valorReembolsadoCentavos, pagamento.valorTotalCentavos) : r.valorReembolsadoCentavos;
    const aberto = await pagamentoRepo.estornoAberto(pagamento.id);
    let ja = pagamento.valorReembolsadoCentavos;
    if (aberto && noMp >= ja + aberto.valorCentavos) {
      await concluirEstorno(aberto, { agora });
      ja += aberto.valorCentavos;
    }
    const externo = Math.min(noMp, pagamento.valorTotalCentavos) - ja;
    if (externo <= 0) {
      await pagamentoRepo.atualizar(pagamento.id, { consultadoEm: agora });
      await avisarEquipe(pagamento.pedidoId);
      return aberto ? 'ESTORNO_CONCLUIDO' : 'SEM_MUDANCA';
    }
    const registrado = await prisma.$transaction(async (tx) => {
      await pagamentoRepo.travarPagamento(pagamento.id, tx);
      const atual = await tx.pagamento.findUnique({ where: { id: pagamento.id } });
      const diferenca = Math.min(noMp, atual.valorTotalCentavos) - atual.valorReembolsadoCentavos;
      if (diferenca <= 0) return false;
      await tx.estorno.create({
        data: { pagamentoId: atual.id, valorCentavos: diferenca, motivo: 'Estorno feito direto no Mercado Pago', origem: 'MERCADO_PAGO', status: 'CONCLUIDO', concluidoEm: agora },
      });
      const total = atual.valorReembolsadoCentavos + diferenca;
      await tx.pagamento.update({
        where: { id: atual.id },
        data: {
          valorReembolsadoCentavos: total,
          consultadoEm: agora,
          ...(!['CONTESTADO', 'REEMBOLSO_PENDENTE'].includes(atual.status) && {
            status: total >= atual.valorTotalCentavos ? 'REEMBOLSADO' : 'REEMBOLSO_PARCIAL',
          }),
        },
      });
      const pedido = await tx.pedido.findUnique({ where: { id: atual.pedidoId }, select: { status: true, lojaId: true, numeroDia: true } });
      if (STATUS_ABERTOS.includes(pedido.status)) {
        await criarAlerta(
          {
            tipo: 'ESTORNO_EXTERNO',
            lojaId: pedido.lojaId,
            pedidoId: atual.pedidoId,
            mensagem:
              `${formatarDinheiro(diferenca)} do pedido ${pedido.numeroDia ? `nº ${pedido.numeroDia}` : atual.pedidoId} foram estornados direto no ` +
              'Mercado Pago com o pedido ainda aberto. O pedido NÃO foi cancelado: confira com a loja.',
          },
          tx,
        );
      }
      return true;
    }, OPCOES_TRANSACAO);
    await avisarEquipe(pagamento.pedidoId);
    return registrado ? 'ESTORNO_EXTERNO' : 'SEM_MUDANCA';
  }

  /** Chargeback ou mediação: CONTESTADO e alerta para o ADMIN (um por pedido). */
  async function contestar(pagamento, r, agora) {
    const mudou = await pagamentoRepo.atualizarSeEm(
      pagamento.id,
      ['APROVADO', 'REEMBOLSO_PARCIAL', 'REEMBOLSADO', 'REEMBOLSO_PENDENTE', 'A_ESTORNAR'],
      { status: 'CONTESTADO', dadosMp: resumoMp(r), consultadoEm: agora },
    );
    if (!mudou) return 'SEM_MUDANCA';
    const loja = await lojaRepo.buscarPorId(pagamento.pedido.lojaId);
    await alertarUmaVez({
      tipo: 'CHARGEBACK',
      lojaId: pagamento.pedido.lojaId,
      pedidoId: pagamento.pedidoId,
      mensagem:
        `O pagamento ${r.id} do pedido ${pagamento.pedidoId} (${loja?.nome ?? 'loja'}) foi contestado no Mercado Pago ` +
        `(${r.status === 'in_mediation' ? 'mediação' : 'chargeback'}). Acompanhe a disputa no Mercado Pago da loja.`,
    });
    await avisarEquipe(pagamento.pedidoId);
    return 'CONTESTADO';
  }

  /**
   * Cancela um pedido pago online com estorno (total, ou parcial pelo ADMIN), numa transação com
   * o pedido travado; o Mercado Pago é chamado depois do commit. `quem`:
   * - LOJA: só antes do aceite (depois = 409 CANCELAR_COM_TAAKI);
   * - CLIENTE: só o dono, só antes do aceite (depois = 409 PEDIDO_JA_ACEITO);
   * - ADMIN: a qualquer momento (pedido aberto).
   * Pagamento já todo estornado ou contestado: cancela sem novo estorno.
   */
  async function cancelarComEstorno(pedidoId, { quem, lojaId = null, clienteId = null, valorCentavos = null, motivo, usuarioId = null, agora = new Date() }) {
    const { pedido, trabalho, estorno } = await prisma.$transaction(async (tx) => {
      const linha = await pagamentoRepo.travarPedidoParaCancelar(pedidoId, tx);
      if (!linha) throw naoEncontrado();
      if (quem === 'LOJA' && !ehDaLoja(linha, lojaId)) throw naoEncontrado();
      if (quem === 'CLIENTE' && linha.clienteId !== clienteId) throw naoEncontrado();
      if (!linha.meioOnline) {
        throw new ErroHttp(409, 'Este pedido é pago na entrega: para cancelar, fale com a loja pelo WhatsApp.', { codigo: 'CANCELAR_PELO_WHATSAPP' });
      }
      if (!STATUS_ABERTOS.includes(linha.status)) {
        if (STATUS_FORA_DO_PDV.includes(linha.status) && quem !== 'ADMIN') throw naoEncontrado();
        throw encerrado(linha.status);
      }
      if (linha.aceitoEm && quem === 'LOJA') {
        throw new ErroHttp(409, 'Este pedido pago online já foi aceito. Para cancelar, fale com o Taaki.', { codigo: 'CANCELAR_COM_TAAKI' });
      }
      if (linha.aceitoEm && quem === 'CLIENTE') {
        throw new ErroHttp(409, 'A loja já aceitou o pedido. Para cancelar, fale com a loja pelo WhatsApp.', { codigo: 'PEDIDO_JA_ACEITO' });
      }
      const pagamento = await tx.pagamento.findFirst({ where: { pedidoId }, orderBy: { id: 'desc' } });
      if (pagamento?.status === 'REEMBOLSO_PENDENTE') {
        throw new ErroHttp(409, 'Já há um estorno pendente neste pedido. Resolva em "Pagamentos online".', { codigo: 'ESTORNO_INDISPONIVEL' });
      }
      const { pedido, trabalho } = await cancelarNaTransacao(tx, linha.lojaId, pedidoId, { usuarioId, agora });
      const estorno = ESTORNAVEIS.includes(pagamento?.status)
        ? await reservarEstorno(tx, pagamento, { valorCentavos, motivo, origem: quem === 'ADMIN' ? 'ADMIN' : 'AUTOMATICO', usuarioId })
        : null;
      return { pedido, trabalho, estorno };
    }, OPCOES_TRANSACAO);
    avisarCancelamento(pedido.lojaId, pedido, trabalho);
    if (estorno) await executarEstorno(estorno.id, agora);
    return pedidoRepo.buscarPorId(pedidoId);
  }

  /**
   * Cancelar pelo PDV. Pedido pago online: recusa com estorno total (antes do aceite) ou 409
   * (depois). Os outros: o cancelamento de sempre.
   */
  async function cancelarPelaLoja(lojaId, pedidoId, { usuarioId = null, agora = new Date() } = {}) {
    const atual = await pedidoRepo.buscarStatus(pedidoId);
    if (!ehDaLoja(atual, lojaId) || !atual.meioOnline) return cancelarPedido(lojaId, pedidoId, { usuarioId, agora });
    return pedidoDaEquipe(await cancelarComEstorno(pedidoId, { quem: 'LOJA', lojaId, motivo: MOTIVO.LOJA, usuarioId, agora }));
  }

  /** Cancelar pelo app, antes do aceite da loja (Decisão 6 da Etapa 5). */
  async function cancelarPeloCliente(clienteId, pedidoId, agora = new Date()) {
    return pedidoPublico(await cancelarComEstorno(pedidoId, { quem: 'CLIENTE', clienteId, motivo: MOTIVO.CLIENTE, agora }));
  }

  /**
   * ADMIN (Decisão 2 da Etapa 5): pedido aberto = cancela com estorno total ou parcial (o estoque
   * volta); encerrado (finalizado, cancelado ou expirado) = só estorna o que ainda não voltou.
   * Motivo obrigatório (o controller confere).
   */
  async function estornarPeloAdmin(pedidoId, { valorCentavos = null, motivo, usuarioId, agora = new Date() }) {
    const atual = await pedidoRepo.buscarStatus(pedidoId);
    if (!atual) throw naoEncontrado();
    if (!atual.meioOnline) throw new ErroHttp(409, 'Este pedido não foi pago online.', { codigo: 'NAO_PAGO_ONLINE' });
    if (STATUS_ABERTOS.includes(atual.status)) {
      return { cancelado: true, pedido: pedidoDaEquipe(await cancelarComEstorno(pedidoId, { quem: 'ADMIN', valorCentavos, motivo, usuarioId, agora })) };
    }
    const estorno = await prisma.$transaction(async (tx) => {
      await pagamentoRepo.travarPedido(pedidoId, tx);
      const pagamento = await tx.pagamento.findFirst({ where: { pedidoId }, orderBy: { id: 'desc' } });
      if (!ESTORNAVEIS.includes(pagamento?.status)) {
        throw new ErroHttp(409, 'Este pagamento não tem valor a estornar (já estornado, pendente ou contestado).', { codigo: 'ESTORNO_INDISPONIVEL' });
      }
      return reservarEstorno(tx, pagamento, { valorCentavos, motivo, origem: 'ADMIN', usuarioId });
    }, OPCOES_TRANSACAO);
    await executarEstorno(estorno.id, agora);
    return { cancelado: false, pedido: pedidoDaEquipe(await pedidoRepo.buscarPorId(pedidoId)) };
  }

  /**
   * Reembolso pendente, "Tentar de novo" (ADMIN). Nunca repete o MESMO estorno pendente:
   * 1. com o id do estorno no Mercado Pago (`mpRefundId`), consulta esse estorno;
   * 2. o total já devolvido lá cobre este = só conclui;
   * 3. resultado incerto (rede, tempo, 5xx, processo parado) = o mesmo registro e a mesma chave;
   * 4. recusa clara = estorno novo com chave nova.
   * Estornos parciais de mesmo valor feitos de propósito são independentes. Estorno ainda
   * processando há menos de 2 minutos = 409 (a chamada anterior pode estar em andamento).
   */
  async function tentarEstornoDeNovo(pagamentoId, { usuarioId, agora = new Date() }) {
    const pagamento = await pagamentoRepo.buscarPorId(pagamentoId);
    if (pagamento?.status !== 'REEMBOLSO_PENDENTE') {
      throw new ErroHttp(409, 'Este pagamento não tem reembolso pendente.', { codigo: 'SEM_REEMBOLSO_PENDENTE' });
    }
    const aberto = await pagamentoRepo.estornoAberto(pagamentoId);
    if (!aberto) throw new ErroHttp(409, 'Este pagamento não tem reembolso pendente.', { codigo: 'SEM_REEMBOLSO_PENDENTE' });
    if (aberto.status === 'PROCESSANDO' && agora - aberto.criadoEm < ESTORNO_TRAVADO_MS) {
      throw new ErroHttp(409, 'O estorno ainda está sendo processado. Tente de novo em alguns minutos.', { codigo: 'ESTORNO_EM_ANDAMENTO' });
    }
    if (pagamento.mpPaymentId) {
      const token = await tokenDaLoja(pagamento.pedido.lojaId);
      const concluirJaFeito = async (mpRefundId) => {
        await concluirEstorno(aberto, { agora, mpRefundId, observacao: 'Já estornado no Mercado Pago (conferido ao tentar de novo)' });
        await avisarEquipe(pagamento.pedidoId);
        return { resultado: 'CONCLUIDO' };
      };
      const emAndamentoNoMp = () =>
        new ErroHttp(409, 'O Mercado Pago ainda está processando este estorno. Confira de novo mais tarde.', { codigo: 'ESTORNO_EM_ANDAMENTO' });
      // 1. O estorno já foi pedido e o Mercado Pago deu o id: consulta ESSE estorno, nunca pede outro por cima.
      if (aberto.mpRefundId) {
        const e = await mp.consultarEstorno(token, pagamento.mpPaymentId, aberto.mpRefundId);
        if (e.status === 'approved') return concluirJaFeito(e.id);
        if (!ESTORNO_MP_RECUSADO.includes(e.status)) throw emAndamentoNoMp();
      }
      // 2. O total já devolvido no Mercado Pago passa do que conhecemos + este estorno (não olha
      //    o valor de cada estorno: dois parciais iguais de propósito continuam possíveis).
      const r = await mp.consultarPagamento(token, pagamento.mpPaymentId);
      const noMp = r.status === 'refunded' ? pagamento.valorTotalCentavos : r.valorReembolsadoCentavos;
      if (noMp >= pagamento.valorReembolsadoCentavos + aberto.valorCentavos) return concluirJaFeito(null);
    }
    // 3. Sem saber se o Mercado Pago fez (a chamada caiu, tempo esgotado, 5xx, ou o processo parou
    //    no meio): repete ESTE estorno com a MESMA chave de idempotência. O Mercado Pago devolve o
    //    estorno já criado, se houver, em vez de criar outro.
    if (aberto.status === 'PROCESSANDO' || aberto.resultadoIncerto) {
      const mudou = await pagamentoRepo.atualizarEstornoSeEm(aberto.id, ['PROCESSANDO', 'FALHOU'], {
        status: 'PROCESSANDO',
        erro: null,
        resultadoIncerto: false,
      });
      if (!mudou) throw new ErroHttp(409, 'O reembolso mudou enquanto isso. Atualize a tela.', { codigo: 'ESTORNO_EM_ANDAMENTO' });
      return { resultado: await executarEstorno(aberto.id, agora) };
    }
    // 4. O Mercado Pago recusou com clareza: uma tentativa nova, com chave nova.
    const novo = await prisma.$transaction(async (tx) => {
      await pagamentoRepo.travarPagamento(pagamentoId, tx);
      if ((await pagamentoRepo.atualizarEstornoSeEm(aberto.id, ['PROCESSANDO', 'FALHOU'], { status: 'FALHOU', erro: aberto.erro ?? 'Interrompido' }, tx)) === 0) {
        throw new ErroHttp(409, 'O reembolso mudou enquanto isso. Atualize a tela.', { codigo: 'ESTORNO_EM_ANDAMENTO' });
      }
      return pagamentoRepo.criarEstorno(
        { pagamentoId, valorCentavos: aberto.valorCentavos, motivo: aberto.motivo, origem: aberto.origem, usuarioId, idempotencyKey: randomUUID() },
        tx,
      );
    }, OPCOES_TRANSACAO);
    return { resultado: await executarEstorno(novo.id, agora) };
  }

  /** Reembolso pendente resolvido fora do sistema (ADMIN), com observação obrigatória. */
  async function resolverEstornoPorFora(pagamentoId, { observacao, usuarioId, agora = new Date() }) {
    const aberto = await pagamentoRepo.estornoAberto(pagamentoId);
    const pagamento = aberto?.pagamento;
    if (!aberto || pagamento.status !== 'REEMBOLSO_PENDENTE') {
      throw new ErroHttp(409, 'Este pagamento não tem reembolso pendente.', { codigo: 'SEM_REEMBOLSO_PENDENTE' });
    }
    if (!(await concluirEstorno(aberto, { agora, status: 'RESOLVIDO_POR_FORA', observacao, resolvidoPorId: usuarioId }))) {
      throw new ErroHttp(409, 'O reembolso mudou enquanto isso. Atualize a tela.', { codigo: 'ESTORNO_EM_ANDAMENTO' });
    }
    await avisarEquipe(pagamento.pedidoId);
  }

  /** Tela "Pagamentos online" do ADMIN: `acao` = só os que pedem ação. */
  async function listarParaAdmin({ acao = false, lojaId, pedidoId, numeroDia } = {}) {
    const lista = await pagamentoRepo.listarParaAdmin({
      status: acao ? pagamentoRepo.STATUS_DE_ACAO : pagamentoRepo.STATUS_PAGOS,
      lojaId,
      pedidoId,
      numeroDia,
    });
    return lista.map((p) => ({
      id: p.id,
      metodo: p.metodo,
      status: p.status,
      mpPaymentId: p.mpPaymentId,
      valorCentavos: p.valorTotalCentavos,
      valorReembolsadoCentavos: p.valorReembolsadoCentavos,
      aprovadoEm: p.aprovadoEm,
      pedido: {
        ...p.pedido,
        dataRef: p.pedido.dataRef ? new Date(p.pedido.dataRef).toISOString().slice(0, 10) : null,
      },
      estornos: p.estornos.map(estornoPublico),
    }));
  }

  /** Rotina: pedidos pagos online há 10 minutos sem aceite = alerta para o ADMIN (um por pedido). */
  async function alertarSemAceite(agora = new Date()) {
    let criados = 0;
    for (const p of await pagamentoRepo.semAceiteDesde(new Date(agora.getTime() - SEM_ACEITE_ALERTA_MS))) {
      await criarAlerta({
        tipo: 'PEDIDO_SEM_ACEITE',
        lojaId: p.lojaId,
        pedidoId: p.id,
        mensagem:
          `O pedido nº ${p.numeroDia ?? p.id} da loja ${p.loja?.nome ?? p.lojaId}, pago online, está há mais de 10 minutos sem ` +
          'o aceite da loja. Ligue para a loja.',
      });
      criados += 1;
    }
    return criados;
  }

  /**
   * Situação do pagamento no Mercado Pago: pelo id (Pix, ou cartão já aprovado) ou, no cartão
   * ainda sem id, pela busca do pedido: o aprovado, se houver; senão a tentativa mais nova.
   * Nenhum pagamento ainda (o cliente não pagou) = null.
   */
  async function situacaoNoMp(pagamento, token) {
    if (pagamento.mpPaymentId) return mp.consultarPagamento(token, pagamento.mpPaymentId);
    if (pagamento.metodo !== 'CARTAO_ONLINE' || !pagamento.mpPreferenceId) return null;
    const lista = await mp.buscarPagamentosDoPedido(token, pagamento.pedidoId);
    return lista.find((p) => p.status === 'approved') ?? lista[0] ?? null;
  }

  /** Consulta o Mercado Pago com o token da loja do pedido e concilia. */
  async function consultarEConciliar(pagamento, agora = new Date()) {
    if (!pagamento.mpPaymentId && !pagamento.mpPreferenceId) return 'SEM_ID';
    const { token, mpUserId } = await contaDaLoja(pagamento.pedido.lojaId);
    const r = await situacaoNoMp(pagamento, token);
    if (!r) {
      await pagamentoRepo.atualizar(pagamento.id, { consultadoEm: agora });
      return 'SEM_PAGAMENTO';
    }
    return conciliar(pagamento, r, { agora, mpUserIdDaConta: mpUserId });
  }

  /**
   * Pendente que passou dos 15 minutos: consulta uma última vez (pago no último segundo vence),
   * cancela no Mercado Pago e expira o pedido. Falha no Mercado Pago não impede a expiração
   * (se ele aprovar depois, o webhook marca A_ESTORNAR).
   */
  async function expirarPendente(pagamento, agora = new Date(), statusPagamento = 'EXPIRADO') {
    let cancelarDeNovo = false;
    if (pagamento.mpPaymentId || pagamento.mpPreferenceId) {
      try {
        const { token, mpUserId } = await contaDaLoja(pagamento.pedido.lojaId);
        const r = await situacaoNoMp(pagamento, token);
        if (r?.status === 'approved') return conciliar(pagamento, r, { agora, mpUserIdDaConta: mpUserId });
        // Pix pendente: cancelado no Mercado Pago. Cartão: a preferência já venceu aos 15 minutos.
        if (r && (r.status === 'pending' || r.status === 'in_process')) await mp.cancelarPagamento(token, r.id);
      } catch (err) {
        log.warn(`[pagamento] pedido ${pagamento.pedidoId}: cancelamento no Mercado Pago falhou (${err.status ?? '-'}, ${textoDoErro(err)})`);
        // Pix: continua pagável no Mercado Pago até os 30 minutos; a rotina tenta cancelar de novo.
        cancelarDeNovo = pagamento.metodo === 'PIX' && Boolean(pagamento.mpPaymentId);
      }
    }
    const extra = cancelarDeNovo ? { cancelarNoMpAte: limiteDoPixNoMp(pagamento) } : {};
    return (await expirarPedido(pagamento.pedidoId, { statusPagamento, agora, extra })) ? 'EXPIRADO' : 'JA_TRATADO';
  }

  /**
   * Fim do Pix no Mercado Pago: criado com 30 minutos (Decisão 5), quando o nosso prazo (expiraEm)
   * era de 15. Até lá um cancelamento que falhou vale a pena ser repetido.
   */
  const limiteDoPixNoMp = (pagamento) =>
    new Date(new Date(pagamento.expiraEm).getTime() - PRAZO_PIX_MS + PRAZO_PIX_MERCADO_PAGO_MS);

  /**
   * Rotina: Pix expirado do nosso lado com o cancelamento no Mercado Pago a refazer. Consulta:
   * aprovado = conciliação (pago depois de expirar: estorno automático); pendente = cancela;
   * já encerrado lá = nada. Deu certo = sai da lista; falhou = tenta no próximo minuto.
   */
  async function recancelarPix(pagamento, agora) {
    const { token, mpUserId } = await contaDaLoja(pagamento.pedido.lojaId);
    const r = await mp.consultarPagamento(token, pagamento.mpPaymentId);
    if (r.status === 'approved') await conciliar(pagamento, r, { agora, mpUserIdDaConta: mpUserId });
    else if (r.status === 'pending' || r.status === 'in_process') await mp.cancelarPagamento(token, r.id);
    await pagamentoRepo.atualizar(pagamento.id, { cancelarNoMpAte: null });
    return r.status === 'approved' ? 'APROVADO_DEPOIS' : 'CANCELADO';
  }

  /** Situação do pagamento online (Pix ou cartão) para a tela do app (só o dono do pedido; outro = 404). */
  async function situacaoParaCliente(clienteId, pedidoId, agora = new Date()) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    if (!pagamento || pagamento.pedido.clienteId !== clienteId) {
      throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
    }
    if (pagamento.status === 'PENDENTE') {
      try {
        if (pagamento.expiraEm <= agora) await expirarPendente(pagamento, agora);
        else if (
          !pagamento.consultadoEm ||
          agora - pagamento.consultadoEm >= (pagamento.metodo === 'CARTAO_ONLINE' ? INTERVALO_CONSULTA_CARTAO_MS : INTERVALO_CONSULTA_APP_MS)
        ) {
          await consultarEConciliar(pagamento, agora);
        }
      } catch (err) {
        log.warn(`[pagamento] consulta do pedido ${pedidoId} falhou (${err.status ?? '-'}, ${textoDoErro(err)})`);
      }
    }
    return resposta(pedidoId);
  }

  /**
   * "Escolher outra forma de pagamento" no app (Etapa 7): o cliente desiste do pedido que espera
   * o pagamento. Só o dono e só aguardando (senão devolve a situação como está). Consulta uma
   * última vez (pago no último segundo vence); senão encerra a preferência no Mercado Pago e o
   * pedido vira EXPIRADO com estoque e campanha de volta (pagamento CANCELADO).
   */
  async function desistirDoPagamento(clienteId, pedidoId, agora = new Date()) {
    const pagamento = await pagamentoRepo.ultimoDoPedido(pedidoId);
    if (!pagamento || pagamento.pedido.clienteId !== clienteId) {
      throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
    }
    if (pagamento.status === 'PENDENTE' && pagamento.pedido.status === 'AGUARDANDO_PAGAMENTO') {
      let aprovado = false;
      let cancelarDeNovo = false;
      try {
        const { token, mpUserId } = await contaDaLoja(pagamento.pedido.lojaId);
        const r = await situacaoNoMp(pagamento, token);
        if (r?.status === 'approved') aprovado = (await conciliar(pagamento, r, { agora, mpUserIdDaConta: mpUserId })) === 'APROVADO';
        if (!aprovado && pagamento.mpPreferenceId) await mp.expirarPreferencia(token, pagamento.mpPreferenceId, agora);
        if (!aprovado && r && pagamento.metodo === 'PIX' && r.status === 'pending') await mp.cancelarPagamento(token, r.id);
      } catch (err) {
        // Sem o Mercado Pago o cliente ainda desiste; se um pagamento for aprovado depois, ele é estornado (A_ESTORNAR).
        log.warn(`[pagamento] desistência do pedido ${pedidoId}: Mercado Pago (${err.status ?? '-'}, ${textoDoErro(err)})`);
        cancelarDeNovo = pagamento.metodo === 'PIX' && Boolean(pagamento.mpPaymentId);
      }
      const extra = cancelarDeNovo ? { cancelarNoMpAte: limiteDoPixNoMp(pagamento) } : {};
      if (!aprovado) await expirarPedido(pedidoId, { statusPagamento: 'CANCELADO', agora, extra });
    }
    return resposta(pedidoId);
  }

  /** Rotina de 1 minuto: expira os vencidos e consulta os outros pendentes (webhook perdido). */
  async function rodarRotina(agora = new Date()) {
    const r = { expirados: 0, aprovados: 0, consultados: 0, recancelados: 0, falhas: 0 };
    for (const p of await pagamentoRepo.pendentes()) {
      try {
        if (p.expiraEm <= agora) {
          const s = await expirarPendente(p, agora);
          if (s === 'EXPIRADO') r.expirados += 1;
          if (s === 'APROVADO') r.aprovados += 1;
        } else if ((p.mpPaymentId || p.mpPreferenceId) && (!p.consultadoEm || agora - p.consultadoEm >= INTERVALO_ROTINA_MS)) {
          r.consultados += 1;
          if ((await consultarEConciliar(p, agora)) === 'APROVADO') r.aprovados += 1;
        }
      } catch (err) {
        r.falhas += 1;
        log.warn(`[pagamento] rotina, pedido ${p.pedidoId}: ${err.status ?? '-'} ${textoDoErro(err)}`);
      }
    }
    // Pix expirado do nosso lado que o Mercado Pago não cancelou: de novo, até os 30 minutos dele.
    for (const p of await pagamentoRepo.cancelamentosPendentes(agora)) {
      try {
        await recancelarPix(p, agora);
        r.recancelados += 1;
      } catch (err) {
        r.falhas += 1;
        log.warn(`[pagamento] rotina, novo cancelamento do Pix do pedido ${p.pedidoId}: ${err.status ?? '-'} ${textoDoErro(err)}`);
      }
    }
    // Pago depois de expirar que ficou para trás (ex.: o servidor caiu antes do estorno): uma
    // tentativa só, porque a reserva tira o pagamento de A_ESTORNAR (sem retentativa, Decisão 10).
    for (const p of await pagamentoRepo.aEstornar()) {
      if ((await estornarPagamentoAtrasado(p.id, agora).catch(() => 'FALHOU')) === 'FALHOU') r.falhas += 1;
    }
    r.semAceite = await alertarSemAceite(agora).catch((err) => {
      log.warn(`[pagamento] alerta de pedido sem aceite: ${err.message}`);
      return 0;
    });
    return r;
  }

  /**
   * Desconectar a loja (Decisão 17): cancela no Mercado Pago os Pix pendentes (antes de apagar os
   * tokens) e expira os pedidos aguardando pagamento. Devolve quantos encerrou.
   */
  async function cancelarPendentesDaLoja(lojaId, agora = new Date()) {
    let cancelados = 0;
    for (const p of await pagamentoRepo.pendentes({ lojaId })) {
      if (p.mpPaymentId || p.mpPreferenceId) {
        try {
          // Pix: cancela o pagamento. Cartão: encerra a preferência (ninguém paga mais nela).
          if (p.mpPaymentId) await mp.cancelarPagamento(await tokenDaLoja(lojaId), p.mpPaymentId);
          else await mp.expirarPreferencia(await tokenDaLoja(lojaId), p.mpPreferenceId, agora);
        } catch (err) {
          log.warn(`[pagamento] desconectar, pedido ${p.pedidoId}: cancelamento falhou (${err.status ?? '-'}, ${textoDoErro(err)})`);
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
    // O corpo da notificação não é assinado (só o data.id, o request-id e o ts): só desconecta se
    // o Mercado Pago responder que o token da loja é inválido (401/403). Token ainda autorizado =
    // ignorada. Sem resposta clara (5xx, tempo, rede, sem token para perguntar) = nada muda.
    let autorizado;
    try {
      const { token } = await contaDaLoja(conexao.lojaId);
      if (!token) throw new ErroMercadoPago('Loja sem token para conferir', { codigo: 'SEM_TOKEN' });
      autorizado = await mp.tokenAindaAutorizado(token);
    } catch (err) {
      log.warn(
        `[pagamento] mp-connect da loja ${conexao.lojaId} não confirmado pelo Mercado Pago (${err.status ?? '-'}, ${err.codigo ?? 'ERRO'}): nada foi desconectado`,
      );
      // A notificação volta a ser processada no reenvio do Mercado Pago (o evento é apagado).
      if (err.codigo === 'SEM_TOKEN') return 'NAO_CONFIRMADO';
      throw err;
    }
    if (autorizado) {
      log.warn(`[pagamento] mp-connect da loja ${conexao.lojaId} ignorado: o token da loja ainda está autorizado no Mercado Pago`);
      return 'TOKEN_AINDA_AUTORIZADO';
    }
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

  /**
   * Notificação de pagamento numa conta que o Taaki conhece mas que está desconectada (sem token):
   * o sistema não consegue conferir nem estornar (ex.: Pix pago depois de a loja desconectar).
   * Alerta para o ADMIN com o id do pagamento, um por pagamento. Conta nunca vista = nada.
   */
  async function avisarContaDesconectada(userId, dataId) {
    const antiga = userId != null ? await conexaoRepo.buscarQualquerPorMpUserId(userId) : null;
    if (!antiga) return 'LOJA_DESCONHECIDA';
    const idPagamento = String(dataId).replace(/[^\w-]/g, '').slice(0, 40);
    const marca = `pagamento ${idPagamento} `;
    if (await prisma.alertaPlataforma.count({ where: { tipo: 'PAGAMENTO_CONTA_DESCONECTADA', mensagem: { contains: marca } } })) {
      return 'CONTA_DESCONECTADA';
    }
    const [loja, nosso] = await Promise.all([lojaRepo.buscarPorId(antiga.lojaId), pagamentoRepo.buscarPorMpPaymentId(idPagamento)]);
    await criarAlerta({
      tipo: 'PAGAMENTO_CONTA_DESCONECTADA',
      lojaId: antiga.lojaId,
      pedidoId: nosso?.pedidoId ?? null,
      mensagem:
        `O Mercado Pago avisou de uma mudança no ${marca}(conta ${antiga.mpUserId}) da loja ${loja?.nome ?? antiga.lojaId}, ` +
        `que está desconectada do Taaki${nosso ? ` (pedido ${nosso.pedidoId})` : ''}. Sem a conexão o sistema não confere nem estorna: ` +
        'confira no Mercado Pago da loja e, se o cliente pagou, combine a devolução com a loja.',
    });
    log.warn(`[pagamento] notificação do pagamento ${idPagamento} numa conta desconectada (loja ${antiga.lojaId}): alerta criado`);
    return 'CONTA_DESCONECTADA';
  }

  async function processarNotificacao({ tipo, acao, dataId, userId }, agora) {
    if (tipo === 'mp-connect') {
      return /deauthoriz/i.test(acao ?? '') ? desvincularConta(userId, agora) : 'IGNORADO';
    }
    if (tipo !== 'payment' || !dataId) return 'IGNORADO';
    const conexao = userId != null ? await conexaoRepo.buscarPorMpUserId(userId) : null;
    if (!conexao?.accessTokenCifrado) return avisarContaDesconectada(userId, dataId);
    const r = await mp.consultarPagamento(decifrar(conexao.accessTokenCifrado, chaveDoAmbiente(env)), dataId);
    let pagamento = await pagamentoRepo.buscarPorMpPaymentId(r.id);
    if (!pagamento && /^\d+$/.test(r.referenciaExterna ?? '')) pagamento = await pagamentoRepo.ultimoDoPedido(Number(r.referenciaExterna));
    if (!pagamento) return 'PAGAMENTO_DESCONHECIDO';
    return conciliar(pagamento, r, { agora, lojaIdDaConta: conexao.lojaId, mpUserIdDaConta: conexao.mpUserId });
  }

  /**
   * Notificação do Mercado Pago. Assinatura inválida = 401. Repetida (mesmo id de notificação)
   * = nada. Senão grava o evento e processa sem a requisição esperar (o Mercado Pago quer 200 rápido).
   * @returns {Promise<{ duplicado: boolean, processamento?: Promise<string> }>}
   */
  async function receberWebhook({ assinatura, requestId, dataIdQuery, corpo }, agora = new Date()) {
    const dataId = dataIdQuery ?? corpo?.data?.id ?? null;
    const segredo = segredoDoWebhook(env);
    if (!validarAssinaturaWebhook({ assinatura, requestId, dataId, segredo, agora })) {
      // Assinatura certa, mas o ts fora dos 10 minutos: aviso com a diferença (para conferir no teste
      // real se uma notificação legítima está sendo recusada). Sem id, corpo nem cabeçalho.
      if (validarAssinaturaWebhook({ assinatura, requestId, dataId, segredo })) {
        const diferenca = diferencaDoTsEmSegundos(assinatura, agora);
        log.warn(
          `[pagamento] webhook recusado: ts fora da janela de ${TOLERANCIA_TS_WEBHOOK_MS / 1000} s ` +
            `(diferença de ${diferenca} s; positiva = notificação no passado)`,
        );
      }
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
          log.warn(`[pagamento] webhook ${evento.id} (${tipo}): ${err.status ?? '-'} ${textoDoErro(err)}`);
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
    gerarCartao,
    gerarPagamento,
    desistirDoPagamento,
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
    // Etapa 5
    cancelarPelaLoja,
    cancelarPeloCliente,
    estornarPeloAdmin,
    estornarPagamentoAtrasado,
    tentarEstornoDeNovo,
    resolverEstornoPorFora,
    listarParaAdmin,
    alertarSemAceite,
  };
}

let padrao;
/** Serviço com o Mercado Pago de verdade (o mesmo para as rotas e o server.js). */
export function pagamentosPadrao() {
  padrao ??= criarServicoPagamentos();
  return padrao;
}
