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

/** Peso máximo aceito pela API para o prato por kg (gramas). */
export const PESO_MAX_GRAMAS = 5000;

/** Comanda nova: só nome e mesa. */
export function comandaParaApi(d) {
  return {
    nomeCliente: texto(d?.nomeCliente, 'o nome do cliente', 60).trim(),
    mesaRotulo: opcional(d?.mesaRotulo, 10),
  };
}

/** Item da comanda: produto e quantidade, ou peso (por kg). Nunca preço. */
export function itemComandaParaApi(d) {
  if (!d || typeof d !== 'object') throw new ErroEntrada('Item inválido');
  const item = { produtoId: idValido(d.produtoId, 'produto') };
  if (d.pesoGramas != null) {
    if (!Number.isInteger(d.pesoGramas) || d.pesoGramas <= 0 || d.pesoGramas > PESO_MAX_GRAMAS) {
      throw new ErroEntrada(`Peso inválido (1 a ${PESO_MAX_GRAMAS} g)`);
    }
    item.pesoGramas = d.pesoGramas;
  } else {
    item.quantidade = Number.isInteger(d.quantidade) ? d.quantidade : 1;
  }
  const observacao = opcional(d.observacao, 140);
  if (observacao) item.observacao = observacao;
  return item;
}

export function fechamentoParaApi(d) {
  if (!FORMAS_PAGAMENTO.includes(d?.formaPagamento)) throw new ErroEntrada('Escolha a forma de pagamento');
  return { formaPagamento: d.formaPagamento, imprimirConta: d.imprimirConta === true };
}

/** Teto de sanidade para valores do caixa (R$ 100.000,00), igual ao da API. */
export const VALOR_CAIXA_MAX = 10_000_000;
export const TIPOS_MOVIMENTO_CAIXA = ['SANGRIA', 'SUPRIMENTO'];

function centavosCaixa(valor, { minimo = 0, nome = 'o valor' } = {}) {
  if (!Number.isInteger(valor) || valor < minimo || valor > VALOR_CAIXA_MAX) throw new ErroEntrada(`Informe ${nome}`);
  return valor;
}

export const aberturaCaixaParaApi = (valor) => ({
  valorInicialCentavos: centavosCaixa(valor, { nome: 'o valor inicial' }),
});

export function movimentoCaixaParaApi(d) {
  if (!TIPOS_MOVIMENTO_CAIXA.includes(d?.tipo)) throw new ErroEntrada('Escolha sangria ou suprimento');
  return {
    tipo: d.tipo,
    valorCentavos: centavosCaixa(d.valorCentavos, { minimo: 1 }),
    motivo: texto(d.motivo, 'o motivo', 140).trim(),
  };
}

/** Fechamento cego: só o contado e a observação (nada de esperado vindo do renderer). */
export function fechamentoCaixaParaApi(d) {
  return {
    valorContadoCentavos: centavosCaixa(d?.valorContadoCentavos, { nome: 'o valor contado' }),
    observacao: opcional(d?.observacao, 500),
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
 *   agente: ReturnType<typeof import('./agente-impressao/agente.js').criarAgente>,
 *   listarImpressoras: () => Promise<string[]>,
 *   versao: string,
 * }} deps
 * @returns {Record<string, (...args: any[]) => Promise<unknown>>}
 */
export function criarHandlers({ config, api, tempoReal, agente, listarImpressoras, versao }) {
  async function aposLogin(usuario) {
    if (usuario) {
      tempoReal.ligar();
      agente.ligar();
    }
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
      agente.desligar();
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

    'pedidos:reimprimir': async (id) => api.requisitar('POST', `/equipe/pedidos/${idValido(id, 'pedido')}/reimprimir`),

    'pedidos:criar': async (dados) => api.requisitar('POST', '/equipe/pedidos', pedidoParaApi(dados)),

    'caixa:atual': async () => api.requisitar('GET', '/equipe/caixa/atual'),

    'caixa:abrir': async (valor) => api.requisitar('POST', '/equipe/caixa/abrir', aberturaCaixaParaApi(valor)),

    'caixa:movimento': async (dados) => api.requisitar('POST', '/equipe/caixa/movimentos', movimentoCaixaParaApi(dados)),

    'caixa:fechar': async (dados) => api.requisitar('POST', '/equipe/caixa/fechar', fechamentoCaixaParaApi(dados)),

    'comandas:listar': async () => api.requisitar('GET', '/equipe/comandas'),

    'comandas:obter': async (id) => api.requisitar('GET', `/equipe/comandas/${idValido(id, 'comanda')}`),

    'comandas:abrir': async (dados) => api.requisitar('POST', '/equipe/comandas', comandaParaApi(dados)),

    'comandas:lancarItem': async (id, item) =>
      api.requisitar('POST', `/equipe/comandas/${idValido(id, 'comanda')}/itens`, itemComandaParaApi(item)),

    'comandas:removerItem': async (id, itemId) =>
      api.requisitar('DELETE', `/equipe/comandas/${idValido(id, 'comanda')}/itens/${idValido(itemId, 'item')}`),

    'comandas:fechar': async (id, dados) =>
      api.requisitar('POST', `/equipe/comandas/${idValido(id, 'comanda')}/fechar`, fechamentoParaApi(dados)),

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

    'impressao:status': async () => agente.status(),

    'impressao:config': async () => ({
      config: config.impressao(),
      impressoras: await listarImpressoras().catch(() => []),
    }),

    'impressao:definirConfig': async (dados) => {
      let impressao;
      try {
        impressao = config.definirImpressao(dados);
      } catch (err) {
        throw new ErroEntrada(err.message);
      }
      agente.reconfigurar();
      return impressao;
    },

    'impressao:testar': async () => agente.testar(),

    'impressao:tentarAgora': async () => {
      await agente.sincronizar();
      return agente.status();
    },
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
