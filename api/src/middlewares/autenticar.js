import jwt from 'jsonwebtoken';
import { ErroHttp } from '../lib/erros.js';
import { verificarAccessToken } from '../lib/tokens.js';
import { buscarPorId } from '../repositories/usuario.repository.js';
import { usuarioPublico } from '../services/auth.service.js';

/**
 * Exige `Authorization: Bearer <accessToken>`. Busca o usuário no banco a cada
 * requisição: desativar um atendente corta o acesso na hora, e o papel vem do
 * banco, não do token. Preenche `req.usuario` e `req.lojaDoUsuario`.
 */
export async function autenticar(req, res, next) {
  try {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new ErroHttp(401, 'Login necessário', { codigo: 'NAO_AUTENTICADO' });
    }

    let payload;
    try {
      payload = verificarAccessToken(token);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ErroHttp(401, 'Token expirado', { codigo: 'TOKEN_EXPIRADO' });
      }
      throw new ErroHttp(401, 'Token inválido', { codigo: 'TOKEN_INVALIDO' });
    }

    const usuario = await buscarPorId(Number(payload.sub));
    if (!usuario || !usuario.ativo) {
      throw new ErroHttp(401, 'Usuário sem acesso', { codigo: 'NAO_AUTENTICADO' });
    }

    req.usuario = usuarioPublico(usuario);
    // Loja do cadastro (null = ADMIN); `lojaDaEquipe` resolve `req.lojaId` a partir dela.
    req.lojaDoUsuario = usuario.lojaId ?? null;
    next();
  } catch (err) {
    next(err);
  }
}
