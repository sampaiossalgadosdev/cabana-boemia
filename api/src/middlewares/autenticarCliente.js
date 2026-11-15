import jwt from 'jsonwebtoken';
import { ErroHttp } from '../lib/erros.js';
import { verificarTokenCliente } from '../lib/tokens.js';
import { buscarPorId } from '../repositories/cliente.repository.js';
import { clientePublico, garantirTelefone } from '../services/cliente.service.js';

/**
 * Exige `Authorization: Bearer <token do cliente>`. O token da equipe não
 * serve (outro segredo e outro audience). Busca o cliente no banco a cada
 * requisição e preenche `req.cliente`.
 */
export async function autenticarCliente(req, res, next) {
  try {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new ErroHttp(401, 'Entre com sua conta Google para continuar', { codigo: 'NAO_AUTENTICADO' });
    }

    let payload;
    try {
      payload = verificarTokenCliente(token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ErroHttp(401, 'Sessão expirada. Entre de novo.', { codigo: 'TOKEN_EXPIRADO' });
      }
      throw new ErroHttp(401, 'Token inválido', { codigo: 'TOKEN_INVALIDO' });
    }

    const cliente = await buscarPorId(Number(payload.sub));
    if (!cliente) {
      throw new ErroHttp(401, 'Sessão inválida. Entre de novo.', { codigo: 'NAO_AUTENTICADO' });
    }

    req.cliente = clientePublico(cliente);
    next();
  } catch (err) {
    next(err);
  }
}

/** Usar depois de `autenticarCliente` na rota que cria pedido do site. */
export function exigirTelefoneCliente(req, res, next) {
  try {
    garantirTelefone(req.cliente);
    next();
  } catch (err) {
    next(err);
  }
}
