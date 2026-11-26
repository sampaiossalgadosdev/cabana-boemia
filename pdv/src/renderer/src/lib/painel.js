/**
 * Painel de delivery/encomendas: status, filtros, prazo/atraso, ordem e
 * destaque da busca. Lógica pura, testada com node:test.
 */

/**
 * O painel mostra TODOS os canais menos a comanda do salão (que tem a aba própria) e menos os
 * status que não existem para a equipe (pagamento online ainda não aprovado, ou expirado). Lista
 * de exclusão, não de inclusão: um canal novo (como o APP) nunca fica invisível de novo.
 */
export const CANAIS_FORA_DO_PAINEL = ['SALAO'];
export const STATUS_OCULTOS = ['AGUARDANDO_PAGAMENTO', 'EXPIRADO'];

/** Status "ainda aberto" (mesma lista da API: pode finalizar ou cancelar). */
export const STATUS_ABERTOS = ['ABERTO', 'CONFIRMADO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/** Como cada status aparece (CONFIRMADO é o inicial do site/WhatsApp: "Em aberto"). */
export const STATUS = {
  ABERTO: { rotulo: 'Em aberto', classe: 'aberto' },
  CONFIRMADO: { rotulo: 'Em aberto', classe: 'aberto' },
  EM_PREPARO: { rotulo: 'Em preparo', classe: 'preparo' },
  SAIU_ENTREGA: { rotulo: 'Saiu para entrega', classe: 'saiu' },
  FINALIZADO: { rotulo: 'Finalizado', classe: 'finalizado' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'cancelado' },
};

/** Status que a atendente escolhe no menu do pedido (o resto é Finalizar/Cancelar). */
export const STATUS_ANDAMENTO = ['ABERTO', 'EM_PREPARO', 'SAIU_ENTREGA'];

/** Filtro de status do painel. "Em andamento" (padrão) = tudo que ainda não terminou. */
export const FILTROS_STATUS = [
  { valor: 'andamento', rotulo: 'Em andamento', status: STATUS_ABERTOS },
  { valor: 'aberto', rotulo: 'Em aberto', status: ['ABERTO', 'CONFIRMADO'] },
  { valor: 'preparo', rotulo: 'Em preparo', status: ['EM_PREPARO'] },
  { valor: 'saiu', rotulo: 'Saiu para entrega', status: ['SAIU_ENTREGA'] },
  { valor: 'finalizado', rotulo: 'Finalizado', status: ['FINALIZADO'] },
  { valor: 'cancelado', rotulo: 'Cancelado', status: ['CANCELADO'] },
  { valor: 'todos', rotulo: 'Todos', status: null },
];

export const FILTROS_TIPO = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'delivery', rotulo: 'Delivery' },
  { valor: 'encomenda', rotulo: 'Encomenda' },
];

export const estaAberto = (p) => STATUS_ABERTOS.includes(p.status);
export const entraNoPainel = (p) => Boolean(p?.canal) && !CANAIS_FORA_DO_PAINEL.includes(p.canal) && !STATUS_OCULTOS.includes(p.status);

/** "Delivery #20 - LILIAN" / "Encomenda #18 (Balcão) - DAIANE" */
export function tituloDoPedido(p) {
  const tipo = p.encomenda ? 'Encomenda' : 'Delivery';
  return `${tipo} #${p.numeroDia}${p.retirarNoBalcao ? ' (Balcão)' : ''} - ${p.nomeCliente}`;
}

/**
 * Prazo (Date) do pedido: encomenda = horário agendado; delivery = criação +
 * tempo informado ao cliente. Sem tempo = null.
 */
export function prazoDoPedido(p) {
  if (p.encomenda) return p.agendadoPara ? new Date(p.agendadoPara) : null;
  if (!p.tempoEstimadoMin) return null;
  return new Date(new Date(p.criadoEm).getTime() + p.tempoEstimadoMin * 60_000);
}

/** Minutos de atraso (inteiros, 0 se no prazo). Pedido encerrado não atrasa. */
export function minutosDeAtraso(p, agora = new Date()) {
  if (!estaAberto(p)) return 0;
  const prazo = prazoDoPedido(p);
  if (!prazo) return 0;
  return Math.max(0, Math.floor((new Date(agora).getTime() - prazo.getTime()) / 60_000));
}

/** Texto sem acento, minúsculo, com espaços simples (como o `nomeBusca` da API). */
export const paraBusca = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const digitos = (t) => String(t ?? '').replace(/\D/g, '');

/** A busca casa com o pedido? Nome (sem acento), nº do pedido ou trecho do telefone (3+ dígitos). */
export function casaComBusca(p, busca) {
  const termo = paraBusca(busca).replace(/^#/, '');
  if (!termo) return true;
  if (paraBusca(p.nomeCliente).includes(termo)) return true;
  // Só número (com ou sem formatação de telefone): nº do pedido ou trecho do telefone.
  if (/^[\d\s()+.-]+$/.test(termo)) {
    const d = digitos(termo);
    if (String(p.numeroDia) === d) return true;
    if (d.length >= 3 && digitos(p.telefone).includes(d)) return true;
  }
  return false;
}

/**
 * Filtra por status, tipo e busca.
 * @param {{ status?: string, tipo?: string, busca?: string }} filtro
 */
export function filtrarPedidos(pedidos, { status = 'andamento', tipo = 'todos', busca = '' } = {}) {
  const lista = FILTROS_STATUS.find((f) => f.valor === status)?.status ?? null;
  return pedidos.filter(
    (p) =>
      (!lista || lista.includes(p.status)) &&
      (tipo === 'todos' || (tipo === 'encomenda') === Boolean(p.encomenda)) &&
      casaComBusca(p, busca),
  );
}

/** Último que chegou primeiro (decisão do dono): pela criação, mais nova no topo; empate pelo id maior. */
export function ordenarPedidos(pedidos) {
  const chave = (p) => new Date(p.criadoEm).getTime() || 0;
  return [...pedidos].sort((a, b) => chave(b) - chave(a) || b.id - a.id);
}

/**
 * Pedido novo/atualizado vindo do socket. Só site e WhatsApp, e só do dia
 * que está na tela (`dataRef`); pedido já na lista é sempre substituído.
 */
export function aplicarPedido(lista, pedido, dataRef) {
  if (!entraNoPainel(pedido)) return lista;
  const i = lista.findIndex((p) => p.id === pedido.id);
  if (i >= 0) return lista.map((p, j) => (j === i ? { ...p, ...pedido, registradoPor: pedido.registradoPor ?? p.registradoPor } : p));
  if (dataRef && pedido.dataRef && pedido.dataRef !== dataRef) return lista;
  return [...lista, pedido];
}

/** Alerta sonoro para pedido novo do cliente (site ou app); o do WhatsApp foi lançado aqui. */
export const tocaAlerta = (pedido) => pedido?.canal === 'SITE' || pedido?.canal === 'APP';

/** Selo da origem na lista: "App" ou "Site" (o do WhatsApp não tem selo). */
export const SELO_ORIGEM = { SITE: 'Site', APP: 'App' };

/** "Registrado por: Ana" / "Registrado pelo app" / "Registrado pelo site". */
export function textoRegistro(p) {
  if (p.registradoPor) return `Registrado por: ${p.registradoPor}`;
  return p.canal === 'APP' ? 'Registrado pelo app' : 'Registrado pelo site';
}

/**
 * Divide `texto` em partes para pôr em negrito o trecho buscado. Compara sem
 * acento e sem maiúscula ("joao" acha "João"); se não achar e a busca tiver
 * 3+ dígitos, procura só os dígitos (telefone formatado "(43) 99999-0000").
 * @returns {{ texto: string, destaque: boolean }[]}
 */
export function destacarTrecho(texto, busca) {
  const original = String(texto ?? '');
  const termo = paraBusca(busca);
  if (!original || !termo) return [{ texto: original, destaque: false }];

  // Uma posição normalizada por caractere original (letra latina com acento vira 1 letra).
  const base = [...original].map((c) => {
    const b = paraBusca(c);
    return b.length === 1 ? b : c.toLowerCase();
  });
  let inicio = base.join('').indexOf(termo);
  let fim = inicio + termo.length;

  if (inicio < 0) {
    const d = digitos(busca);
    if (d.length < 3) return [{ texto: original, destaque: false }];
    const posicoes = [...original].map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
    const k = posicoes.map((i) => original[i]).join('').indexOf(d);
    if (k < 0) return [{ texto: original, destaque: false }];
    inicio = posicoes[k];
    fim = posicoes[k + d.length - 1] + 1;
  }
  const chars = [...original];
  return [
    { texto: chars.slice(0, inicio).join(''), destaque: false },
    { texto: chars.slice(inicio, fim).join(''), destaque: true },
    { texto: chars.slice(fim).join(''), destaque: false },
  ].filter((p) => p.texto);
}

// ───────── NFC-e ─────────

/** Só os números da chave digitada ou colada (até 44). */
export const digitosNfce = (texto) => String(texto ?? '').replace(/\D/g, '').slice(0, 44);

/** "4126…" → "4126 1112 3456 …" (grupos de 4, como na DANFE). */
export const formatarChaveNfce = (chave) => digitosNfce(chave).replace(/(\d{4})(?=\d)/g, '$1 ');

/** Problema da chave antes de mandar (a API confere o modelo e o dígito), ou null. Vazio = apagar. */
export function problemaNaChaveNfce(texto) {
  const d = digitosNfce(texto);
  if (d.length === 0) return null;
  if (d.length !== 44) return `A chave tem 44 números (faltam ${44 - d.length})`;
  if (d.slice(20, 22) !== '65') return 'Não é chave de NFC-e (modelo 65)';
  return null;
}
