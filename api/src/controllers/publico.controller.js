import * as publicoService from '../services/publico.service.js';
import * as lojaService from '../services/loja.service.js';

/** @param {() => Date} relogio injetável para testes */
export function criarPublicoController(relogio = () => new Date()) {
  return {
    /** Vitrine: lojas ativas com identidade, aberta agora e próxima abertura. */
    async lojas(req, res) {
      res.json({ lojas: await lojaService.listarPublicas(relogio()) });
    },
    async cardapio(req, res) {
      res.json(await publicoService.cardapio(req.lojaId, relogio()));
    },
    async bairros(req, res) {
      res.json({ bairros: await publicoService.bairros(req.lojaId) });
    },
    async config(req, res) {
      res.json(await publicoService.config(req.lojaId));
    },
  };
}
