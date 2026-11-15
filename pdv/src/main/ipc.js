/**
 * Canais IPC (renderer → main). Cada handler valida os argumentos, só fala
 * com rotas fixas da API e devolve `{ ok: true, dados }` ou
 * `{ ok: false, erro: { mensagem, codigo, status } }` (Error não atravessa
 * o IPC com campos extras).
 */

export const FORMAS_PAGAMENTO = ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'];
export const CANAIS_FILA = 'SITE,WHATSAPP';
export const TEMPO_MIN = 1;
export const TEMPO_MAX = 240;

class ErroEntrada extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.codigo = 'VALIDACAO';
    this.status = 400;
  }
}

function texto(valor, nome, max = 200) {
  if (typeof valor !== 'string' || !valor.trim() || valor.length > max) throw new ErroEntrada(`Informe ${nome}`);
  return valor;
}

function idValido(valor, nome = 'o registro') {
  if (!Number.isInteger(valor) || valor <= 0) throw new ErroEntrada(`${nome[0].toUpperCase()}${nome.slice(1)} inválido`);
  return valor;
}

/** Texto opcional: string (cortada em `max`) ou null. */
const opcional = (v, max) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

/** Só os campos de endereço que a API aceita (o renderer não injeta outros). */
export function enderecoParaApi(e) {
  if (!e || typeof e !== 'object') throw new ErroEntrada('Informe o endereço');
  return {
    rua: String(e.rua ?? ''),
    numero: String(e.numero ?? ''),
    complemento: opcional(e.complemento, 120),
    referencia: opcional(e.referencia, 200),
    bairroId: Number(e.bairroId),
  };
}

/** Só os campos do pedido do WhatsApp; itens só com produto, quantidade e observação. */
export function pedidoParaApi(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.itens)) throw new ErroEntrada('Pedido inválido');
  if (!FORMAS_PAGAMENTO.includes(d.formaPagamento)) throw new ErroEntrada('Escolha a forma de pagamento');
  return {
    clienteId: idValido(d.clienteId, 'cliente'),
    enderecoId: idValido(d.enderecoId, 'endereço'),
    itens: d.itens.slice(0, 50).map((i) => ({
      produtoId: Number(i?.produtoId),
      quantidade: Number(i?.quantidade),
      observacao: opcional(i?.observacao, 140),
    })),
    formaPagamento: d.formaPagamento,
    trocoParaCentavos: Number.isInteger(d.trocoParaCentavos) ? d.trocoParaCentavos : null,
    chaveIdempotencia: typeof d.chaveIdempotencia === 'string' ? d.chaveIdempotencia : undefined,
  };
}

export function validarMinutos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (!Number.isInteger(valor) || valor < TEMPO_MIN || valor > TEMPO_MAX) {
    throw new ErroEntrada(`Use um número inteiro de ${TEMPO_MIN} a ${TEMPO_MAX}`);
  }
  return valor;
}

/**
 * @param {{
 *   config: ReturnType<typeof import('./config.js').criarConfig>,
 *   api: ReturnType<typeof import('./clienteApi.js').criarClienteApi>,
 *   tempoReal: ReturnType<typeof import('./tempoReal.js').criarTempoReal>,
 *   versao: string,
 * }} deps
 * @returns {Record<string, (...args: any[]) => Promise<unknown>>}
 */
export function criarHandlers({ config, api, tempoReal, versao }) {
  async function aposLogin(usuario) {
    if (usuario) tempoReal.ligar();
    return usuario;
  }

  return {
    'config:obter': async () => ({ ...config.obter(), versao }),

    'config:definirApiUrl': async (url) => {
      // Trocar de servidor com sessão aberta misturaria tokens de servidores diferentes.
      if (api.logado()) throw new ErroEntrada('Saia da conta antes de trocar o servidor');
      try {
        return { apiUrl: config.definirApiUrl(url) };
      } catch (err) {
        throw new ErroEntrada(err.message);
      }
    },

    'sessao:restaurar': async () => aposLogin(await api.restaurar()),

    'sessao:entrar': async (email, senha) =>
      aposLogin(await api.entrar(texto(email, 'o email').trim(), texto(senha, 'a senha', 72))),

    'sessao:sair': async () => {
      tempoReal.desligar();
      await api.sair();
      return null;
    },

    'tempoReal:status': async () => tempoReal.status(),

    'pedidos:fila': async () => api.requisitar('GET', `/equipe/pedidos?dataRef=hoje&canal=${CANAIS_FILA}`),

    'pedidos:finalizar': async (id, formaPagamento) => {
      if (!Number.isInteger(id) || id <= 0) throw new ErroEntrada('Pedido inválido');
      if (!FORMAS_PAGAMENTO.includes(formaPagamento)) throw new ErroEntrada('Escolha a forma de pagamento');
      return api.requisitar('PATCH', `/equipe/pedidos/${id}/finalizar`, { formaPagamento });
    },

    'pedidos:cancelar': async (id) => api.requisitar('PATCH', `/equipe/pedidos/${idValido(id, 'pedido')}/cancelar`),

    'pedidos:criar': async (dados) => api.requisitar('POST', '/equipe/pedidos', pedidoParaApi(dados)),

    'cardapio:obter': async (turnoId) =>
      api.requisitar('GET', turnoId == null ? '/equipe/cardapio' : `/equipe/cardapio?turnoId=${idValido(turnoId, 'turno')}`),

    'bairros:listar': async () => api.requisitar('GET', '/publico/bairros'),

    'clientes:buscar': async (busca) =>
      api.requisitar('GET', `/equipe/clientes?busca=${encodeURIComponent(texto(busca, 'o nome ou telefone', 60).trim())}`),

    'clientes:criar': async (dados) =>
      api.requisitar('POST', '/equipe/clientes', {
        nome: String(dados?.nome ?? ''),
        telefone: String(dados?.telefone ?? ''),
        endereco: enderecoParaApi(dados?.endereco),
      }),

    'clientes:adicionarEndereco': async (clienteId, endereco) =>
      api.requisitar('POST', `/equipe/clientes/${idValido(clienteId, 'cliente')}/enderecos`, enderecoParaApi(endereco)),

    'tempo:obter': async () => api.requisitar('GET', '/equipe/config/tempo-estimado'),

    'tempo:definir': async (minutos) =>
      api.requisitar('PUT', '/equipe/config/tempo-estimado', { minutos: validarMinutos(minutos) }),
  };
}

/** Envelope `{ ok, dados | erro }` para o renderer. */
export async function executar(handler, args) {
  try {
    return { ok: true, dados: (await handler(...args)) ?? null };
  } catch (err) {
    return {
      ok: false,
      erro: {
        mensagem: err?.message || 'Erro inesperado',
        codigo: err?.codigo ?? 'ERRO',
        status: err?.status ?? 0,
        // JSON puro vindo da API (ex.: cliente existente, itens esgotados).
        detalhes: err?.detalhes ?? null,
      },
    };
  }
}
