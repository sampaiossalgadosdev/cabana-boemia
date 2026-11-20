/**
 * Produtos e cardápio do dia (retaguarda).
 *
 * - Não se exclui produto (itens de pedido apontam para ele): desativa-se.
 * - O saldo (`estoque`) NÃO é editado aqui: só Entrada/Ajuste do estoque e as
 *   vendas mexem nele (CLAUDE.md › Estoque). Ligar `controlaEstoque` num
 *   produto sem saldo começa em 0; desligar mantém o número (só deixa de valer).
 * - `POR_KG` não controla estoque nem consome insumos.
 * - Toda mudança avisa o PDV (`cardapio:atualizado`) depois do commit.
 */
import { prisma } from '../lib/prisma.js';
import { ErroHttp, ehDuplicado } from '../lib/erros.js';
import { avisarCardapioAtualizado } from '../lib/eventos.js';
import * as produtoRepo from '../repositories/produto.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';
import { temSaldo } from './publico.service.js';
import { OPCOES_TRANSACAO } from './pedido.service.js';

const naoEncontrado = () => new ErroHttp(404, 'Produto não encontrado', { codigo: 'NAO_ENCONTRADO' });
const invalido = (mensagem, codigo) => new ErroHttp(422, mensagem, { codigo });

/** Formato da retaguarda: turnos e insumos achatados. */
export function produtoPublico(p) {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    categoria: p.categoria,
    tipoPreco: p.tipoPreco,
    precoCentavos: p.precoCentavos,
    ativo: p.ativo,
    disponivelHoje: p.disponivelHoje,
    vendidoNoSite: p.vendidoNoSite,
    sugerirNaSacola: p.sugerirNaSacola,
    imagemUrl: p.imagemUrl,
    controlaEstoque: p.controlaEstoque,
    estoque: p.estoque,
    estoqueMinimo: p.estoqueMinimo,
    ordem: p.ordem,
    turnos: p.turnos.map((t) => t.turno),
    insumos: p.insumos.map((pi) => ({ insumoId: pi.insumo.id, nome: pi.insumo.nome, quantidade: pi.quantidade })),
    esgotado: !temSaldo(p),
  };
}

/**
 * Função pura: regras do produto que o schema zod não cobre.
 * @returns {ErroHttp | null}
 */
export function conferirRegras(d) {
  if (d.tipoPreco === 'POR_KG' && (d.controlaEstoque || d.insumos.length)) {
    return invalido('Produto por quilo não controla estoque nem consome insumos.', 'POR_KG_SEM_ESTOQUE');
  }
  if (d.ativo && d.precoCentavos <= 0) {
    return invalido('Defina o preço antes de ativar o produto.', 'PRECO_OBRIGATORIO');
  }
  return null;
}

/** Categoria, turnos e insumos precisam existir NA LOJA do produto. */
async function conferirReferencias(lojaId, d, tx) {
  if ((await produtoRepo.contarCategorias(lojaId, [d.categoriaId], tx)) !== 1) {
    throw invalido('Categoria não encontrada.', 'CATEGORIA_INVALIDA');
  }
  if ((await produtoRepo.contarTurnos(lojaId, d.turnoIds, tx)) !== d.turnoIds.length) {
    throw invalido('Turno não encontrado.', 'TURNO_INVALIDO');
  }
  const insumoIds = d.insumos.map((i) => i.insumoId);
  if ((await produtoRepo.contarInsumos(lojaId, insumoIds, tx)) !== insumoIds.length) {
    throw invalido('Insumo não encontrado.', 'INSUMO_INVALIDO');
  }
}

const camposDoProduto = (d) => ({
  nome: d.nome,
  descricao: d.descricao,
  categoriaId: d.categoriaId,
  tipoPreco: d.tipoPreco,
  precoCentavos: d.precoCentavos,
  ativo: d.ativo,
  vendidoNoSite: d.vendidoNoSite,
  sugerirNaSacola: d.sugerirNaSacola,
  imagemUrl: d.imagemUrl,
  controlaEstoque: d.controlaEstoque,
  estoqueMinimo: d.estoqueMinimo,
  ordem: d.ordem,
});

async function gravar(lojaId, fn) {
  try {
    const id = await prisma.$transaction(fn, OPCOES_TRANSACAO);
    avisarCardapioAtualizado(lojaId, 'produtos');
    return produtoPublico(await produtoRepo.buscarPorId(lojaId, id));
  } catch (err) {
    if (ehDuplicado(err)) throw new ErroHttp(409, 'Já existe um produto com este nome', { codigo: 'NOME_EM_USO' });
    throw err;
  }
}

export async function listar(lojaId) {
  return (await produtoRepo.listar(lojaId)).map(produtoPublico);
}

export async function obter(lojaId, id) {
  const p = await produtoRepo.buscarPorId(lojaId, id);
  if (!p) throw naoEncontrado();
  return produtoPublico(p);
}

/** Produto novo nasce disponível hoje (como no seed) e, se controla estoque, com saldo 0. */
export function criar(lojaId, d) {
  const erro = conferirRegras(d);
  if (erro) throw erro;
  return gravar(lojaId, async (tx) => {
    await conferirReferencias(lojaId, d, tx);
    const { id } = await produtoRepo.criar(
      lojaId,
      { ...camposDoProduto(d), disponivelHoje: true, estoque: d.controlaEstoque ? 0 : null },
      tx,
    );
    await produtoRepo.definirTurnos(id, d.turnoIds, tx);
    await produtoRepo.definirInsumos(id, d.insumos, tx);
    return id;
  });
}

/** Edição completa (o formulário manda tudo). `disponivelHoje` e `estoque` não mudam aqui. */
export function atualizar(lojaId, id, d) {
  const erro = conferirRegras(d);
  if (erro) throw erro;
  return gravar(lojaId, async (tx) => {
    const atual = await produtoRepo.buscarEstado(lojaId, id, tx);
    if (!atual) throw naoEncontrado();
    await conferirReferencias(lojaId, d, tx);
    const ligouControle = d.controlaEstoque && atual.estoque == null;
    await produtoRepo.atualizar(lojaId, id, { ...camposDoProduto(d), ...(ligouControle && { estoque: 0 }) }, tx);
    await produtoRepo.definirTurnos(id, d.turnoIds, tx);
    await produtoRepo.definirInsumos(id, d.insumos, tx);
    return id;
  });
}

// ───────── Cardápio do dia ─────────

/**
 * Produtos ativos (de categoria ativa) do turno escolhido; sem turno: o
 * ativo, senão o da próxima abertura, senão o primeiro (mesma regra do PDV).
 */
export async function cardapioDoDia(lojaId, { turnoId } = {}, agora = new Date()) {
  const todos = await turnoRepo.listarComHorarios(lojaId);
  const ativos = todos.filter((t) => t.ativo);
  const ativo = calcularTurnoAtivo(ativos, agora);
  let turno;
  if (turnoId) {
    const t = todos.find((x) => x.id === turnoId);
    if (!t) throw new ErroHttp(404, 'Turno não encontrado', { codigo: 'NAO_ENCONTRADO' });
    turno = { id: t.id, nome: t.nome };
  } else {
    const primeiro = todos[0] ? { id: todos[0].id, nome: todos[0].nome } : null;
    turno = ativo ?? calcularProximaAbertura(ativos, agora)?.turno ?? primeiro;
  }
  const produtos = turno ? (await produtoRepo.listarDoTurno(lojaId, turno.id)).map(produtoPublico) : [];
  return { turno, turnoAtivo: ativo, turnos: todos.map((t) => ({ id: t.id, nome: t.nome })), produtos };
}

async function definirCampo(lojaId, id, dados) {
  try {
    const p = await produtoRepo.definirCampo(lojaId, id, dados);
    avisarCardapioAtualizado(lojaId, 'cardapio-do-dia');
    return produtoPublico(p);
  } catch (err) {
    if (err?.code === 'P2025') throw naoEncontrado();
    throw err;
  }
}

export const definirDisponivelHoje = (lojaId, id, disponivelHoje) => definirCampo(lojaId, id, { disponivelHoje });

export const definirDescricao = (lojaId, id, descricao) => definirCampo(lojaId, id, { descricao });

/** Liga disponivelHoje em todos os produtos ativos do turno. */
export async function liberarTudo(lojaId, turnoId) {
  const turnos = await turnoRepo.listarComHorarios(lojaId);
  if (!turnos.some((t) => t.id === turnoId)) {
    throw new ErroHttp(404, 'Turno não encontrado', { codigo: 'NAO_ENCONTRADO' });
  }
  const liberados = await produtoRepo.liberarTudo(lojaId, turnoId);
  avisarCardapioAtualizado(lojaId, 'cardapio-do-dia');
  return { liberados };
}
