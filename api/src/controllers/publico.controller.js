import * as publicoService from '../services/publico.service.js';

/** @param {() => Date} relogio injetável para testes */
export function criarPublicoController(relogio = () => new Date()) {
  return {
    async cardapio(req, res) {
      res.json(await publicoService.cardapio(relogio()));
    },
    async bairros(req, res) {
      res.json({ bairros: await publicoService.bairros() });
    },
    async config(req, res) {
      res.json(await publicoService.config());
    },
  };
}
