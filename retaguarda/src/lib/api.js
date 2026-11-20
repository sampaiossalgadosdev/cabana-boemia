import { criarSessao } from './sessao.js';
import { lojaEscolhida } from './lojaEscolhida.js';

// Mesmo domínio da API (/admin); em dev, o proxy do Vite repassa.
// Rotas da API sob /api. Em produção a API serve esta página (mesmo domínio,
// VITE_API_URL vazio); em dev, o proxy do Vite repassa /api para a API local.
const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api`;

/** Erro HTTP da API: `{ erro: { mensagem, codigo, detalhes } }`. */
export class ErroApi extends Error {
  constructor(status, { mensagem, codigo, detalhes } = {}) {
    super(mensagem || (status === 0 ? 'Sem conexão com o servidor.' : `Erro ${status}`));
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Arquivo (logo) vai cru, com o tipo dele; o resto, JSON. */
const ehArquivo = (c) => typeof Blob !== 'undefined' && c instanceof Blob;

async function enviar(metodo, rota, { corpo, token } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['content-type'] = ehArquivo(corpo) ? corpo.type || 'application/octet-stream' : 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  // ADMIN numa loja: a API usa a loja do cabeçalho (DONO: a do cadastro).
  if (token && lojaEscolhida()) headers['x-loja'] = lojaEscolhida();
  let res;
  try {
    res = await fetch(`${BASE}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : ehArquivo(corpo) ? corpo : JSON.stringify(corpo),
      cache: 'no-store',
    });
  } catch {
    throw new ErroApi(0);
  }
  const texto = await res.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    // corpo não-JSON (ex.: proxy fora do ar)
  }
  if (!res.ok) throw new ErroApi(res.status, dados?.erro);
  return dados;
}

function armazenamento() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem() {}, removeItem() {} };
  }
}

/** Serializa a renovação entre abas (Web Locks); sem suporte, só dentro da aba. */
const travar = (fn) => (navigator.locks ? navigator.locks.request('cabana-boemia:retaguarda:refresh', fn) : fn());

const ouvintesExpirou = new Set();
export const aoExpirarSessao = (fn) => {
  ouvintesExpirou.add(fn);
  return () => ouvintesExpirou.delete(fn);
};

export const sessao = criarSessao({
  armazenamento: armazenamento(),
  enviar,
  travar,
  aoExpirar: () => ouvintesExpirou.forEach((fn) => fn()),
});

const get = (rota) => sessao.chamar('GET', rota);
const post = (rota, corpo) => sessao.chamar('POST', rota, corpo);
const put = (rota, corpo) => sessao.chamar('PUT', rota, corpo);
const patch = (rota, corpo) => sessao.chamar('PATCH', rota, corpo);

const consulta = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  return q.size ? `?${q}` : '';
};

export const api = {
  categorias: {
    listar: () => get('/retaguarda/categorias'),
    criar: (dados) => post('/retaguarda/categorias', dados),
    alterar: (id, dados) => patch(`/retaguarda/categorias/${id}`, dados),
  },
  produtos: {
    listar: () => get('/retaguarda/produtos'),
    criar: (dados) => post('/retaguarda/produtos', dados),
    alterar: (id, dados) => put(`/retaguarda/produtos/${id}`, dados),
    disponivelHoje: (id, disponivelHoje) => patch(`/retaguarda/produtos/${id}/disponivel-hoje`, { disponivelHoje }),
    descricao: (id, descricao) => patch(`/retaguarda/produtos/${id}/descricao`, { descricao }),
  },
  cardapioDoDia: {
    obter: (turnoId) => get(`/retaguarda/cardapio-do-dia${consulta({ turnoId })}`),
    liberarTudo: (turnoId) => post('/retaguarda/cardapio-do-dia/liberar-tudo', { turnoId }),
  },
  turnos: {
    listar: () => get('/retaguarda/turnos'),
    criar: (nome) => post('/retaguarda/turnos', { nome }),
    alterar: (id, dados) => patch(`/retaguarda/turnos/${id}`, dados),
    definirHorarios: (id, horarios) => put(`/retaguarda/turnos/${id}/horarios`, { horarios }),
  },
  // Área de entrega da loja (`id` = id do bairro da cidade).
  bairros: {
    listar: () => get('/retaguarda/bairros'),
    daCidade: () => get('/retaguarda/bairros/cidade'),
    criar: (dados) => post('/retaguarda/bairros', dados),
    alterar: (id, dados) => patch(`/retaguarda/bairros/${id}`, dados),
  },
  // Perfil da loja (cor e logo; o ADMIN define o padrão).
  perfil: {
    obter: () => get('/retaguarda/perfil'),
    cor: (corPrimaria) => put('/retaguarda/perfil/cor', { corPrimaria }),
    logo: (arquivo) => put('/retaguarda/perfil/logo', arquivo),
    voltarAoPadrao: () => post('/retaguarda/perfil/padrao'),
  },
  // Só ADMIN (plataforma).
  plataforma: {
    lojas: {
      listar: () => get('/plataforma/lojas'),
      criar: (dados) => post('/plataforma/lojas', dados),
      alterar: (id, dados) => patch(`/plataforma/lojas/${id}`, dados),
      logoPadrao: (id, arquivo) => put(`/plataforma/lojas/${id}/logo-padrao`, arquivo),
      criarDono: (id, dados) => post(`/plataforma/lojas/${id}/dono`, dados),
    },
    solicitacoes: {
      listar: () => get('/plataforma/solicitacoes-exclusao'),
      atender: (id) => patch(`/plataforma/solicitacoes-exclusao/${id}/atendida`),
    },
    bairros: {
      listar: () => get('/plataforma/bairros'),
      criar: (dados) => post('/plataforma/bairros', dados),
      alterar: (id, dados) => patch(`/plataforma/bairros/${id}`, dados),
    },
  },
  estoque: {
    obter: () => get('/retaguarda/estoque'),
    entrada: (dados) => post('/retaguarda/estoque/entrada', dados),
    ajuste: (dados) => post('/retaguarda/estoque/ajuste', dados),
    movimentacoes: (filtro) => get(`/retaguarda/estoque/movimentacoes${consulta(filtro)}`),
    criarInsumo: (dados) => post('/retaguarda/insumos', dados),
    alterarInsumo: (id, dados) => put(`/retaguarda/insumos/${id}`, dados),
  },
  usuarios: {
    listar: () => get('/usuarios'),
    criar: (dados) => post('/usuarios', dados),
    desativar: (id) => patch(`/usuarios/${id}/desativar`),
    reativar: (id) => patch(`/usuarios/${id}/reativar`),
    trocarSenha: (id, senha) => patch(`/usuarios/${id}/senha`, { senha }),
  },
  relatorios: {
    dia: (data) => get(`/retaguarda/relatorios/dia${consulta({ data })}`),
    imprimir: (data) => post('/retaguarda/relatorios/dia/imprimir', { data }),
    caixas: (data) => get(`/retaguarda/caixas${consulta({ data })}`),
  },
  config: {
    obter: () => get('/retaguarda/config'),
    salvar: (dados) => put('/retaguarda/config', dados),
  },
};
