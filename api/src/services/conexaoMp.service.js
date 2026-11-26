/**
 * Conexão da loja com a conta Mercado Pago dela (OAuth, Split 1:1). Etapa 3 de
 * docs/pagamento-online.md. Toda chamada ao Mercado Pago passa por lib/mercadoPago.js.
 *
 * - conectar: monta a URL de autorização com o state assinado (loja, usuário, origem, 10 min);
 * - retorno: confere o state, troca o code, grava os tokens CIFRADOS e volta para a retaguarda;
 *   a mesma conta CONECTADA/EXPIRADA em outra loja é recusada;
 * - desconectar: avisa os pagamentos pendentes; confirmado, apaga os tokens, marca DESCONECTADA e
 *   desliga o pagamento online da loja (a Etapa 4 cancela ali os Pix pendentes);
 * - renovação diária: vence em menos de 30 dias = renova e grava o refresh NOVO; falhou = EXPIRADA,
 *   pagamento online desligado e alerta para o ADMIN.
 *
 * Nunca registra token nem code em log (só a loja, o status HTTP e o código do Mercado Pago).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { cifrar, decifrar, chaveDoAmbiente } from '../lib/cifra.js';
import { criarClienteMercadoPago, ErroMercadoPago } from '../lib/mercadoPago.js';
import { criarState, lerState, origemPermitida, urlDeRetorno } from '../lib/estadoOauth.js';
import { faltasParaConectar, pagamentoOnlineLigado } from '../lib/pagamentoOnline.js';
import { ehProducao } from '../lib/verificadorTelefone.js';
import * as conexaoRepo from '../repositories/conexaoMp.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { criarAlerta } from './alerta.service.js';

/** Renova quem vence em menos disto. */
export const ANTECEDENCIA_RENOVACAO_MS = 30 * 24 * 60 * 60 * 1000;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Ponto da Etapa 4 (Decisão 17): ao desconectar, cancelar no Mercado Pago os Pix pendentes da
 * loja e expirar os pedidos AGUARDANDO_PAGAMENTO, na mesma transação. Na Etapa 3 ainda não há
 * Pix real: só conta os pendentes.
 */
export async function cancelarPendentesDaLoja(lojaId, tx) {
  return { cancelados: 0, pendentes: await conexaoRepo.contarPagamentosPendentes(lojaId, tx) };
}

/**
 * @param {{ mercadoPago?: ReturnType<typeof criarClienteMercadoPago>, env?: object, log?: Pick<Console, 'warn'> }} [opcoes]
 */
export function criarServicoConexaoMp({ mercadoPago, env = process.env, log = console } = {}) {
  const mp = mercadoPago ?? criarClienteMercadoPago();
  const producao = () => ehProducao(env);
  const chave = () => chaveDoAmbiente(env);

  function exigirConfigurado() {
    const faltas = faltasParaConectar(env);
    if (faltas.length) {
      throw new ErroHttp(503, 'O pagamento online ainda não está configurado no servidor. Fale com o Taaki Delivery.', {
        codigo: 'PAGAMENTO_ONLINE_NAO_CONFIGURADO',
      });
    }
  }

  async function situacao(lojaId) {
    const [loja, conexao, pendentes] = await Promise.all([
      lojaRepo.buscarPorId(lojaId),
      conexaoRepo.buscarDaLoja(lojaId),
      conexaoRepo.contarPagamentosPendentes(lojaId),
    ]);
    const status = conexao?.status ?? 'NAO_CONECTADA';
    return {
      situacao: status === 'DESCONECTADA' ? 'NAO_CONECTADA' : status,
      conta: status === 'CONECTADA' || status === 'EXPIRADA' ? conexao.mpUserId : null,
      conectadaEm: status === 'DESCONECTADA' ? null : (conexao?.conectadaEm ?? null),
      expiraEm: status === 'CONECTADA' ? (conexao.expiraEm ?? null) : null,
      pagamentoOnlineAtivo: Boolean(loja?.pagamentoOnlineAtivo),
      flagGlobal: pagamentoOnlineLigado(env),
      configurado: faltasParaConectar(env).length === 0,
      pendentes,
    };
  }

  /** URL de autorização do Mercado Pago para a loja (o usuário já foi conferido pelo middleware). */
  function urlParaConectar(lojaId, usuarioId, origem, agora = new Date()) {
    exigirConfigurado();
    const state = criarState({ lojaId, usuarioId, origem: origemPermitida(origem, { producao: producao() }) }, env.MP_STATE_SECRET, agora);
    return mp.montarUrlAutorizacao(state);
  }

  /** O usuário do state ainda pode mexer nesta loja? (desativado ou trocado de loja = não) */
  async function usuarioAindaPode(usuarioId, lojaId) {
    const u = await usuarioRepo.buscarPorId(usuarioId);
    return Boolean(u?.ativo) && (u.papel === 'ADMIN' || (u.papel === 'DONO' && u.lojaId === lojaId));
  }

  /**
   * Retorno do Mercado Pago. Nunca lança: devolve a URL para onde redirecionar, com
   * `mp=conectada` ou `mp=erro&motivo=…`.
   * @param {{ code?: string, state?: string, erro?: string }} retorno
   */
  async function concluir({ code, state, erro }, agora = new Date()) {
    const lido = lerState(state, String(env.MP_STATE_SECRET ?? ''), agora);
    const voltar = (parametros) => urlDeRetorno(lido.origem, parametros, { producao: producao() });
    const falha = (motivo) => voltar({ mp: 'erro', motivo });
    if (!lido.ok) return falha(lido.motivo);
    if (faltasParaConectar(env).length) return falha('NAO_CONFIGURADO');
    if (erro || !code) return falha('AUTORIZACAO_NEGADA');
    const { lojaId, usuarioId } = lido;
    if (!(await lojaRepo.buscarPorId(lojaId)) || !(await usuarioAindaPode(usuarioId, lojaId))) return falha('SEM_PERMISSAO');

    let token;
    try {
      token = await mp.trocarCodePorToken(String(code), agora);
    } catch (err) {
      if (!(err instanceof ErroMercadoPago)) throw err;
      log.warn(`[mercadopago] loja ${lojaId}: troca do code falhou (status ${err.status ?? '-'}, ${err.codigo ?? '-'})`);
      return falha('TROCA_FALHOU');
    }
    if (await conexaoRepo.contaEmOutraLoja(token.mpUserId, lojaId)) return falha('CONTA_EM_OUTRA_LOJA');
    try {
      await conexaoRepo.gravarConectada(lojaId, {
        mpUserId: token.mpUserId,
        accessTokenCifrado: cifrar(token.accessToken, chave()),
        refreshTokenCifrado: token.refreshToken ? cifrar(token.refreshToken, chave()) : null,
        publicKey: token.publicKey,
        expiraEm: token.expiraEm,
        conectadaEm: agora,
      });
    } catch (err) {
      // Duas lojas conectando a mesma conta ao mesmo tempo: o índice parcial barra a segunda.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return falha('CONTA_EM_OUTRA_LOJA');
      throw err;
    }
    return voltar({ mp: 'conectada' });
  }

  /**
   * Sem `confirmar`: só a contagem dos pagamentos pendentes (para o aviso). Confirmado: cancela os
   * pendentes (Etapa 4), apaga os tokens, marca DESCONECTADA e desliga o pagamento online.
   */
  async function desconectar(lojaId, { confirmar = false } = {}) {
    const conexao = await conexaoRepo.buscarDaLoja(lojaId);
    if (!conexao || conexao.status === 'DESCONECTADA') {
      throw new ErroHttp(409, 'A loja não está conectada ao Mercado Pago', { codigo: 'MP_NAO_CONECTADO' });
    }
    if (!confirmar) return { desconectada: false, pendentes: await conexaoRepo.contarPagamentosPendentes(lojaId) };
    await prisma.$transaction(async (tx) => {
      await cancelarPendentesDaLoja(lojaId, tx);
      await conexaoRepo.atualizar(
        lojaId,
        { status: 'DESCONECTADA', accessTokenCifrado: null, refreshTokenCifrado: null, publicKey: null, expiraEm: null },
        tx,
      );
      await conexaoRepo.definirPagamentoOnlineAtivo(lojaId, false, tx);
    });
    return { desconectada: true, pendentes: 0 };
  }

  /** Liga/desliga o pagamento online da loja. Ligar exige a flag global e a conexão CONECTADA. */
  async function definirAtivo(lojaId, ativo) {
    if (ativo) {
      if (!pagamentoOnlineLigado(env)) {
        throw new ErroHttp(409, 'O pagamento online ainda não foi liberado pelo Taaki Delivery.', { codigo: 'PAGAMENTO_ONLINE_DESLIGADO' });
      }
      if ((await conexaoRepo.buscarDaLoja(lojaId))?.status !== 'CONECTADA') {
        throw new ErroHttp(409, 'Conecte a conta Mercado Pago da loja antes de ligar o pagamento online.', { codigo: 'MP_NAO_CONECTADO' });
      }
    }
    await conexaoRepo.definirPagamentoOnlineAtivo(lojaId, Boolean(ativo));
  }

  async function marcarExpirada(conexao, motivo, agora) {
    const loja = await lojaRepo.buscarPorId(conexao.lojaId);
    log.warn(`[mercadopago] loja ${conexao.lojaId}: renovação do token falhou (${motivo}); conexão EXPIRADA`);
    await prisma.$transaction(async (tx) => {
      await conexaoRepo.atualizar(conexao.lojaId, { status: 'EXPIRADA' }, tx);
      await conexaoRepo.definirPagamentoOnlineAtivo(conexao.lojaId, false, tx);
      await criarAlerta(
        {
          tipo: 'RENOVACAO_MP_FALHOU',
          lojaId: conexao.lojaId,
          mensagem:
            `A conexão do Mercado Pago da loja ${loja?.nome ?? conexao.lojaId} não renovou (${motivo}) em ` +
            `${agora.toISOString().slice(0, 10)}. O pagamento online da loja foi desligado: o dono precisa ` +
            'conectar de novo em "Pagamento online".',
        },
        tx,
      );
    });
  }

  /** Renova as conexões que vencem em menos de 30 dias. Devolve quantas renovou e quantas falharam. */
  async function renovarVencendo(agora = new Date()) {
    let renovadas = 0;
    let falharam = 0;
    for (const conexao of await conexaoRepo.vencendoAte(new Date(agora.getTime() + ANTECEDENCIA_RENOVACAO_MS))) {
      let token;
      try {
        if (!conexao.refreshTokenCifrado) throw new ErroMercadoPago('sem refresh token', { codigo: 'SEM_REFRESH_TOKEN' });
        token = await mp.renovarToken(decifrar(conexao.refreshTokenCifrado, chave()), agora);
      } catch (err) {
        const motivo = err instanceof ErroMercadoPago ? `${err.status ?? '-'} ${err.codigo ?? 'sem código'}` : 'token ilegível';
        await marcarExpirada(conexao, motivo, agora);
        falharam += 1;
        continue;
      }
      // Sempre o refresh NOVO (o Mercado Pago gira o refresh token a cada renovação).
      await conexaoRepo.atualizar(conexao.lojaId, {
        accessTokenCifrado: cifrar(token.accessToken, chave()),
        refreshTokenCifrado: token.refreshToken ? cifrar(token.refreshToken, chave()) : conexao.refreshTokenCifrado,
        publicKey: token.publicKey ?? conexao.publicKey,
        expiraEm: token.expiraEm,
      });
      renovadas += 1;
    }
    return { renovadas, falharam };
  }

  /** Roda ao iniciar e a cada 24 h (timer `unref`). Sem configuração, não roda. Devolve o "parar". */
  function iniciarRenovacaoDiaria() {
    if (faltasParaConectar(env).length) return () => {};
    const rodar = () =>
      renovarVencendo().then(
        (r) => r.renovadas + r.falharam && log.warn(`[mercadopago] renovação diária: ${r.renovadas} renovada(s), ${r.falharam} falha(s)`),
        (err) => log.warn(`[mercadopago] renovação diária falhou: ${err?.message ?? err}`),
      );
    rodar();
    const timer = setInterval(rodar, UM_DIA_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { situacao, urlParaConectar, concluir, desconectar, definirAtivo, renovarVencendo, iniciarRenovacaoDiaria };
}

let padrao;
/** Serviço com o Mercado Pago de verdade (o mesmo para as rotas e o server.js). */
export function conexaoMpPadrao() {
  padrao ??= criarServicoConexaoMp();
  return padrao;
}
