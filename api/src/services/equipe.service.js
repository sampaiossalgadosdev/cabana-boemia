/** Operações da equipe logada (PDV): fila do dia, finalizar pedido, tempo estimado. */
import { ErroHttp } from '../lib/erros.js';
import { diaLocal } from '../lib/fuso.js';
import { paraBusca } from '../lib/texto.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { prisma } from '../lib/prisma.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as configRepo from '../repositories/configuracao.repository.js';
import * as equipeRepo from '../repositories/equipe.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import * as enderecoService from './endereco.service.js';
import { pedidoPublico, STATUS_ABERTOS } from './pedido.service.js';
import { calcularTempoEstimado, temSaldo } from './publico.service.js';
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';

export { STATUS_ABERTOS };

export const TEMPO_MIN = 1;
export const TEMPO_MAX = 240;

/**
 * Pedidos de um dia local.
 * @param {{ dataRef: string, canais?: string[], somenteAbertos?: boolean }} filtro
 *   `dataRef`: "YYYY-MM-DD" ou "hoje" (dia local de `agora`).
 */
export async function listarPedidosDoDia({ dataRef, canais, somenteAbertos = true }, agora = new Date()) {
  const dia = dataRef === 'hoje' ? diaLocal(agora) : dataRef;
  const pedidos = await pedidoRepo.listarDoDia({
    dataRef: dia,
    canais,
    status: somenteAbertos ? STATUS_ABERTOS : undefined,
  });
  return { dataRef: dia, pedidos: pedidos.map(pedidoPublico) };
}

/**
 * Finaliza um pedido aberto. A forma de pagamento informada SOBRESCREVE a
 * escolhida pelo cliente (vale o que foi pago de fato). Troco só existe em
 * DINHEIRO: em outra forma é apagado. Avisa a equipe com "pedido:atualizado".
 */
export async function finalizarPedido(id, { formaPagamento }, agora = new Date()) {
  const atual = await pedidoRepo.buscarPorId(id);
  if (!atual) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });

  const count = await pedidoRepo.finalizarSeAberto(
    id,
    {
      formaPagamento,
      trocoParaCentavos: formaPagamento === 'DINHEIRO' ? atual.trocoParaCentavos : null,
      finalizadoEm: agora,
    },
    STATUS_ABERTOS,
  );
  if (count === 0) {
    // Já encerrado (ou outra atendente finalizou no mesmo instante).
    const s = await pedidoRepo.buscarStatus(id);
    const situacao = s?.status === 'CANCELADO' ? 'cancelado' : 'finalizado';
    throw new ErroHttp(409, `Pedido já está ${situacao}`, { codigo: 'PEDIDO_ENCERRADO' });
  }

  const pedido = pedidoPublico(await pedidoRepo.buscarPorId(id));
  emitirParaEquipe('pedido:atualizado', pedido);
  return pedido;
}

const CONFIG_PADRAO = { tempoEstimadoPadraoMin: 40, tempoEstimadoManualMin: null, tempoManualDefinidoEm: null };

/** `manualMin` só aparece se foi definido hoje (dia local); senão null. */
function tempoPublico(config, agora) {
  const c = config ?? CONFIG_PADRAO;
  const manualDeHoje =
    c.tempoEstimadoManualMin != null &&
    c.tempoManualDefinidoEm != null &&
    diaLocal(c.tempoManualDefinidoEm) === diaLocal(agora);
  return {
    padraoMin: c.tempoEstimadoPadraoMin,
    manualMin: manualDeHoje ? c.tempoEstimadoManualMin : null,
    vigenteMin: calcularTempoEstimado(c, agora),
  };
}

export async function obterTempoEstimado(agora = new Date()) {
  return tempoPublico(await configRepo.buscar(), agora);
}

/** `minutos` null = volta ao padrão (limpa o manual e a data). */
export async function definirTempoEstimado(minutos, agora = new Date()) {
  const config = await configRepo.definirTempoManual({
    tempoEstimadoManualMin: minutos,
    tempoManualDefinidoEm: minutos == null ? null : agora,
  });
  return tempoPublico(config, agora);
}

// ───────── Clientes (lançamento do WhatsApp) ─────────

export const BUSCA_LIMITE = 10;

/** Cliente com endereços (principal primeiro) e a taxa de cada bairro. */
function clienteDaEquipe(c) {
  return {
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    enderecos: c.enderecos.map((e) => ({
      id: e.id,
      rua: e.rua,
      numero: e.numero,
      complemento: e.complemento,
      referencia: e.referencia,
      principal: e.principal,
      bairro: e.bairro,
    })),
  };
}

/**
 * Busca por nome, ignorando acento e maiúsculas ("joao" acha "João", pela
 * coluna nomeBusca), ou por trecho do telefone (a partir de 3 dígitos).
 * @param {string} busca já com trim e pelo menos 2 caracteres
 */
export async function buscarClientes(busca) {
  const digitos = busca.replace(/\D/g, '');
  const clientes = await equipeRepo.buscarClientes(
    { termo: paraBusca(busca), digitos: digitos.length >= 3 ? digitos : null },
    BUSCA_LIMITE,
  );
  return clientes.map(clienteDaEquipe);
}

/**
 * Cadastro rápido: cliente + endereço principal, numa transação. Telefone já
 * cadastrado = 409 CLIENTE_JA_EXISTE com o cliente existente (o PDV seleciona ele).
 */
export async function criarCliente({ nome, telefone, endereco }) {
  const existente = await equipeRepo.buscarClientePorTelefone(telefone);
  if (existente) {
    throw new ErroHttp(409, `Já existe cliente com este telefone: ${existente.nome}`, {
      codigo: 'CLIENTE_JA_EXISTE',
      detalhes: { cliente: clienteDaEquipe(existente) },
    });
  }
  const id = await prisma.$transaction(async (tx) => {
    const bairro = await pedidoRepo.buscarBairro(endereco.bairroId, tx);
    if (!bairro?.ativo) throw new ErroHttp(422, 'Não entregamos neste bairro', { codigo: 'BAIRRO_INVALIDO' });
    const cliente = await equipeRepo.criarCliente({ nome, telefone }, tx);
    await tx.endereco.create({ data: { ...endereco, clienteId: cliente.id, principal: true } });
    return cliente.id;
  });
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(id));
}

/** Endereço novo para cliente existente (vira o principal: é para onde vai agora). */
export async function adicionarEndereco(clienteId, endereco) {
  if (!(await equipeRepo.buscarClientePorId(clienteId))) {
    throw new ErroHttp(404, 'Cliente não encontrado', { codigo: 'NAO_ENCONTRADO' });
  }
  await enderecoService.criar(clienteId, { ...endereco, principal: true });
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(clienteId));
}

// ───────── Cardápio do PDV ─────────

/**
 * Quantas unidades dá para vender agora: menor entre o estoque próprio (se
 * controla) e o que cada insumo permite. null = sem limite de estoque.
 */
export function saldoDisponivel(produto) {
  const limites = [];
  if (produto.controlaEstoque) limites.push(Math.max(0, produto.estoque ?? 0));
  for (const pi of produto.insumos) limites.push(Math.max(0, Math.floor(pi.insumo.estoque / pi.quantidade)));
  return limites.length ? Math.min(...limites) : null;
}

/**
 * Grade do lançamento: produtos do turno pedido, ou do ativo, ou (loja
 * fechada) do da próxima abertura. Esgotado vem marcado (a grade desabilita);
 * fora de "disponível hoje" vem marcado mas pode ser lançado (só o site bloqueia).
 * @param {{ turnoId?: number }} filtro
 */
export async function cardapioDaEquipe({ turnoId } = {}, agora = new Date()) {
  const turnos = await turnoRepo.listarAtivosComHorarios();
  const ativo = calcularTurnoAtivo(turnos, agora);
  let turno = null;
  if (turnoId) {
    const t = turnos.find((x) => x.id === turnoId);
    if (!t) throw new ErroHttp(404, 'Turno não encontrado', { codigo: 'NAO_ENCONTRADO' });
    turno = { id: t.id, nome: t.nome };
  } else {
    const primeiro = turnos[0] ? { id: turnos[0].id, nome: turnos[0].nome } : null;
    turno = ativo ?? calcularProximaAbertura(turnos, agora)?.turno ?? primeiro;
  }

  const base = {
    turno,
    turnoAtivo: ativo,
    turnos: turnos.map((t) => ({ id: t.id, nome: t.nome })),
  };
  if (!turno) return { ...base, categorias: [] };

  const categorias = [];
  for (const p of await equipeRepo.listarProdutosDoTurno(turno.id)) {
    let cat = categorias.at(-1);
    if (cat?.id !== p.categoria.id) {
      cat = { id: p.categoria.id, nome: p.categoria.nome, produtos: [] };
      categorias.push(cat);
    }
    cat.produtos.push({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      precoCentavos: p.precoCentavos,
      disponivelHoje: p.disponivelHoje,
      esgotado: !temSaldo(p),
      saldo: saldoDisponivel(p),
    });
  }
  return { ...base, categorias };
}
