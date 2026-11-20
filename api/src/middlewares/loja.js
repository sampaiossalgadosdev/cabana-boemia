import { buscarAtivaPorSlug, lojaDoUsuario, lojaPadraoId } from '../services/loja.service.js';

/** Cabeçalho com que o ADMIN informa a loja (slug ou id) nas rotas da equipe/retaguarda. */
export const CABECALHO_LOJA = 'x-loja';

/**
 * Usar depois de `autenticar`: `req.lojaId` = loja do usuário da equipe.
 * DONO/ATENDENTE: a do cadastro (X-Loja de outra loja = 403 LOJA_PROIBIDA).
 * ADMIN: a do X-Loja (slug ou id; inexistente = 404), senão a padrão. Todo dado
 * lido ou gravado pelas rotas da equipe, da retaguarda e de usuários fica nela.
 */
export async function lojaDaEquipe(req, res, next) {
  try {
    req.lojaId = await lojaDoUsuario(
      { lojaId: req.lojaDoUsuario ?? null, papel: req.usuario?.papel },
      req.get(CABECALHO_LOJA) ?? null,
    );
    next();
  } catch (err) {
    next(err);
  }
}

/** Rotas antigas do site (/publico/cardapio etc.) e do cliente sem loja: a loja padrão (Cabana Boemia). */
export async function lojaDoSite(req, res, next) {
  try {
    req.lojaId = await lojaPadraoId();
    next();
  } catch (err) {
    next(err);
  }
}

/** Rotas /publico/lojas/:slug/...: a loja ATIVA do slug (inexistente ou inativa = 404 LOJA_NAO_ENCONTRADA). */
export async function lojaDoSlug(req, res, next) {
  try {
    req.lojaId = (await buscarAtivaPorSlug(req.params.slug)).id;
    next();
  } catch (err) {
    next(err);
  }
}
