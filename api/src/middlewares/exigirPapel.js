import { ErroHttp } from '../lib/erros.js';

/** Usar depois de `autenticar`. Ex.: exigirPapel('DONO'). */
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!req.usuario || !papeis.includes(req.usuario.papel)) {
      return next(new ErroHttp(403, 'Sem permissão para esta ação', { codigo: 'SEM_PERMISSAO' }));
    }
    next();
  };
}
