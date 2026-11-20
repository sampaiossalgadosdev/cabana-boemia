import { lojaDoUsuario, lojaPadraoId } from '../services/loja.service.js';

/**
 * Usar depois de `autenticar`: `req.lojaId` = loja do usuário da equipe
 * (DONO/ATENDENTE: a do cadastro; ADMIN: a padrão, por enquanto). Todo dado
 * lido ou gravado pelas rotas da equipe, da retaguarda e de usuários fica nela.
 */
export async function lojaDaEquipe(req, res, next) {
  try {
    req.lojaId = await lojaDoUsuario({ lojaId: req.lojaDoUsuario ?? null });
    next();
  } catch (err) {
    next(err);
  }
}

/** Rotas do site/app (públicas e do cliente): por enquanto, sempre a loja padrão (Cabana Boemia). */
export async function lojaDoSite(req, res, next) {
  try {
    req.lojaId = await lojaPadraoId();
    next();
  } catch (err) {
    next(err);
  }
}
