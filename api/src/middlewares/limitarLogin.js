import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

/**
 * Rate limit do login por IP + email. Só tentativas que falham contam
 * (o balcão tem um IP só para todas as atendentes).
 * Depende de app.set('trust proxy', 1) para ler o IP real atrás do Railway.
 */
export function criarLimitadorLogin({ limite = 10, janelaMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs: janelaMs,
    limit: limite,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip)}|${email}`;
    },
    handler: (req, res) => {
      res.status(429).json({
        erro: {
          mensagem: 'Muitas tentativas de login. Aguarde alguns minutos.',
          codigo: 'MUITAS_TENTATIVAS',
        },
      });
    },
  });
}
