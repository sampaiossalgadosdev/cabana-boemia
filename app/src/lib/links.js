import { BASE } from './api.js';

/** Raiz do servidor (sem /api). */
export const SERVIDOR = BASE.replace(/\/api$/, '');

/**
 * Páginas públicas do app, servidas pela API em nome da plataforma (não as
 * /privacidade e /termos do site, que são da Cabana Boemia).
 */
export const URL_PRIVACIDADE = `${SERVIDOR}/privacidade-app`;
export const URL_TERMOS = `${SERVIDOR}/termos-app`;
export const URL_EXCLUIR_CONTA = `${SERVIDOR}/excluir-conta`;
