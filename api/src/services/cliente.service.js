import { prisma } from '../lib/prisma.js';
import { ErroHttp, ehDuplicado } from '../lib/erros.js';
import { gerarTokenCliente, gerarRefreshTokenCliente, hashRefreshTokenCliente } from '../lib/tokens.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as refreshRepo from '../repositories/refreshTokenCliente.repository.js';
import { DOCUMENTOS_APP, precisaAceite } from '../lib/controlador.js';
import { normalizarIp } from './registroAcesso.service.js';

const NOME_MAX = 100;

/**
 * Janela de "pedido em andamento" na exclusão da conta: pedido nem cancelado
 * nem finalizado
 * criado há menos que isto bloqueia (a loja ainda precisa do endereço e do
 * telefone). Não depende do PDV finalizar: passado o prazo, a exclusão vale.
 */
export const JANELA_PEDIDO_EM_ANDAMENTO_MS = 3 * 60 * 60 * 1000;

/** Dados do cliente devolvidos ao site e ao app. */
export function clientePublico(c) {
  return {
    id: c.id,
    nome: c.nome,
    email: c.email,
    telefone: c.telefone,
    precisaTelefone: !c.telefone,
    // Login com celular: telefone confirmado por código; quem entrou só pelo
    // celular ainda não tem nome (o app pede logo depois do login).
    telefoneVerificado: Boolean(c.telefoneVerificado),
    precisaNome: !c.nome?.trim(),
    // App: termos/política aceitos (versão atual?) e marketing (opcional). O site ignora.
    termosVersao: c.termosVersao ?? null,
    precisaAceite: precisaAceite(c.termosVersao ?? null),
    marketing: Boolean(c.marketing),
  };
}

const versaoDesatualizada = () =>
  new ErroHttp(409, 'Os termos foram atualizados. Leia a versão nova e aceite de novo.', {
    codigo: 'VERSAO_DESATUALIZADA',
    detalhes: { versao: DOCUMENTOS_APP.versao },
  });

/**
 * Aceite dos termos de uso e da política de privacidade do app. Só vale a
 * versão atual (o app mostra a versão que leu: outra = 409 VERSAO_DESATUALIZADA).
 * Repetir o aceite da mesma versão não grava de novo.
 */
export async function aceitarTermos(clienteId, { versao, ip, agora = new Date() }) {
  if (versao !== DOCUMENTOS_APP.versao) throw versaoDesatualizada();
  const atual = await clienteRepo.buscarPorId(clienteId);
  if (!atual) throw new ErroHttp(404, 'Conta não encontrada', { codigo: 'NAO_ENCONTRADO' });
  if (atual.termosVersao === versao) return clientePublico(atual);
  return clientePublico(await clienteRepo.registrarAceite(clienteId, { versao, ip: normalizarIp(ip), agora }));
}

/** Marketing opcional (Perfil › Comunicações). Mesma escolha de antes = nada gravado. */
export async function definirMarketing(clienteId, { aceito, ip, agora = new Date() }) {
  const atual = await clienteRepo.buscarPorId(clienteId);
  if (!atual) throw new ErroHttp(404, 'Conta não encontrada', { codigo: 'NAO_ENCONTRADO' });
  if (atual.marketing === aceito) return clientePublico(atual);
  return clientePublico(await clienteRepo.registrarMarketing(clienteId, { aceito, ip: normalizarIp(ip), agora }));
}

/**
 * Login do app com o aceite marcado na tela de entrada (`aceite` = versão lida).
 * Versão antiga é ignorada aqui (o app pede o aceite de novo, `precisaAceite`).
 */
async function aceiteNoLogin(resposta, aceite, ip) {
  if (!aceite || aceite !== DOCUMENTOS_APP.versao || !resposta.cliente.precisaAceite) return resposta;
  return { ...resposta, cliente: await aceitarTermos(resposta.cliente.id, { versao: aceite, ip }) };
}

const nomeInicial = (nome, email) => (nome?.trim() || email?.split('@')[0] || 'Cliente').slice(0, NOME_MAX);

/**
 * Resposta de login. O site não pede refresh (`comRefresh` falso) e recebe
 * só `{ token, cliente }`, como sempre; o app pede e recebe também o
 * `refreshToken` (60 dias, rotativo).
 */
async function sessao(cliente, comRefresh, db = prisma) {
  const resposta = { token: gerarTokenCliente(cliente), cliente: clientePublico(cliente) };
  if (comRefresh) {
    const r = gerarRefreshTokenCliente();
    await refreshRepo.criar({ clienteId: cliente.id, hash: r.hash, expiraEm: r.expiraEm }, db);
    resposta.refreshToken = r.token;
  }
  return resposta;
}

/**
 * Login com Google. `identidade` vem do verificador (token já validado).
 * Cliente novo nasce com nome/email do Google; existente só tem o email
 * atualizado (o nome pode ter sido editado por ele e não é sobrescrito).
 */
export async function entrarComGoogle({ googleId, email, nome }, { comRefresh = false, aceite, ip } = {}) {
  const cliente = await clienteRepo.upsertPorGoogleId(googleId, {
    criar: { nome: nomeInicial(nome, email), email },
    atualizar: email ? { email } : {},
  });
  return aceiteNoLogin(await sessao(cliente, comRefresh), aceite, ip);
}

/**
 * Entrar com Apple (app iOS). A Apple só manda o nome no PRIMEIRO login, e
 * pelo app (não vem no token): `nome` vale só na criação. O e-mail pode ser o
 * de retransmissão da Apple (privaterelay.appleid.com). Conta separada da do
 * Google, mesmo com o mesmo e-mail (não há fusão de contas).
 */
export async function entrarComApple({ appleId, email }, { nome, comRefresh = false, aceite, ip } = {}) {
  const cliente = await clienteRepo.upsertPorAppleId(appleId, {
    criar: { nome: nomeInicial(nome, email), email },
    atualizar: email ? { email } : {},
  });
  return aceiteNoLogin(await sessao(cliente, comRefresh), aceite, ip);
}

/**
 * Login com celular (o código já foi conferido pelo verificador).
 * `telefone` = 11 dígitos, como o banco guarda. Conta de quem tem o telefone:
 * a que já o verificou; senão a mais antiga com esse telefone (cadastro do
 * PDV ou do site), que passa a ter o telefone verificado; senão uma conta
 * nova, sem nome (o app pede), com o telefone verificado. Mesma sessão do
 * Google/Apple (refresh rotativo no app) e o mesmo aceite no login.
 */
export async function entrarComTelefone(telefone, { comRefresh = false, aceite, ip, agora = new Date() } = {}) {
  const achar = async () => {
    const existente = await clienteRepo.buscarParaLoginPorTelefone(telefone);
    if (!existente) return clienteRepo.criarComTelefoneVerificado(telefone, agora);
    if (existente.telefoneVerificado) return existente;
    return clienteRepo.marcarTelefoneVerificado(existente.id, agora);
  };
  let cliente;
  try {
    cliente = await achar();
  } catch (err) {
    // Dois logins do mesmo número ao mesmo tempo: o índice único deixou só um
    // verificar; o outro entra na conta que venceu.
    if (!ehDuplicado(err)) throw err;
    cliente = await achar();
  }
  return aceiteNoLogin(await sessao(cliente, comRefresh), aceite, ip);
}

/** Trocou o telefone: o novo ainda não foi confirmado por código. */
export const desfazVerificacaoSeMudou = (atual, telefoneNovo) =>
  telefoneNovo !== undefined && telefoneNovo !== atual?.telefone ? { telefoneVerificado: false, telefoneVerificadoEm: null } : {};

const refreshInvalido = () =>
  new ErroHttp(401, 'Sessão expirada. Entre de novo.', { codigo: 'REFRESH_INVALIDO' });
const refreshReutilizado = () =>
  new ErroHttp(401, 'Sessão encerrada por segurança. Entre de novo.', { codigo: 'REFRESH_REUTILIZADO' });

/**
 * Troca o refresh do app por um token novo + refresh novo (o usado é revogado).
 * Refresh já revogado apresentado de novo = possível roubo: revoga todos do cliente.
 */
export async function renovarSessao(refreshToken, agora = new Date()) {
  const registro = await refreshRepo.buscarPorHash(hashRefreshTokenCliente(refreshToken));
  if (!registro) throw refreshInvalido();
  if (registro.revogadoEm) {
    await refreshRepo.revogarTodosDoCliente(registro.clienteId);
    throw refreshReutilizado();
  }
  if (registro.expiraEm <= agora) throw refreshInvalido();

  const resultado = await prisma.$transaction(async (tx) => {
    if ((await refreshRepo.revogarSeAtivo(registro.id, tx)) === 0) return null; // outra requisição girou antes
    return sessao(registro.cliente, true, tx);
  });
  if (!resultado) {
    await refreshRepo.revogarTodosDoCliente(registro.clienteId);
    throw refreshReutilizado();
  }
  return resultado;
}

/** Sair no app: revoga o refresh. Idempotente (desconhecido ou já revogado = sucesso). */
export async function sair(refreshToken) {
  await refreshRepo.revogarPorHash(hashRefreshTokenCliente(refreshToken));
}

export async function atualizarPerfil(clienteId, { nome, telefone }) {
  const atual = await clienteRepo.buscarPorId(clienteId);
  if (!atual) throw new ErroHttp(404, 'Conta não encontrada', { codigo: 'NAO_ENCONTRADO' });
  return clientePublico(
    await clienteRepo.atualizar(clienteId, { nome, telefone, ...desfazVerificacaoSeMudou(atual, telefone) }),
  );
}

/**
 * Regra do checkout: sem telefone (ou sem nome, de quem entrou só pelo
 * celular) não faz pedido: a loja precisa dos dois. Usar antes de criar pedido do site.
 */
export function garantirTelefone(cliente) {
  if (!cliente?.telefone) {
    throw new ErroHttp(422, 'Informe seu telefone para continuar', { codigo: 'TELEFONE_OBRIGATORIO' });
  }
  if (!cliente.nome?.trim()) {
    throw new ErroHttp(422, 'Informe seu nome para continuar', { codigo: 'NOME_OBRIGATORIO' });
  }
}

/**
 * Exclusão da conta (Google Play e App Store exigem dentro do app).
 * Com pedido em andamento (nem cancelado nem finalizado, criado nas últimas 3
 * horas; depois disso libera mesmo que o PDV não finalize), recusa: o restaurante ainda precisa do endereço e
 * do telefone para entregar. Apaga cliente, endereços e refresh tokens;
 * pedidos ficam anonimizados. Conta da Apple: revoga o login na Apple quando
 * as credenciais existem (APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY) e o app mandou o
 * authorization code; falha na Apple não impede a exclusão.
 * @param {{ appleAuthorizationCode?: string, revogarApple?: (code: string) => Promise<{ revogado: boolean, motivo?: string }>, agora?: Date }} [opcoes]
 */
export async function excluirConta(clienteId, { appleAuthorizationCode, revogarApple, agora = new Date() } = {}) {
  const cliente = await clienteRepo.buscarPorId(clienteId);
  if (!cliente) throw new ErroHttp(404, 'Conta não encontrada', { codigo: 'NAO_ENCONTRADO' });

  const desde = new Date(agora.getTime() - JANELA_PEDIDO_EM_ANDAMENTO_MS);
  if ((await clienteRepo.contarPedidosRecentes(clienteId, desde)) > 0) {
    throw new ErroHttp(
      409,
      'Você tem um pedido em andamento. A exclusão da conta fica liberada quando ele for entregue ou 3 horas depois do pedido.',
      { codigo: 'PEDIDO_EM_ANDAMENTO' },
    );
  }

  const { pedidosAnonimizados } = await clienteRepo.excluirComAnonimizacao(clienteId);

  let apple = null;
  if (cliente.appleId && revogarApple) {
    apple = await revogarApple(appleAuthorizationCode);
    if (!apple.revogado) console.warn(`Exclusão de conta: login da Apple não revogado (${apple.motivo}).`);
  }
  return { pedidosAnonimizados, apple };
}
