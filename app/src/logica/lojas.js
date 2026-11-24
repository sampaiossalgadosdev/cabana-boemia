/**
 * Regras puras do app multi-loja (testadas com node:test): vitrine (busca e
 * ordem), endereço das imagens, identificação legal da loja, cores do tema da
 * loja, sacola presa a uma loja e taxa pela área de entrega da loja.
 */
import { avaliarCor, corParaTextoNaBase, misturar, textoSobre } from '@restaurante/shared/cores';
import { lerTexto, gravarTexto } from './armazenamento.js';
import { CHAVE_STORAGE, carregarCarrinho, salvarCarrinho } from './carrinho.js';
import { quandoAbre } from './horario.js';

// ───────── Vitrine ─────────

export const CHAVE_LOJAS = 'delivery-abatia:lojas:v1';

/** Sem acento, minúsculas, espaços simples (busca "cabana" acha "Cabana Boêmia"). */
export const paraBusca = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Lojas que casam com a busca (nome ou descrição), abertas primeiro; a ordem da API vale dentro de cada grupo. */
export function filtrarLojas(lojas, busca = '') {
  const termo = paraBusca(busca);
  const achadas = (lojas ?? []).filter((l) => !termo || paraBusca(`${l.nome} ${l.descricao ?? ''}`).includes(termo));
  return [...achadas.filter((l) => l.aberta), ...achadas.filter((l) => !l.aberta)];
}

/** "Aberta" | "Fechada · abre hoje às 19:00" | "Fechada". */
export function situacaoDaLoja(loja, agora = new Date()) {
  if (loja?.aberta) return 'Aberta';
  return loja?.proximaAbertura?.em ? `Fechada · abre ${quandoAbre(loja.proximaAbertura.em, agora)}` : 'Fechada';
}

function pareceLojas(lista) {
  return Array.isArray(lista) && lista.every((l) => l && typeof l.slug === 'string' && typeof l.nome === 'string');
}

/** Guarda a última vitrine boa da API. @returns {Promise<boolean>} */
export function salvarLojas(lojas, agora = Date.now(), storage) {
  return gravarTexto(CHAVE_LOJAS, JSON.stringify({ salvoEm: agora, lojas }), storage);
}

/** @returns {Promise<{ lojas: any[], salvoEm: number } | null>} */
export async function lerLojasSalvas(storage) {
  const texto = await lerTexto(CHAVE_LOJAS, storage);
  if (!texto) return null;
  try {
    const { salvoEm, lojas } = JSON.parse(texto);
    return Number.isFinite(salvoEm) && pareceLojas(lojas) ? { lojas, salvoEm } : null;
  } catch {
    return null;
  }
}

/**
 * Endereço absoluto de uma imagem da API: a logo vem como caminho
 * ("/api/publico/imagens/3", servida com cache longo) ou link https.
 * @param {string} base base da API ("https://x.com.br/api")
 */
export function urlDaImagem(caminho, base) {
  if (!caminho) return null;
  if (/^https?:\/\//.test(caminho)) return caminho;
  if (!caminho.startsWith('/')) return null;
  return `${String(base).replace(/\/api\/?$/, '')}${caminho}`;
}

// ───────── Identificação legal (Decreto 7.962/2013, art. 2º) ─────────

/** "12345678901" → "123.456.789-01"; 14 dígitos → "12.345.678/0001-90"; outro → como veio. */
export function formatarDocumento(doc) {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc ?? '';
}

/**
 * Linhas da identificação do fornecedor na página da loja: nome empresarial,
 * CNPJ/CPF e endereço. O que a loja não cadastrou aparece como "não informado".
 */
export function identificacaoLegal(config) {
  const d = String(config?.documento ?? '').replace(/\D/g, '');
  const rotulo = d.length === 11 ? 'CPF' : d.length === 14 ? 'CNPJ' : 'CNPJ/CPF';
  return [
    `Razão social: ${config?.razaoSocial || config?.nome || 'não informada'}`,
    `${rotulo}: ${d ? formatarDocumento(d) : 'não informado'}`,
    ...(config?.endereco ? [`Endereço: ${config.endereco}`] : []),
  ];
}

// ───────── Cores da loja ─────────

/**
 * Cores do tema da loja sobre o tema base do app: a cor primária vai no
 * cabeçalho, botões e destaques; o texto por cima é o que a API calculou
 * (claro ou escuro, mesma regra do shared). Cor ausente ou ilegível = as do tema base.
 * @param {{ corPrimaria?: string | null, corTexto?: string | null }} loja
 * @param {Record<string, string>} coresBase
 */
export function coresDaLoja(loja, coresBase) {
  const a = avaliarCor(loja?.corPrimaria);
  if (!a.ok) return coresBase;
  const texto = loja?.corTexto === '#111111' || loja?.corTexto === '#FFFFFF' ? loja.corTexto : textoSobre(a.cor);
  return {
    ...coresBase,
    acao: a.cor,
    acaoPressionada: misturar(a.cor, '#000000', 0.22),
    textoAcao: texto,
    cabecalho: a.cor,
    textoInverso: texto,
    preco: corParaTextoNaBase(a.cor),
    // Texto/link na cor da loja sobre o fundo claro (escurecida até 4,5:1).
    acaoTexto: corParaTextoNaBase(a.cor),
  };
}

// ───────── Sacola presa a uma loja ─────────

export const CHAVE_SACOLA = 'delivery-abatia:sacola:v2';
/** Antes do multi-loja só existia a Cabana: a sacola antiga (v1) é dela. */
export const LOJA_DA_SACOLA_ANTIGA = { slug: 'cabana-boemia', nome: 'Cabana Boemia' };

/** Pôr item desta loja exige esvaziar a sacola (que tem itens de outra)? */
export function precisaEsvaziar(sacola, slug) {
  return Boolean(sacola?.itens?.length) && Boolean(sacola.loja) && sacola.loja.slug !== slug;
}

const lojaValida = (l) => (l && typeof l.slug === 'string' && typeof l.nome === 'string' ? { slug: l.slug, nome: l.nome } : null);

/** `{ loja, itens }` salvo; a sacola v1 (só itens) vira da Cabana. Sacola vazia = sem loja. */
export async function carregarSacola(storage) {
  const texto = await lerTexto(CHAVE_SACOLA, storage);
  if (texto) {
    try {
      const { loja, itens } = JSON.parse(texto);
      // Os itens passam pela mesma limpeza da sacola v1 (linhas inválidas somem).
      const limpos = await carregarCarrinho({ getItem: async () => JSON.stringify(itens ?? []) });
      const l = lojaValida(loja);
      return limpos.length && l ? { loja: l, itens: limpos } : { loja: null, itens: [] };
    } catch {
      return { loja: null, itens: [] };
    }
  }
  const antigos = await carregarCarrinho(storage);
  return antigos.length ? { loja: { ...LOJA_DA_SACOLA_ANTIGA }, itens: antigos } : { loja: null, itens: [] };
}

/** @returns {Promise<boolean>} */
export async function salvarSacola({ loja, itens }, storage) {
  const ok = await gravarTexto(CHAVE_SACOLA, JSON.stringify({ loja: itens.length ? lojaValida(loja) : null, itens }), storage);
  // A sacola v1 fica vazia para não "voltar" numa leitura futura.
  if (ok) await salvarCarrinho([], storage);
  return ok;
}

export { CHAVE_STORAGE as CHAVE_SACOLA_ANTIGA };

// ───────── Taxa pela área de entrega da loja ─────────

/**
 * Taxa da loja para o endereço: a da área dela no bairro (lista de
 * GET /publico/lojas/:slug/bairros, só os onde entrega). null = a loja não
 * entrega lá (o endereço vale para outras lojas).
 */
export function taxaNaLoja(endereco, bairrosDaLoja) {
  const b = (bairrosDaLoja ?? []).find((x) => x.id === endereco?.bairro?.id);
  return b ? b.taxaCentavos : null;
}

/** Endereço que já vem escolhido: o principal se a loja entrega lá, senão o primeiro atendido; nenhum = null. */
export function enderecoInicialNaLoja(enderecos, bairrosDaLoja) {
  const atendidos = (enderecos ?? []).filter((e) => taxaNaLoja(e, bairrosDaLoja) != null);
  return atendidos.find((e) => e.principal) ?? atendidos[0] ?? null;
}
