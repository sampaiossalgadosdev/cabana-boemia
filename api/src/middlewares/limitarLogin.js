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

/**
 * Rate limit de /cliente/auth/* (login Google/Apple, renovar e sair) por IP.
 * Só falhas contam (token inválido, refresh recusado): clientes atrás do mesmo
 * IP da operadora (CGNAT) não se atrapalham em logins normais.
 */
export function criarLimitadorAuthCliente({ limite = 20, janelaMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs: janelaMs,
    limit: limite,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => {
      res.status(429).json({
        erro: { mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.', codigo: 'MUITAS_TENTATIVAS' },
      });
    },
  });
}

/** Segundos até o limitador liberar (para o app mostrar o contador). */
const segundosParaLiberar = (req) =>
  Math.max(1, Math.ceil(((req.rateLimit?.resetTime?.getTime?.() ?? Date.now()) - Date.now()) / 1000));

const recusa = (status, mensagem, codigo) => (req, res) =>
  res.status(status).json({ erro: { mensagem, codigo, detalhes: { segundos: segundosParaLiberar(req) } } });

/**
 * Limites do login com celular (mesmo express-rate-limit do login):
 * - `reenvio`: um código por número a cada 60 s;
 * - `porHora`: até 3 códigos por número por hora;
 * - `porIp`: até 10 pedidos de código por IP por hora (qualquer resposta conta);
 * - `errosCodigo`: até 5 códigos errados por número em 15 min (contra adivinhar o código).
 * Por número = a chave é o celular normalizado; número inválido não entra aqui
 * (a rota recusa). Envio que falhou (ex.: número fora da lista de teste) não
 * gasta o limite do número. Os contadores ficam na memória de cada instância.
 * `normalizar`: celular → chave (o mesmo do controller).
 */
export function criarLimitadoresTelefone(
  normalizar,
  {
    reenvioMs = 60 * 1000,
    enviosPorHora = 3,
    janelaEnviosMs = 60 * 60 * 1000,
    enviosPorIp = 10,
    janelaIpMs = 60 * 60 * 1000,
    errosPorNumero = 5,
    janelaErrosMs = 15 * 60 * 1000,
  } = {},
) {
  const numero = (req) => normalizar(req.body?.telefone);
  const porNumero = (opcoes) =>
    rateLimit({
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: (req) => !numero(req),
      keyGenerator: (req) => numero(req),
      ...opcoes,
    });

  return {
    porIp: rateLimit({
      windowMs: janelaIpMs,
      limit: enviosPorIp,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req.ip),
      handler: recusa(429, 'Muitos pedidos de código a partir desta rede. Aguarde e tente de novo.', 'MUITAS_TENTATIVAS'),
    }),
    reenvio: porNumero({
      windowMs: reenvioMs,
      limit: 1,
      skipFailedRequests: true,
      handler: recusa(429, 'Aguarde para pedir outro código.', 'AGUARDE_REENVIO'),
    }),
    porHora: porNumero({
      windowMs: janelaEnviosMs,
      limit: enviosPorHora,
      skipFailedRequests: true,
      handler: recusa(429, 'Você já pediu 3 códigos para este número na última hora. Tente mais tarde.', 'MUITOS_ENVIOS'),
    }),
    errosCodigo: porNumero({
      windowMs: janelaErrosMs,
      limit: errosPorNumero,
      skipSuccessfulRequests: true,
      handler: recusa(429, 'Muitas tentativas com código errado. Aguarde alguns minutos e peça um código novo.', 'MUITAS_TENTATIVAS'),
    }),
  };
}
