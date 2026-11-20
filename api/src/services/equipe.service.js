/** Operações da equipe logada (PDV): fila do dia, finalizar pedido, tempo estimado. */
import { freteGratisDaConfig } from '@restaurante/shared/frete';
import { ErroHttp } from '../lib/erros.js';
import { diaOperacional } from '../lib/fuso.js';
import { horaVirada } from './diaOperacional.service.js';
import { paraBusca } from '../lib/texto.js';
import { emitirParaEquipe } from '../lib/eventos.js';
import { prisma } from '../lib/prisma.js';
import * as pedidoRepo from '../repositories/pedido.repository.js';
import * as lojaRepo from '../repositories/loja.repository.js';
import * as lojaService from './loja.service.js';
import * as equipeRepo from '../repositories/equipe.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import * as enderecoService from './endereco.service.js';
import { bairroParaLoja } from './bairro.service.js';
import { OPCOES_TRANSACAO, pedidoDaEquipe, STATUS_ABERTOS, ehDaLoja } from './pedido.service.js';
import { exigirCaixaAberto } from './caixa.service.js';
import { calcularTempoEstimado, manualDeHoje, saldoDisponivel, temSaldo } from './publico.service.js';

export { saldoDisponivel };
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';

export { STATUS_ABERTOS };

export const TEMPO_MIN = 1;
export const TEMPO_MAX = 240;

/**
 * Pedidos de um dia operacional (dataRef).
 * @param {{ dataRef: string, canais?: string[], somenteAbertos?: boolean }} filtro
 *   `dataRef`: "YYYY-MM-DD" ou "hoje" (dia operacional de `agora`).
 */
export async function listarPedidosDoDia(lojaId, { dataRef, canais, somenteAbertos = true }, agora = new Date()) {
  const dia = dataRef === 'hoje' ? diaOperacional(agora, await horaVirada(lojaId)) : dataRef;
  const pedidos = await pedidoRepo.listarDoDia({
    lojaId,
    dataRef: dia,
    canais,
    status: somenteAbertos ? STATUS_ABERTOS : undefined,
  });
  return { dataRef: dia, pedidos: pedidos.map(pedidoDaEquipe) };
}

/**
 * Finaliza um pedido aberto. A forma de pagamento informada SOBRESCREVE a
 * escolhida pelo cliente (vale o que foi pago de fato). Troco só existe em
 * DINHEIRO: em outra forma é apagado. Exige caixa aberto (409 CAIXA_FECHADO)
 * e grava o `caixaId`: o pedido entra no caixa em que foi finalizado.
 * Avisa a equipe com "pedido:atualizado".
 */
export async function finalizarPedido(lojaId, id, { formaPagamento }, agora = new Date()) {
  const pedido = await prisma.$transaction(async (tx) => {
    // Caixa primeiro (mesma ordem de travas do fechamento de comanda): caixa → pedido.
    const caixaId = await exigirCaixaAberto(lojaId, tx);
    const atual = await pedidoRepo.buscarPorId(id, tx);
    if (!ehDaLoja(atual, lojaId)) throw new ErroHttp(404, 'Pedido não encontrado', { codigo: 'NAO_ENCONTRADO' });
    // Já pago ("pago agora" no PDV): vale a forma em que foi pago; a informada é ignorada.
    // O caixa do pagamento é o aberto agora (com pedido aberto o caixa não fecha).
    const forma = atual.pagoEm ? atual.formaPagamento : formaPagamento;

    const count = await pedidoRepo.finalizarSeAberto(
      id,
      {
        formaPagamento: forma,
        trocoParaCentavos: forma === 'DINHEIRO' ? atual.trocoParaCentavos : null,
        finalizadoEm: agora,
        caixaId,
      },
      STATUS_ABERTOS,
      tx,
    );
    if (count === 0) {
      // Já encerrado (ou outra atendente finalizou no mesmo instante).
      const s = await pedidoRepo.buscarStatus(id, tx);
      const situacao = s?.status === 'CANCELADO' ? 'cancelado' : 'finalizado';
      throw new ErroHttp(409, `Pedido já está ${situacao}`, { codigo: 'PEDIDO_ENCERRADO' });
    }
    return pedidoRepo.buscarPorId(id, tx);
  }, OPCOES_TRANSACAO);

  const equipe = pedidoDaEquipe(pedido);
  emitirParaEquipe(lojaId, 'pedido:atualizado', equipe);
  return equipe;
}

/** `manualMin` só aparece se foi definido hoje (dia operacional); senão null. */
function tempoPublico(c, agora) {
  return {
    padraoMin: c.tempoEstimadoPadraoMin,
    manualMin: manualDeHoje(c, agora) ? c.tempoEstimadoManualMin : null,
    vigenteMin: calcularTempoEstimado(c, agora),
  };
}

export async function obterTempoEstimado(lojaId, agora = new Date()) {
  return tempoPublico(await lojaService.buscar(lojaId), agora);
}

/** `minutos` null = volta ao padrão (limpa o manual e a data). */
export async function definirTempoEstimado(lojaId, minutos, agora = new Date()) {
  await lojaService.buscar(lojaId);
  const config = await lojaRepo.definirTempoManual(lojaId, {
    tempoEstimadoManualMin: minutos,
    tempoManualDefinidoEm: minutos == null ? null : agora,
  });
  return tempoPublico(config, agora);
}

// ───────── Clientes (lançamento do WhatsApp) ─────────

export const BUSCA_LIMITE = 10;

/**
 * Cliente com endereços (principal primeiro) e o bairro de cada um visto pela
 * loja (taxa dela; `ativo` = a loja entrega lá).
 * `doSite`: cadastro feito pelo login do Google (nome e e-mail são do cliente).
 */
function clienteDaEquipe(c, lojaId) {
  return {
    id: c.id,
    nome: c.nome,
    email: c.email ?? null,
    telefone: c.telefone,
    observacao: c.observacao ?? null,
    doSite: Boolean(c.googleId),
    enderecos: c.enderecos.map((e) => ({
      id: e.id,
      rua: e.rua,
      numero: e.numero,
      complemento: e.complemento,
      referencia: e.referencia,
      cep: e.cep ?? null,
      cidade: e.cidade ?? null,
      estado: e.estado ?? null,
      principal: e.principal,
      bairro: bairroParaLoja(e.bairro, lojaId),
    })),
  };
}

const clienteJaExiste = (existente, lojaId) =>
  new ErroHttp(409, `Já existe cliente com este telefone: ${existente.nome}`, {
    codigo: 'CLIENTE_JA_EXISTE',
    detalhes: { cliente: clienteDaEquipe(existente, lojaId) },
  });

const clienteNaoEncontrado = () => new ErroHttp(404, 'Cliente não encontrado', { codigo: 'NAO_ENCONTRADO' });

/**
 * Busca por nome, ignorando acento e maiúsculas ("joao" acha "João", pela
 * coluna nomeBusca), ou por trecho do telefone (a partir de 3 dígitos).
 * @param {string} busca já com trim e pelo menos 2 caracteres
 */
export async function buscarClientes(lojaId, busca) {
  const digitos = busca.replace(/\D/g, '');
  const clientes = await equipeRepo.buscarClientes(
    { termo: paraBusca(busca), digitos: digitos.length >= 3 ? digitos : null },
    BUSCA_LIMITE,
  );
  return clientes.map((c) => clienteDaEquipe(c, lojaId));
}

/**
 * Cadastro rápido: cliente (+ endereço principal, se vier), numa transação.
 * Sem endereço: encomenda retirada no balcão. Telefone já cadastrado = 409
 * CLIENTE_JA_EXISTE com o cliente existente (o PDV seleciona ele).
 */
export async function criarCliente(lojaId, { nome, telefone, email = null, observacao = null, endereco = null }) {
  const existente = await equipeRepo.buscarClientePorTelefone(telefone);
  if (existente) throw clienteJaExiste(existente, lojaId);
  const id = await prisma.$transaction(async (tx) => {
    // Cadastro único entre lojas: o endereço aponta para um bairro da cidade.
    if (endereco) await enderecoService.garantirBairroAtivo(endereco.bairroId, tx);
    const cliente = await equipeRepo.criarCliente({ nome, telefone, email, observacao }, tx);
    if (endereco) await tx.endereco.create({ data: { ...endereco, clienteId: cliente.id, principal: true } });
    return cliente.id;
  });
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(id), lojaId);
}

/**
 * Edição pelo PDV. Cadastro do site (login Google): nome e e-mail são do
 * cliente e não mudam aqui; o telefone só é preenchido se estiver vazio; a
 * observação (anotação da equipe) muda sempre. Telefone de outro cliente = 409.
 */
export async function atualizarCliente(lojaId, id, { nome, telefone, email = null, observacao = null }) {
  const atual = await equipeRepo.buscarClientePorId(id);
  if (!atual) throw clienteNaoEncontrado();
  const dados = { observacao };
  if (!atual.googleId) Object.assign(dados, { nome, telefone, email });
  else if (!atual.telefone) dados.telefone = telefone;
  if (dados.telefone && dados.telefone !== atual.telefone) {
    const outro = await equipeRepo.buscarClientePorTelefone(dados.telefone, undefined, id);
    if (outro) throw clienteJaExiste(outro, lojaId);
  }
  await equipeRepo.atualizarCliente(id, dados);
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(id), lojaId);
}

/** Endereço novo para cliente existente (vira o principal: é para onde vai agora). */
export async function adicionarEndereco(lojaId, clienteId, endereco) {
  if (!(await equipeRepo.buscarClientePorId(clienteId))) throw clienteNaoEncontrado();
  await enderecoService.criar(clienteId, { ...endereco, principal: true }, { lojaId });
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(clienteId), lojaId);
}

/** Corrige um endereço do cliente (de outro cliente = 404); vira o principal, como o novo. */
export async function atualizarEndereco(lojaId, clienteId, enderecoId, endereco) {
  if (!(await equipeRepo.buscarClientePorId(clienteId))) throw clienteNaoEncontrado();
  await enderecoService.atualizar(clienteId, enderecoId, { ...endereco, principal: true }, { lojaId });
  return clienteDaEquipe(await equipeRepo.buscarClientePorId(clienteId), lojaId);
}

// ───────── Cardápio do PDV ─────────

/**
 * Grade do lançamento: produtos do turno pedido, ou do ativo, ou (loja
 * fechada) do da próxima abertura. Esgotado vem marcado (a grade desabilita);
 * fora de "disponível hoje" vem marcado mas pode ser lançado (só o site bloqueia).
 * `porKg`: produtos por quilo do turno (preço do quilo), para o salão.
 * `freteGratis`: regra vigente (`{ minimoCentavos }` ou null), para a prévia do delivery.
 * @param {{ turnoId?: number }} filtro
 */
export async function cardapioDaEquipe(lojaId, { turnoId } = {}, agora = new Date()) {
  const [turnos, config] = await Promise.all([turnoRepo.listarAtivosComHorarios(lojaId), lojaService.buscar(lojaId)]);
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
    // Prévia do delivery (a taxa oficial é a da API): null = frete grátis desligado.
    freteGratis: freteGratisDaConfig(config, { canal: 'WHATSAPP' }),
  };
  if (!turno) return { ...base, categorias: [], porKg: [] };

  const categorias = [];
  for (const p of await equipeRepo.listarProdutosDoTurno(lojaId, turno.id)) {
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
  // "Prato por kg" do salão: botão próprio com teclado de gramas (a grade é só UNIDADE).
  const porKg = await equipeRepo.listarPorKgDoTurno(lojaId, turno.id);
  return { ...base, categorias, porKg };
}
