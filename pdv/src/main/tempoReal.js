/**
 * Socket.IO da equipe, no processo main. O access token vai em `auth.token`
 * e é pedido de novo a cada (re)conexão, então nunca conecta com token vencido.
 *
 * Recusa do middleware da API (`connect_error` com o socket inativo) ou
 * desconexão pelo servidor NÃO reconectam sozinhas no socket.io-client:
 * aqui renovamos a sessão e reconectamos. Se a renovação der 401 (ex.:
 * atendente desativada), o clienteApi já avisou "sessão expirou".
 */

/** Eventos da API escutados no main (impressao:nova vai para o agente de impressão). */
export const EVENTOS_EQUIPE = ['pedido:novo', 'pedido:atualizado', 'impressao:nova', 'caixa:atualizado', 'cardapio:atualizado'];

const ESPERA_RECONEXAO_MS = 3_000;

/**
 * @param {{
 *   io: typeof import('socket.io-client').io,
 *   apiUrl: () => string,
 *   accessToken: () => Promise<string>,
 *   renovar: () => Promise<string>,
 *   aoStatus: (s: 'conectado' | 'reconectando' | 'desligado') => void,
 *   aoEvento: (nome: string, dados: unknown) => void,
 * }} opcoes
 */
export function criarTempoReal({ io, apiUrl, accessToken, renovar, aoStatus, aoEvento }) {
  let socket = null;
  let timer = null;
  let status = 'desligado';

  function mudar(novo) {
    if (novo === status) return;
    status = novo;
    aoStatus(novo);
  }

  function reconectarDepois() {
    clearTimeout(timer);
    timer = setTimeout(() => socket?.connect(), ESPERA_RECONEXAO_MS);
  }

  function ligar() {
    desligar();
    mudar('reconectando');
    const s = io(apiUrl(), {
      transports: ['websocket'],
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      // Chamado a cada tentativa: pega um access válido (renova se preciso).
      auth: (cb) => {
        accessToken().then(
          (token) => cb({ token }),
          () => cb({ token: '' }),
        );
      },
    });
    socket = s;

    s.on('connect', () => mudar('conectado'));
    s.on('disconnect', (motivo) => {
      if (socket !== s) return;
      mudar('reconectando');
      if (motivo === 'io server disconnect') reconectarComSessaoNova(s);
    });
    s.on('connect_error', () => {
      if (socket !== s) return;
      mudar('reconectando');
      // Ativo = falha de rede, o próprio cliente tenta de novo.
      if (!s.active) reconectarComSessaoNova(s);
    });
    for (const nome of EVENTOS_EQUIPE) s.on(nome, (dados) => aoEvento(nome, dados));
  }

  function reconectarComSessaoNova(s) {
    renovar().then(
      () => socket === s && reconectarDepois(),
      (err) => {
        // 401: sessão morta, quem cuida é o aoSessaoExpirar. Rede: tenta de novo.
        if (socket === s && err?.status !== 401) reconectarDepois();
      },
    );
  }

  function desligar() {
    clearTimeout(timer);
    if (socket) {
      const s = socket;
      socket = null;
      s.removeAllListeners();
      s.disconnect();
    }
    mudar('desligado');
  }

  return { ligar, desligar, status: () => status };
}
