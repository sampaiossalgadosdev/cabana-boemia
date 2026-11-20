import { Server } from 'socket.io';
import { verificarAccessToken } from './tokens.js';
import { aoEmitirParaEquipe, aoEventoInterno } from './eventos.js';
import { buscarPorId } from '../repositories/usuario.repository.js';
import { lojaDoUsuario } from '../services/loja.service.js';

export const CAMINHO_SOCKET = '/api/socket.io';
/** Sala da equipe de uma loja: recebe só os pedidos, impressões, caixa e cardápio dela. */
export const salaDaLoja = (lojaId) => `equipe:${lojaId}`;
/** Sala só com as conexões de um usuário (para derrubá-las ao desativar). */
export const salaDoUsuario = (id) => `usuario:${id}`;

/**
 * Socket.IO no mesmo servidor HTTP da API. Só entra quem manda o access
 * token da EQUIPE em `auth.token` (token de cliente é recusado); cada
 * conectado entra na sala da SUA loja, `equipe:<lojaId>` (DONO/ATENDENTE: a do
 * cadastro; ADMIN: a de `auth.loja`, slug ou id, obrigatória), que recebe
 * "pedido:novo", "impressao:nova" etc.
 * @param {import('node:http').Server} servidorHttp
 * @param {{ corsOrigins?: string[] }} [opcoes]
 */
export function criarTempoReal(servidorHttp, { corsOrigins = [] } = {}) {
  const io = new Server(servidorHttp, {
    // Tudo da API fica sob /api (o site ocupa /). O PDV conecta com o mesmo path.
    path: CAMINHO_SOCKET,
    cors: {
      // Mesma regra da API: sem Origin (PDV Electron) passa; do navegador, só as listadas.
      origin(origin, callback) {
        callback(null, !origin || corsOrigins.includes(origin));
      },
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const payload = verificarAccessToken(socket.handshake.auth?.token ?? '');
      const usuario = await buscarPorId(Number(payload.sub));
      if (!usuario?.ativo) return next(new Error('NAO_AUTENTICADO'));
      socket.data.usuario = { id: usuario.id, papel: usuario.papel };
      socket.data.lojaId = await lojaDoUsuario(usuario, socket.handshake.auth?.loja ?? null);
      next();
    } catch (err) {
      // Loja proibida/inexistente: o PDV mostra o motivo (o token em si era válido).
      const motivo = ['LOJA_PROIBIDA', 'LOJA_NAO_ENCONTRADA', 'LOJA_OBRIGATORIA'].includes(err?.codigo) ? err.codigo : 'NAO_AUTENTICADO';
      next(new Error(motivo));
    }
  });

  io.on('connection', (socket) => {
    socket.join([salaDaLoja(socket.data.lojaId), salaDoUsuario(socket.data.usuario.id)]);
  });

  const pararEquipe = aoEmitirParaEquipe((evento, dados, lojaId) => {
    io.to(salaDaLoja(lojaId)).emit(evento, dados);
  });
  // Desativado perde o acesso na hora também no tempo real (a reconexão é
  // recusada pelo middleware, que lê o usuário do banco).
  const pararDesativado = aoEventoInterno('usuario:desativado', ({ usuarioId }) => {
    io.in(salaDoUsuario(usuarioId)).disconnectSockets(true);
  });
  servidorHttp.on('close', () => {
    pararEquipe();
    pararDesativado();
  });

  return io;
}
