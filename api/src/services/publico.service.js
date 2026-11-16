/** Dados públicos do site (sem login): cardápio do turno ativo, bairros, config. */
import { diaOperacional } from '../lib/fuso.js';
import { horaViradaDe } from './diaOperacional.service.js';
import * as publicoRepo from '../repositories/publico.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';

// Mesmos defaults do schema, caso a linha única ainda não exista (seed não rodou).
const CONFIG_PADRAO = {
  nomeRestaurante: 'Cabana Boemia',
  whatsappNumero: '',
  tempoEstimadoPadraoMin: 40,
  tempoEstimadoManualMin: null,
  tempoManualDefinidoEm: null,
};

async function configuracao() {
  return (await publicoRepo.buscarConfiguracao()) ?? CONFIG_PADRAO;
}

/**
 * Manual vale só no dia OPERACIONAL em que foi definido (o tempo digitado às
 * 23h continua valendo às 00:30); senão, o padrão.
 */
export function manualDeHoje(config, agora) {
  const virada = horaViradaDe(config);
  return (
    config.tempoEstimadoManualMin != null &&
    config.tempoManualDefinidoEm != null &&
    diaOperacional(config.tempoManualDefinidoEm, virada) === diaOperacional(agora, virada)
  );
}

export function calcularTempoEstimado(config, agora) {
  return manualDeHoje(config, agora) ? config.tempoEstimadoManualMin : config.tempoEstimadoPadraoMin;
}

/** Estoque próprio > 0 (se controla) e todo insumo com saldo para 1 unidade. */
export function temSaldo(produto) {
  if (produto.controlaEstoque && !((produto.estoque ?? 0) > 0)) return false;
  return produto.insumos.every((pi) => pi.insumo.estoque >= pi.quantidade);
}

/**
 * Aberto: produtos do turno ativo, disponíveis hoje e com saldo.
 * Fechado: prévia do turno da próxima abertura (ativos e vendidos no site),
 * SEM filtrar disponivelHoje nem saldo, que valem só para o dia corrente.
 * O site mostra a prévia com os botões desabilitados.
 */
export async function cardapio(agora = new Date()) {
  const [turnos, config] = await Promise.all([turnoRepo.listarAtivosComHorarios(), configuracao()]);
  const turno = calcularTurnoAtivo(turnos, agora);
  const proximaAbertura = turno ? null : calcularProximaAbertura(turnos, agora);
  const base = {
    aberto: turno !== null,
    turno,
    proximaAbertura,
    tempoEstimadoMin: calcularTempoEstimado(config, agora),
  };

  const turnoDoCardapio = turno ?? proximaAbertura?.turno;
  if (!turnoDoCardapio) return { ...base, categorias: [] };

  const produtos = await publicoRepo.listarProdutosDoSite(turnoDoCardapio.id, {
    somenteDisponiveisHoje: Boolean(turno),
  });

  // Produtos já vêm ordenados por categoria.ordem e produto.ordem.
  const categorias = [];
  for (const p of produtos) {
    if (turno && !temSaldo(p)) continue;
    let cat = categorias.at(-1);
    if (cat?.id !== p.categoria.id) {
      cat = { id: p.categoria.id, nome: p.categoria.nome, produtos: [] };
      categorias.push(cat);
    }
    cat.produtos.push({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao,
      tipoPreco: p.tipoPreco,
      precoCentavos: p.precoCentavos,
    });
  }
  return { ...base, categorias };
}

export function bairros() {
  return publicoRepo.listarBairrosAtivos();
}

export async function config() {
  const c = await configuracao();
  return {
    nome: c.nomeRestaurante,
    whatsapp: c.whatsappNumero,
    // O Client ID OAuth é público: o site precisa dele para desenhar o botão do Google.
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  };
}
