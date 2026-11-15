import { buscarConfig } from './api.js';

/** GET /publico/config uma vez por página ({ nome, whatsapp, googleClientId }); falha permite tentar de novo. */
let promessa = null;
export function obterConfig() {
  promessa ??= buscarConfig().catch((err) => {
    promessa = null;
    throw err;
  });
  return promessa;
}
