import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { validar } from '../lib/validar.js';
import { ErroHttp } from '../lib/erros.js';
import { mapasPadrao, textoParaGeocodificar } from '../services/mapa.service.js';
import * as enderecoRepo from '../repositories/endereco.repository.js';

const geocodificarClienteSchema = z.object({
  rua: z.string({ error: 'Informe a rua' }).trim().min(1, 'Informe a rua').max(120),
  numero: z.string({ error: 'Informe o número' }).trim().min(1, 'Informe o número').max(20),
  bairroId: z.number({ error: 'Escolha o bairro' }).int().positive(),
});

const geocodificarTextoSchema = z.object({
  texto: z.string({ error: 'Digite o endereço' }).trim().min(3, 'Digite o endereço').max(300),
});

/**
 * Limite de buscas no mapa por pessoa (além do limite diário do servidor):
 * protege a cota de quem fica apertando "buscar". Memória da instância.
 * @param {(req) => string} chave
 */
export function criarLimitadorMapa({ limite = 30, janelaMs = 60 * 60 * 1000, chave }) {
  return rateLimit({
    windowMs: janelaMs,
    limit: limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: chave,
    handler: (req, res) => {
      res.status(429).json({
        erro: { mensagem: 'Muitas buscas no mapa. Posicione o pino à mão ou aguarde um pouco.', codigo: 'MUITAS_TENTATIVAS' },
      });
    },
  });
}

/** Resposta da busca: pino (ou null) e o motivo; a chave do servidor nunca sai daqui. */
const resposta = (r) => ({ pin: r.pin, aproximado: r.aproximado, motivo: r.motivo });

/** @param {ReturnType<typeof mapasPadrao>} [mapas] */
export function criarMapaController(mapas = mapasPadrao()) {
  return {
    /** Cliente (app): rua + número + bairro da cidade → pino. */
    async geocodificarEndereco(req, res) {
      const d = validar(geocodificarClienteSchema, req.body ?? {});
      const bairro = await enderecoRepo.buscarBairro(d.bairroId);
      if (!bairro || !bairro.ativo) throw new ErroHttp(422, 'Bairro não encontrado', { codigo: 'BAIRRO_INVALIDO' });
      res.json(resposta(await mapas.geocodificar(textoParaGeocodificar({ ...d, bairroNome: bairro.nome }))));
    },

    /** Retaguarda/plataforma: endereço da loja em texto livre → pino. */
    async geocodificarTexto(req, res) {
      const { texto } = validar(geocodificarTextoSchema, req.body ?? {});
      res.json(resposta(await mapas.geocodificar(texto)));
    },

    /** Mapa da retaguarda: chave do Maps JavaScript (restrita aos domínios de /admin) e o centro. */
    configWeb(req, res) {
      res.json({ chaveWeb: mapas.config.chaveWeb || null, centro: mapas.config.centro, busca: mapas.ativo });
    },

    /** ADMIN: chamadas ao Google por dia (últimos 30), com os limites. */
    async uso(req, res) {
      res.json(await mapas.uso());
    },
  };
}
