import { buscarConfig, buscarDadosDoApp } from './api.js';
import { dadosDaPlataforma } from '../logica/plataforma.js';

/**
 * GET /publico/config uma vez por abertura do app ({ nome, whatsapp,
 * googleClientId, freteGratis }); falha permite tentar de novo.
 */
let promessa = null;
export function obterConfig() {
  promessa ??= buscarConfig().catch((err) => {
    promessa = null;
    throw err;
  });
  return promessa;
}

/**
 * GET /publico/app (dados da plataforma e versão dos termos/política). Uma vez
 * por abertura; `forcar` busca de novo (ex.: a API disse que a versão mudou).
 * Falha = rejeita (quem chama decide o que fazer sem a versão).
 */
let promessaApp = null;
export function obterDadosDoApp({ forcar = false } = {}) {
  if (forcar) promessaApp = null;
  promessaApp ??= buscarDadosDoApp()
    .then(dadosDaPlataforma)
    .catch((err) => {
      promessaApp = null;
      throw err;
    });
  return promessaApp;
}
