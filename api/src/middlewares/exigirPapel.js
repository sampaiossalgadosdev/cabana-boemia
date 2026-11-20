import { ErroHttp } from '../lib/erros.js';

/**
 * O usuário tem um dos papéis? ADMIN (plataforma) está acima do DONO: passa em
 * tudo que o DONO passa (não em rota só de ATENDENTE, que não existe).
 */
export function temPapel(papel, papeis) {
  return papeis.includes(papel) || (papel === 'ADMIN' && papeis.includes('DONO'));
}

/** Usar depois de `autenticar`. Ex.: exigirPapel('DONO'). */
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!req.usuario || !temPapel(req.usuario.papel, papeis)) {
      return next(new ErroHttp(403, 'Sem permissão para esta ação', { codigo: 'SEM_PERMISSAO' }));
    }
    next();
  };
}
