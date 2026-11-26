import { z } from 'zod';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { validar } from '../lib/validar.js';
import { conexaoMpPadrao } from '../services/conexaoMp.service.js';

const conectarSchema = z.object({ origem: z.string().max(200).nullish() });
const desconectarSchema = z.object({ confirmar: z.boolean().optional() });
const ativoSchema = z.object({ ativo: z.boolean({ error: 'Informe se o pagamento online fica ligado' }) });

/**
 * Pagamento online da loja (retaguarda: DONO da loja ou ADMIN com X-Loja; a loja vem de
 * `req.lojaId`, conferida pelo middleware) e o retorno público do OAuth do Mercado Pago.
 * @param {ReturnType<import('../services/conexaoMp.service.js').criarServicoConexaoMp>} [servico]
 */
export function criarPagamentoOnlineController(servico) {
  const s = () => servico ?? conexaoMpPadrao();
  return {
    async situacao(req, res) {
      res.json(await s().situacao(req.lojaId));
    },
    async conectar(req, res) {
      const { origem } = validar(conectarSchema, req.body ?? {});
      res.json({ url: s().urlParaConectar(req.lojaId, req.usuario.id, origem ?? null) });
    },
    async desconectar(req, res) {
      const { confirmar } = validar(desconectarSchema, req.body ?? {});
      const r = await s().desconectar(req.lojaId, { confirmar });
      res.json({ ...r, ...(r.desconectada ? await s().situacao(req.lojaId) : {}) });
    },
    async definirAtivo(req, res) {
      const { ativo } = validar(ativoSchema, req.body ?? {});
      await s().definirAtivo(req.lojaId, ativo);
      res.json(await s().situacao(req.lojaId));
    },
    /** GET público: o Mercado Pago volta para cá com ?code&state (ou ?error). Sempre redireciona. */
    async retorno(req, res) {
      const texto = (v) => (typeof v === 'string' ? v.slice(0, 2000) : undefined);
      const destino = await s().concluir({ code: texto(req.query.code), state: texto(req.query.state), erro: texto(req.query.error) });
      res.redirect(302, destino);
    },
  };
}

/** Retorno do OAuth: 30 por 15 minutos por IP (é público; um dono só volta uma vez por conexão). */
export function criarLimitadorRetorno() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ erro: { mensagem: 'Muitas tentativas. Aguarde alguns minutos.', codigo: 'MUITAS_TENTATIVAS' } }),
  });
}
