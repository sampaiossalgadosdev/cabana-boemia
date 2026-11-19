import { buscarConfig } from './api.js';

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
