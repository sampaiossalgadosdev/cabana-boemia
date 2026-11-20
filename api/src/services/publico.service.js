/** Dados públicos do site (sem login) de uma loja: cardápio do turno ativo, bairros, config. */
import { freteGratisDaConfig } from '@restaurante/shared/frete';
import { diaOperacional } from '../lib/fuso.js';
import { horaViradaDe } from './diaOperacional.service.js';
import * as publicoRepo from '../repositories/publico.repository.js';
import * as turnoRepo from '../repositories/turno.repository.js';
import * as lojaService from './loja.service.js';
import * as bairroService from './bairro.service.js';
import { calcularTurnoAtivo, calcularProximaAbertura } from './turno.service.js';

/** Máximo por linha de pedido (itemPedidoSchema) e na sacola do site. */
export const MAX_POR_ITEM = 20;

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
/**
 * Unidades possíveis agora pelo estoque próprio e pelos insumos (cada
 * produto sozinho); null = sem controle de estoque.
 */
export function saldoDisponivel(produto) {
  const limites = [];
  if (produto.controlaEstoque) limites.push(Math.max(0, produto.estoque ?? 0));
  for (const pi of produto.insumos) limites.push(Math.max(0, Math.floor(pi.insumo.estoque / pi.quantidade)));
  return limites.length ? Math.min(...limites) : null;
}

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
export async function cardapio(lojaId, agora = new Date()) {
  const [turnos, config] = await Promise.all([turnoRepo.listarAtivosComHorarios(lojaId), lojaService.buscar(lojaId)]);
  const turno = calcularTurnoAtivo(turnos, agora);
  const proximaAbertura = turno ? null : calcularProximaAbertura(turnos, agora);
  const base = {
    aberto: turno !== null,
    turno,
    proximaAbertura,
    tempoEstimadoMin: calcularTempoEstimado(config, agora),
    // Também aqui (além de /publico/config): o site recarrega o cardápio a
    // cada 30 s, então a barra de frete grátis acompanha a retaguarda.
    freteGratis: freteGratisDaConfig(config),
  };

  const turnoDoCardapio = turno ?? proximaAbertura?.turno;
  if (!turnoDoCardapio) return { ...base, categorias: [] };

  const produtos = await publicoRepo.listarProdutosDoSite(lojaId, turnoDoCardapio.id, {
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
      sugerirNaSacola: p.sugerirNaSacola,
      imagemUrl: p.imagemUrl,
      // Limite do "+" na sacola: o saldo, mas nunca acima do máximo por item, para
      // não revelar o estoque (prévia; a API confere na baixa). Fechado: null.
      maxSacola: turno ? Math.min(saldoDisponivel(p) ?? MAX_POR_ITEM, MAX_POR_ITEM) : null,
    });
  }
  return { ...base, categorias };
}

/** Onde a loja entrega agora (área ativa, bairro ativo na cidade): `{ id, nome, taxaCentavos }`. */
export function bairros(lojaId) {
  return bairroService.listarOndeEntrega(lojaId);
}

export async function config(lojaId) {
  const c = await lojaService.buscar(lojaId);
  return {
    nome: c.nome,
    // Identidade da loja (app multi-loja; o site atual ignora).
    slug: c.slug,
    logoUrl: c.logoUrl ?? null,
    corPrimaria: c.corPrimaria ?? null,
    corFundo: c.corFundo ?? null,
    whatsapp: c.whatsapp,
    // null = desligado; { minimoCentavos } = frete grátis com subtotal >= mínimo.
    freteGratis: freteGratisDaConfig(c),
    // O Client ID OAuth é público: o site precisa dele para desenhar o botão do Google.
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  };
}
