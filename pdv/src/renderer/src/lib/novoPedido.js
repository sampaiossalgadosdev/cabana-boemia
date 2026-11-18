/**
 * "Novo pedido" do painel de delivery (assistente em etapas): etapas por tipo,
 * validação do cliente e do endereço, plano de gravação do cadastro,
 * agendamento da encomenda, busca de produto e totais da prévia.
 * Lógica pura, testada com node:test. O total oficial é o da API.
 */
import { formatarTelefone, normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';
import { adicionarProduto, MAX_POR_LINHA, totais } from './lancamento.js';
import { paraBusca } from './painel.js';

export const TIPOS = ['delivery', 'encomenda'];

/**
 * Etapas do assistente (o pagamento abre no "Lançar"). A encomenda não tem
 * etapa própria: data e horário ficam no fim da etapa do cliente.
 */
export const etapasDoPedido = () => ['tipo', 'cliente', 'produtos'];

/**
 * Voltou para a escolha do tipo (delivery/encomenda) e avançou de novo:
 * em menos de 5 s mantém o cliente e os itens (o cliente mudou de ideia);
 * 5 s ou mais = pedido novo, do zero. Sem volta registrada = mantém.
 */
export const TEMPO_MANTER_PEDIDO_MS = 5000;
export const manterPedidoAoVoltar = (voltouEm, agora) =>
  voltouEm == null || agora - voltouEm < TEMPO_MANTER_PEDIDO_MS;

export const CIDADE_PADRAO = 'Abatiá';
export const ESTADO_PADRAO = 'Paraná';

export const CLIENTE_VAZIO = { nome: '', telefone: '', email: '', observacao: '' };
export const ENDERECO_VAZIO = {
  cep: '',
  rua: '',
  numero: '',
  bairroId: '',
  complemento: '',
  referencia: '',
  cidade: CIDADE_PADRAO,
  estado: ESTADO_PADRAO,
};

const texto = (v) => String(v ?? '').trim();

/** "86460000" → "86460-000" (para mostrar). */
export function formatarCep(cep) {
  const d = String(cep ?? '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const clienteParaForm = (c) =>
  c
    ? { nome: c.nome ?? '', telefone: c.telefone ? formatarTelefone(c.telefone) : '', email: c.email ?? '', observacao: c.observacao ?? '' }
    : { ...CLIENTE_VAZIO };

export const enderecoParaForm = (e) =>
  e
    ? {
        cep: formatarCep(e.cep),
        rua: e.rua ?? '',
        numero: e.numero ?? '',
        bairroId: e.bairro?.id != null ? String(e.bairro.id) : '',
        complemento: e.complemento ?? '',
        referencia: e.referencia ?? '',
        cidade: e.cidade || CIDADE_PADRAO,
        estado: e.estado || ESTADO_PADRAO,
      }
    : { ...ENDERECO_VAZIO };

/** Endereço do formulário → corpo da API (bairro numérico, CEP só dígitos). */
export const enderecoParaEnvio = (f) => ({
  rua: texto(f.rua),
  numero: texto(f.numero),
  bairroId: Number(f.bairroId),
  complemento: texto(f.complemento),
  referencia: texto(f.referencia),
  cep: String(f.cep ?? '').replace(/\D/g, ''),
  cidade: texto(f.cidade),
  estado: texto(f.estado),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Erros do formulário do cliente, por campo (vazio = válido). Endereço só
 * conta quando há entrega (retirada no balcão não precisa).
 * @returns {Record<string, string>}
 */
export function validarCliente(form, endereco, { retirarNoBalcao = false, bairros = [], doSite = false } = {}) {
  const erros = {};
  if (!texto(form.nome)) erros.nome = 'Informe o nome';
  if (!normalizarTelefone(form.telefone)) erros.telefone = MENSAGEM_TELEFONE_INVALIDO;
  if (!doSite && texto(form.email) && !EMAIL.test(texto(form.email))) erros.email = 'E-mail inválido';
  if (retirarNoBalcao) return erros;
  const cep = String(endereco.cep ?? '').replace(/\D/g, '');
  if (cep && cep.length !== 8) erros.cep = 'CEP com 8 números';
  if (!texto(endereco.rua)) erros.rua = 'Informe o endereço';
  if (!texto(endereco.numero)) erros.numero = 'Informe o número';
  const bairro = bairros.find((b) => String(b.id) === String(endereco.bairroId));
  if (!bairro) erros.bairroId = 'Escolha o bairro';
  else if (bairro.ativo === false) erros.bairroId = 'Não entregamos mais neste bairro';
  return erros;
}

/** Primeira mensagem de erro (para o aviso do botão "→"). */
export const primeiroErro = (erros) => Object.values(erros)[0] ?? null;

const mesmoCliente = (form, c) =>
  texto(form.nome) === texto(c.nome) &&
  (normalizarTelefone(form.telefone) ?? texto(form.telefone)) === (c.telefone ?? '') &&
  texto(form.email).toLowerCase() === texto(c.email).toLowerCase() &&
  texto(form.observacao) === texto(c.observacao);

const mesmoEndereco = (f, e) => {
  const a = enderecoParaEnvio(f);
  return (
    a.rua === texto(e.rua) &&
    a.numero === texto(e.numero) &&
    a.bairroId === e.bairro?.id &&
    a.complemento === texto(e.complemento) &&
    a.referencia === texto(e.referencia) &&
    a.cep === texto(e.cep) &&
    a.cidade === texto(e.cidade || CIDADE_PADRAO) &&
    a.estado === texto(e.estado || ESTADO_PADRAO)
  );
};

/**
 * O que gravar ao avançar da etapa do cliente (na ordem):
 * - cliente novo: `criar` (com o endereço, se houver entrega);
 * - existente: `atualizarCliente` se mudou; `adicionarEndereco` (endereço
 *   novo) ou `atualizarEndereco` (o escolhido mudou).
 * @param {{ cliente: object | null, form: object, endereco: object, enderecoId: number | null, retirarNoBalcao: boolean }} d
 * @returns {{ tipo: string, enderecoId?: number }[]}
 */
export function planoDeGravacao({ cliente, form, endereco, enderecoId, retirarNoBalcao }) {
  if (!cliente) return [{ tipo: 'criar', comEndereco: !retirarNoBalcao }];
  const passos = [];
  if (!mesmoCliente(form, cliente)) passos.push({ tipo: 'atualizarCliente' });
  if (retirarNoBalcao) return passos;
  const atual = cliente.enderecos?.find((e) => e.id === enderecoId);
  if (!atual) passos.push({ tipo: 'adicionarEndereco' });
  else if (!mesmoEndereco(endereco, atual)) passos.push({ tipo: 'atualizarEndereco', enderecoId: atual.id });
  return passos;
}

// ───────── Agendamento (encomenda) ─────────

/**
 * "2026-11-14" + "20:30" (horário de Brasília, sem horário de verão) → instante.
 * Precisa ser no futuro e no MESMO dia operacional de agora (decisão do dono:
 * por enquanto, encomenda só para o expediente de hoje). Mesma regra da API.
 * @param {(instante: Date) => string} diaOperacional
 * @returns {{ instante: Date | null, erro: string | null }}
 */
export function avaliarAgendamento(data, hora, agora, diaOperacional) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data ?? '') || !/^\d{2}:\d{2}$/.test(hora ?? '')) {
    return { instante: null, erro: 'Informe a data e o horário' };
  }
  const instante = new Date(`${data}T${hora}:00-03:00`);
  if (Number.isNaN(instante.getTime())) return { instante: null, erro: 'Data ou horário inválido' };
  if (instante.getTime() <= new Date(agora).getTime()) return { instante: null, erro: 'Esse horário já passou' };
  if (diaOperacional(instante) !== diaOperacional(new Date(agora))) {
    return { instante: null, erro: 'Por enquanto, encomendas só para o expediente de hoje' };
  }
  return { instante, erro: null };
}

const partesSP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante → { data: "2026-11-14", hora: "20:30" } em Brasília (para os campos). */
export function dataHoraLocal(instante) {
  const p = Object.fromEntries(partesSP.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** Sugestão inicial: daqui a 1 hora, arredondada para os próximos 15 minutos. */
export function sugestaoDeHorario(agora) {
  const t = new Date(agora).getTime() + 60 * 60_000;
  return dataHoraLocal(new Date(Math.ceil(t / (15 * 60_000)) * 15 * 60_000));
}

// ───────── Produtos ─────────

export const BUSCA_PRODUTOS_LIMITE = 10;

/**
 * Autocomplete do produto: pelo código (id) ou pelo nome, sem acento.
 * Código exato primeiro, depois quem começa com o termo, depois quem contém.
 */
export function buscarProdutos(categorias, termo) {
  const t = paraBusca(termo);
  if (!t) return [];
  const todos = categorias.flatMap((c) => c.produtos.map((p) => ({ ...p, categoria: c.nome })));
  const pontos = (p) => {
    const nome = paraBusca(p.nome);
    if (/^\d+$/.test(t)) {
      if (String(p.id) === t) return 0;
      if (String(p.id).startsWith(t)) return 1;
    }
    if (nome.startsWith(t)) return 2;
    if (nome.includes(t)) return 3;
    return null;
  };
  return todos
    .map((p) => ({ p, n: pontos(p) }))
    .filter((x) => x.n != null)
    .sort((a, b) => a.n - b.n || a.p.nome.localeCompare(b.p.nome, 'pt-BR'))
    .slice(0, BUSCA_PRODUTOS_LIMITE)
    .map((x) => x.p);
}

/** "1", "2,00", "3.0" → inteiro de 1 a 20; o resto é erro (só vende por unidade). */
export function lerQuantidade(valor) {
  const t = String(valor ?? '').trim().replace(',', '.');
  if (!t) return { quantidade: null, erro: 'Informe a quantidade' };
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { quantidade: null, erro: 'Use um número inteiro' };
  if (n < 1 || n > MAX_POR_LINHA) return { quantidade: null, erro: `De 1 a ${MAX_POR_LINHA}` };
  return { quantidade: n, erro: null };
}

/** Adiciona `quantidade` unidades, uma a uma (respeita saldo e limite da linha). */
export function adicionarQuantidade(linhas, produto, quantidade) {
  let atual = linhas;
  let adicionadas = 0;
  for (let i = 0; i < quantidade; i += 1) {
    const prox = adicionarProduto(atual, produto);
    if (prox === atual) break;
    atual = prox;
    adicionadas += 1;
  }
  return { linhas: atual, adicionadas };
}

/** Quantidade exata de uma linha (editor do item), dentro do saldo e do limite. */
export function definirQuantidade(linhas, chave, quantidade, produto) {
  const linha = linhas.find((l) => l.chave === chave);
  if (!linha) return linhas;
  const outras = linhas.filter((l) => l.chave !== chave && l.produtoId === linha.produtoId).reduce((s, l) => s + l.quantidade, 0);
  let max = MAX_POR_LINHA;
  if (produto?.saldo != null) max = Math.min(max, produto.saldo - outras);
  const q = Math.min(Math.max(0, Math.trunc(quantidade)), Math.max(0, max));
  if (q <= 0) return linhas.filter((l) => l.chave !== chave);
  return linhas.map((l) => (l.chave === chave ? { ...l, quantidade: q } : l));
}

// ───────── Totais ─────────

/**
 * Prévia: subtotal, taxa (do bairro com frete grátis, ou a digitada; retirada
 * = 0), desconto e total. Mesmas regras da API (que dá o valor oficial).
 */
export function totaisDoPedido(linhas, { taxaBairroCentavos = 0, freteGratis = null, taxaManualCentavos = null, descontoCentavos = 0, retirarNoBalcao = false } = {}) {
  const base = totais(linhas, retirarNoBalcao ? 0 : taxaBairroCentavos, freteGratis);
  const taxaEntregaCentavos = retirarNoBalcao ? 0 : (taxaManualCentavos ?? base.taxaEntregaCentavos);
  const desconto = Math.min(Math.max(0, descontoCentavos), base.subtotalCentavos);
  return {
    subtotalCentavos: base.subtotalCentavos,
    taxaEntregaCentavos,
    descontoCentavos: desconto,
    totalCentavos: base.subtotalCentavos + taxaEntregaCentavos - desconto,
  };
}
