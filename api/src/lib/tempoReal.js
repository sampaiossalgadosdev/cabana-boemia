import { Server } from 'socket.io';
import { verificarAccessToken } from './tokens.js';
import { aoEmitirParaEquipe, aoEventoInterno } from './eventos.js';
import { buscarPorId } from '../repositories/usuario.repository.js';

export const SALA_EQUIPE = 'equipe';
/** Sala só com as conexões de um usuário (para derrubá-las ao desativar). */
export const salaDoUsuario = (id) => `usuario:${id}`;

/**
 * Socket.IO no mesmo servidor HTTP da API. Só entra quem manda o access
 * token da EQUIPE em `auth.token` (token de cliente é recusado); todo
 * conectado entra na sala "equipe", que recebe "pedido:novo" e "impressao:nova".
 * @param {import('node:http').Server} servidorHttp
 * @param {{ corsOrigins?: string[] }} [opcoes]
 */
export function criarTempoReal(servidorHttp, { corsOrigins = [] } = {}) {
  const io = new Server(servidorHttp, {
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
      next();
    } catch {
      next(new Error('NAO_AUTENTICADO'));
    }
  });

  io.on('connection', (socket) => {
    socket.join([SALA_EQUIPE, salaDoUsuario(socket.data.usuario.id)]);
  });

  const pararEquipe = aoEmitirParaEquipe((evento, dados) => io.to(SALA_EQUIPE).emit(evento, dados));
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
