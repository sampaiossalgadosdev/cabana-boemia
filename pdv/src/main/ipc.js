/**
 * Canais IPC (renderer → main). Cada handler valida os argumentos, só fala
 * com rotas fixas da API e devolve `{ ok: true, dados }` ou
 * `{ ok: false, erro: { mensagem, codigo, status } }` (Error não atravessa
 * o IPC com campos extras).
 */

import { criarConsultaCep } from './cep.js';

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
    cep: opcional(e.cep, 9),
    cidade: opcional(e.cidade, 60),
    estado: opcional(e.estado, 30),
  };
}

/** Nome, telefone, e-mail e observação do cliente (cadastro e edição). */
export function clienteParaApi(d) {
  return {
    nome: String(d?.nome ?? ''),
    telefone: String(d?.telefone ?? ''),
    email: opcional(d?.email, 120),
    observacao: opcional(d?.observacao, 300),
  };
}

/** Inteiro >= 0 ou null (centavos opcionais do pedido). */
const centavosOpcionais = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Só os campos do pedido da equipe (delivery do WhatsApp ou encomenda); itens
 * só com produto, quantidade e observação. Nunca preço: o total sai da API.
 */
export function pedidoParaApi(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.itens)) throw new ErroEntrada('Pedido inválido');
  if (!FORMAS_PAGAMENTO.includes(d.formaPagamento)) throw new ErroEntrada('Escolha a forma de pagamento');
  const encomenda = d.encomenda === true;
  const retirarNoBalcao = encomenda && d.retirarNoBalcao === true;
  if (encomenda && (typeof d.agendadoPara !== 'string' || Number.isNaN(Date.parse(d.agendadoPara)))) {
    throw new ErroEntrada('Informe a data e o horário da encomenda');
  }
  return {
    clienteId: idValido(d.clienteId, 'cliente'),
    enderecoId: retirarNoBalcao ? null : idValido(d.enderecoId, 'endereço'),
    itens: d.itens.slice(0, 50).map((i) => ({
      produtoId: Number(i?.produtoId),
      quantidade: Number(i?.quantidade),
      observacao: opcional(i?.observacao, 140),
    })),
    formaPagamento: d.formaPagamento,
    trocoParaCentavos: Number.isInteger(d.trocoParaCentavos) ? d.trocoParaCentavos : null,
    chaveIdempotencia: typeof d.chaveIdempotencia === 'string' ? d.chaveIdempotencia : undefined,
    encomenda,
    agendadoPara: encomenda ? new Date(d.agendadoPara).toISOString() : null,
    retirarNoBalcao,
    descontoCentavos: centavosOpcionais(d.descontoCentavos) ?? 0,
    taxaEntregaCentavos: retirarNoBalcao ? null : centavosOpcionais(d.taxaEntregaCentavos),
    observacao: opcional(d.observacao, 200),
    pagoAgora: d.pagoAgora === true,
  };
}

/** Status que o painel pode escolher (o resto é finalizar/cancelar). */
export const STATUS_ANDAMENTO = ['ABERTO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/** "hoje" ou AAAA-MM-DD (dia operacional do painel). */
function dataValida(valor) {
  if (valor === 'hoje' || (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor))) return valor;
  throw new ErroEntrada('Data inválida');
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

/** Slug de loja (o mesmo formato da API). */
function slugValido(valor) {
  if (typeof valor !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(valor) || valor.length > 60) throw new ErroEntrada('Loja inválida');
  return valor;
}

/** Chave da NFC-e: 44 números (espaços e pontos são tirados); vazio = apagar. A API confere o dígito. */
export function chaveNfceParaApi(valor) {
  if (valor == null) return { chaveNfce: null };
  const digitos = String(valor).replace(/[\s.]/g, '');
  if (!digitos) return { chaveNfce: null };
  if (!/^\d{44}$/.test(digitos)) throw new ErroEntrada('A chave da NFC-e tem 44 números');
  return { chaveNfce: digitos };
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
 *   loja: ReturnType<typeof import('./loja.js').criarEstadoLoja>,
 * }} deps
 * @returns {Record<string, (...args: any[]) => Promise<unknown>>}
 */
export function criarHandlers({ config, api, tempoReal, agente, listarImpressoras, versao, loja, consultarCep = criarConsultaCep() }) {
  function parar() {
    tempoReal.desligar();
    agente.desligar();
  }

  /** Busca a identidade da loja (nome, logo, cor) e liga o tempo real e a impressão nela. */
  async function entrarNaLoja() {
    const { loja: identidade } = await api.requisitar('GET', '/equipe/loja');
    const comLogo = await loja.definirIdentidade(identidade);
    tempoReal.ligar();
    agente.ligar();
    return comLogo;
  }

  /**
   * Depois do login/restauração: DONO e ATENDENTE entram na loja deles; o
   * ADMIN, na loja que escolheu da última vez (se ainda existir), senão
   * `loja: null` e o renderer mostra a escolha.
   */
  async function aposLogin(usuario) {
    if (!usuario) return usuario;
    parar();
    loja.iniciar(usuario, usuario.papel === 'ADMIN' ? config.lojaAdmin() : null);
    if (loja.precisaEscolher()) return { ...usuario, loja: null };
    try {
      return { ...usuario, loja: await entrarNaLoja() };
    } catch (err) {
      // Loja lembrada do ADMIN que sumiu ou ficou proibida: escolhe de novo.
      if (loja.ehAdmin() && [400, 403, 404].includes(err?.status)) {
        loja.escolher(null);
        config.definirLojaAdmin(null);
        return { ...usuario, loja: null };
      }
      throw err;
    }
  }

  function exigirAdmin() {
    if (!loja.ehAdmin()) throw Object.assign(new ErroEntrada('Só o administrador escolhe a loja'), { status: 403, codigo: 'SEM_PERMISSAO' });
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
      parar();
      loja.limpar();
      await api.sair();
      return null;
    },

    /** ADMIN: lojas para escolher (as inativas também: a equipe pode estar montando). */
    'lojas:listar': async () => {
      exigirAdmin();
      const { lojas } = await api.requisitar('GET', '/plataforma/lojas');
      return lojas.map((l) => ({ slug: l.slug, nome: l.nome, ativa: l.ativa, corPrimaria: l.corPrimaria ?? null }));
    },

    /** ADMIN: trabalha nesta loja (null = volta para a escolha). */
    'loja:escolher': async (slug) => {
      exigirAdmin();
      parar();
      if (slug == null) {
        loja.escolher(null);
        await loja.definirIdentidade(null);
        return null;
      }
      loja.escolher(slugValido(slug));
      try {
        const identidade = await entrarNaLoja();
        config.definirLojaAdmin(slug);
        return identidade;
      } catch (err) {
        loja.escolher(null);
        throw err;
      }
    },

    /** Identidade atual (relida da API: a retaguarda pode ter trocado logo ou cor). */
    'loja:atual': async () => {
      if (!loja.identidade()) return null;
      const { loja: identidade } = await api.requisitar('GET', '/equipe/loja');
      return loja.definirIdentidade(identidade);
    },

    'tempoReal:status': async () => tempoReal.status(),

    'pedidos:fila': async () => api.requisitar('GET', `/equipe/pedidos?dataRef=hoje&canal=${CANAIS_FILA}`),

    /** Painel: todos os pedidos do dia operacional (o PDV filtra status, tipo e busca). */
    'pedidos:listar': async (dataRef) =>
      api.requisitar('GET', `/equipe/pedidos?dataRef=${dataValida(dataRef)}&canal=${CANAIS_FILA}&status=todos`),

    'pedidos:status': async (id, status) => {
      if (!STATUS_ANDAMENTO.includes(status)) throw new ErroEntrada('Status inválido');
      return api.requisitar('PATCH', `/equipe/pedidos/${idValido(id, 'pedido')}/status`, { status });
    },

    'pedidos:agendamento': async (id, agendadoPara) => {
      if (typeof agendadoPara !== 'string' || Number.isNaN(Date.parse(agendadoPara))) {
        throw new ErroEntrada('Informe a data e o horário');
      }
      return api.requisitar('PATCH', `/equipe/pedidos/${idValido(id, 'pedido')}/agendamento`, {
        agendadoPara: new Date(agendadoPara).toISOString(),
      });
    },

    'pedidos:finalizar': async (id, formaPagamento) => {
      if (!Number.isInteger(id) || id <= 0) throw new ErroEntrada('Pedido inválido');
      if (!FORMAS_PAGAMENTO.includes(formaPagamento)) throw new ErroEntrada('Escolha a forma de pagamento');
      return api.requisitar('PATCH', `/equipe/pedidos/${id}/finalizar`, { formaPagamento });
    },

    'pedidos:cancelar': async (id) => api.requisitar('PATCH', `/equipe/pedidos/${idValido(id, 'pedido')}/cancelar`),

    'pedidos:reimprimir': async (id) => api.requisitar('POST', `/equipe/pedidos/${idValido(id, 'pedido')}/reimprimir`),

    /** Chave da NFC-e emitida para o pedido (null/vazio apaga). */
    'pedidos:nfce': async (id, chave) =>
      api.requisitar('PATCH', `/equipe/pedidos/${idValido(id, 'pedido')}/nfce`, chaveNfceParaApi(chave)),

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

    // Bairros da área de entrega DESTA loja (com a taxa dela).
    'bairros:listar': async () => api.requisitar('GET', '/equipe/bairros'),

    'clientes:buscar': async (busca) =>
      api.requisitar('GET', `/equipe/clientes?busca=${encodeURIComponent(texto(busca, 'o nome ou telefone', 60).trim())}`),

    // Endereço opcional: encomenda retirada no balcão não precisa.
    'clientes:criar': async (dados) =>
      api.requisitar('POST', '/equipe/clientes', {
        ...clienteParaApi(dados),
        endereco: dados?.endereco == null ? null : enderecoParaApi(dados.endereco),
      }),

    'clientes:atualizar': async (clienteId, dados) =>
      api.requisitar('PUT', `/equipe/clientes/${idValido(clienteId, 'cliente')}`, clienteParaApi(dados)),

    'clientes:adicionarEndereco': async (clienteId, endereco) =>
      api.requisitar('POST', `/equipe/clientes/${idValido(clienteId, 'cliente')}/enderecos`, enderecoParaApi(endereco)),

    'clientes:atualizarEndereco': async (clienteId, enderecoId, endereco) =>
      api.requisitar(
        'PUT',
        `/equipe/clientes/${idValido(clienteId, 'cliente')}/enderecos/${idValido(enderecoId, 'endereço')}`,
        enderecoParaApi(endereco),
      ),

    'cep:consultar': async (cep) => consultarCep(String(cep ?? '')),

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
