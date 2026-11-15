import { Prisma } from '@prisma/client';
import { ErroHttp } from '../lib/erros.js';

/**
 * Middleware central de erro. Toda exceção da API termina aqui e vira
 * `{ erro: { mensagem, codigo, detalhes? } }`.
 */
// eslint-disable-next-line no-unused-vars
export function tratarErro(err, req, res, next) {
  // Erro nunca fica em cache (rotas públicas definem cache antes do handler).
  res.set('Cache-Control', 'no-store');

  if (err instanceof ErroHttp) {
    return res.status(err.status).json({
      erro: { mensagem: err.message, codigo: err.codigo ?? 'ERRO', detalhes: err.detalhes },
    });
  }

  // Corpo JSON malformado ou grande demais (express.json)
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: { mensagem: 'JSON inválido', codigo: 'JSON_INVALIDO' } });
  }
  if (err?.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ erro: { mensagem: 'Corpo da requisição muito grande', codigo: 'CORPO_GRANDE' } });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ erro: { mensagem: 'Registro duplicado', codigo: 'DUPLICADO' } });
    }
    if (err.code === 'P2025') {
      return res
        .status(404)
        .json({ erro: { mensagem: 'Registro não encontrado', codigo: 'NAO_ENCONTRADO' } });
    }
  }

  console.error(err);
  return res.status(500).json({ erro: { mensagem: 'Erro interno', codigo: 'ERRO_INTERNO' } });
}
