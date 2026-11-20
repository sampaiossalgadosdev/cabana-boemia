import * as publicoService from '../services/publico.service.js';
import * as lojaService from '../services/loja.service.js';
import * as identidadeService from '../services/identidade.service.js';
import { validar } from '../lib/validar.js';
import { idSchema } from './esquemas.js';

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
    /** Imagem (logo) guardada no banco, com o tipo conferido no envio. */
    async imagem(req, res) {
      const { id } = validar(idSchema, req.params);
      const img = await identidadeService.imagem(id);
      res.set({
        'Content-Type': img.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        // O PDV (Electron, outra origem) e o app baixam a logo.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      res.send(img.dados);
    },
    async bairrosDaCidade(req, res) {
      res.json({ bairros: await publicoService.bairrosDaCidade() });
    },
    async config(req, res) {
      res.json(await publicoService.config(req.lojaId));
    },
  };
}
