import { ErroHttp } from '../lib/erros.js';
import { gerarTokenCliente } from '../lib/tokens.js';
import * as clienteRepo from '../repositories/cliente.repository.js';

const NOME_MAX = 100;

/** Dados do cliente devolvidos ao site. */
export function clientePublico(c) {
  return {
    id: c.id,
    nome: c.nome,
    email: c.email,
    telefone: c.telefone,
    precisaTelefone: !c.telefone,
  };
}

/**
 * Login do site. `identidade` vem do verificador do Google (token já validado).
 * Cliente novo nasce com nome/email do Google; existente só tem o email
 * atualizado (o nome pode ter sido editado por ele e não é sobrescrito).
 */
export async function entrarComGoogle({ googleId, email, nome }) {
  const nomeInicial = (nome || email?.split('@')[0] || 'Cliente').slice(0, NOME_MAX);
  const cliente = await clienteRepo.upsertPorGoogleId(googleId, {
    criar: { nome: nomeInicial, email },
    atualizar: email ? { email } : {},
  });
  return { token: gerarTokenCliente(cliente), cliente: clientePublico(cliente) };
}

export async function atualizarPerfil(clienteId, { nome, telefone }) {
  return clientePublico(await clienteRepo.atualizar(clienteId, { nome, telefone }));
}

/** Regra do checkout: sem telefone não faz pedido. Usar antes de criar pedido do site. */
export function garantirTelefone(cliente) {
  if (!cliente?.telefone) {
    throw new ErroHttp(422, 'Informe seu telefone para continuar', { codigo: 'TELEFONE_OBRIGATORIO' });
  }
}
