import { Server } from 'socket.io';
import { verificarAccessToken } from './tokens.js';
import { aoEmitirParaEquipe, aoEventoInterno } from './eventos.js';
import { buscarPorId } from '../repositories/usuario.repository.js';
import { lojaDoUsuario, lojaPadraoId } from '../services/loja.service.js';

export const CAMINHO_SOCKET = '/api/socket.io';
/** Sala da equipe de uma loja: recebe só os pedidos, impressões, caixa e cardápio dela. */
export const salaDaLoja = (lojaId) => `equipe:${lojaId}`;
/**
 * Sala LEGADA "equipe" (PDV antigo instalado na Cabana): só os sockets da loja
 * padrão entram, e só os eventos da loja padrão vão para ela. Sai na próxima etapa,
 * quando o PDV novo estiver instalado.
 */
export const SALA_EQUIPE_LEGADA = 'equipe';
/** Sala só com as conexões de um usuário (para derrubá-las ao desativar). */
export const salaDoUsuario = (id) => `usuario:${id}`;

/**
 * Socket.IO no mesmo servidor HTTP da API. Só entra quem manda o access
 * token da EQUIPE em `auth.token` (token de cliente é recusado); cada
 * conectado entra na sala da SUA loja, `equipe:<lojaId>` (DONO/ATENDENTE: a do
 * cadastro; ADMIN: a de `auth.loja`, slug ou id, senão a padrão), que recebe
 * "pedido:novo", "impressao:nova" etc. Os da loja padrão entram também na sala
 * legada "equipe" (compatibilidade com o PDV antigo).
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
      socket.data.legada = socket.data.lojaId === (await lojaPadraoId());
      next();
    } catch (err) {
      // Loja proibida/inexistente: o PDV mostra o motivo (o token em si era válido).
      next(new Error(err?.codigo === 'LOJA_PROIBIDA' || err?.codigo === 'LOJA_NAO_ENCONTRADA' ? err.codigo : 'NAO_AUTENTICADO'));
    }
  });

  io.on('connection', (socket) => {
    const salas = [salaDaLoja(socket.data.lojaId), salaDoUsuario(socket.data.usuario.id)];
    if (socket.data.legada) salas.push(SALA_EQUIPE_LEGADA);
    socket.join(salas);
  });

  // Loja padrão: também para a sala legada (um socket nas duas recebe uma vez só).
  const pararEquipe = aoEmitirParaEquipe((evento, dados, lojaId) => {
    lojaPadraoId()
      .then((padrao) => io.to(lojaId === padrao ? [salaDaLoja(lojaId), SALA_EQUIPE_LEGADA] : salaDaLoja(lojaId)).emit(evento, dados))
      .catch((err) => console.error(`Falha ao repassar o evento "${evento}":`, err));
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
