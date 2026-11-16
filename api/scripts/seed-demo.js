/**
 * Dados de demonstração (roteiro em DEMO.md):
 *   npm run seed:demo -w api               (dev)
 *   npm run seed:demo -w api -- --confirmar (com NODE_ENV=production)
 *
 * Cria, pelos MESMOS services da API (preço do banco, baixa de estoque, número do dia, caixa):
 *   - 5 clientes com endereço (reaproveita se o telefone já existe);
 *   - 8 pedidos do dia: 3 do site, 3 do WhatsApp e 2 comandas do salão já fechadas
 *     (5 finalizados em formas diferentes, 2 abertos na fila do PDV, 1 cancelado);
 *   - 2 comandas abertas no salão (uma com prato por quilo).
 *
 * Também prepara o terreno: bairros (só se não houver nenhum ativo), preço do "Prato por kg"
 * (só se ainda for 0), entrada de estoque das bebidas e dos pães, caixa aberto (se não houver)
 * e, no fim, o "Pão de lanche" ajustado para 5 unidades (para o roteiro "pão acabando").
 * Os cupons gerados aqui ficam marcados como impressos: a impressora não despeja 8 cupons
 * quando o PDV abrir. Recusa rodar duas vezes no mesmo dia operacional.
 *
 * Site com a loja fechada: o pedido passa pelo mesmo criarPedido do WhatsApp (sem trava de
 * horário) e depois é marcado como SITE; assim o script funciona a qualquer hora.
 */
import { parseArgs } from 'node:util';
import { prisma } from '../src/lib/prisma.js';
import { ErroHttp } from '../src/lib/erros.js';
import { diaOperacional, paraCampoData } from '../src/lib/fuso.js';
import { horaVirada } from '../src/services/diaOperacional.service.js';
import { criarPedidoDoSite, criarPedidoDoWhatsapp, cancelarPedido } from '../src/services/pedido.service.js';
import { criarCliente, finalizarPedido } from '../src/services/equipe.service.js';
import { abrirComanda, lancarItem, fecharComanda } from '../src/services/comanda.service.js';
import { abrirCaixa, caixaAtual } from '../src/services/caixa.service.js';
import { registrarEntrada, registrarAjuste } from '../src/services/estoque.service.js';

const MOTIVO = 'Demonstração (seed:demo)';
const PRECO_KG_DEMO = 5990; // R$ 59,90 o quilo, só se o dono ainda não definiu
const BAIRROS_DEMO = [
  { nome: 'Centro', taxaCentavos: 500 },
  { nome: 'Jardim Primavera', taxaCentavos: 700 },
];

const CLIENTES = [
  { chave: 'ana', nome: 'Ana Souza', telefone: '43990000001', rua: 'Rua Paraná', numero: '120', bairro: 0 },
  { chave: 'bruno', nome: 'Bruno Lima', telefone: '43990000002', rua: 'Rua São Paulo', numero: '45', complemento: 'Casa 2', bairro: 0 },
  { chave: 'carla', nome: 'Carla Mendes', telefone: '43990000003', rua: 'Avenida Brasil', numero: '890', bairro: 1 },
  { chave: 'diego', nome: 'Diego Rocha', telefone: '43990000004', rua: 'Rua das Flores', numero: '33', referencia: 'perto da praça', bairro: 1 },
  { chave: 'elaine', nome: 'Elaine Costa', telefone: '43990000005', rua: 'Rua Goiás', numero: '210', bairro: 0 },
];

// Itens por NOME (o seed cria os produtos por nome; ids mudam entre bancos).
const PEDIDOS = [
  { canal: 'SITE', cliente: 'ana', itens: [['X-Bacon', 2], ['Coca-Cola 2L', 1]], forma: 'PIX', depois: 'finalizar' },
  { canal: 'SITE', cliente: 'bruno', itens: [['Pizza Calabresa', 1], ['Refrigerante Lata', 2]], forma: 'DINHEIRO', troco: 10000, depois: 'finalizar' },
  { canal: 'SITE', cliente: 'carla', itens: [['Batata Frita com Cheddar e Bacon (500g)', 1, 'sem cebola'], ['Suco 900ml', 1]], forma: 'CREDITO', depois: 'aberto' },
  { canal: 'WHATSAPP', cliente: 'diego', itens: [['X-Tudo', 1], ['X-Salada', 1, 'sem tomate'], ['Coca-Cola 1L', 1]], forma: 'DINHEIRO', troco: 10000, depois: 'finalizar' },
  { canal: 'WHATSAPP', cliente: 'elaine', itens: [['Pizza 4 Queijos', 1]], forma: 'DEBITO', depois: 'aberto' },
  { canal: 'WHATSAPP', cliente: 'ana', itens: [['Cachorro Quente', 2]], forma: 'PIX', depois: 'cancelar' },
  { canal: 'SALAO', nome: 'Roberto', mesa: '2', itens: [['Prato por kg', 1, null, 487], ['Refrigerante Lata', 1]], forma: 'DEBITO', depois: 'fechar' },
  { canal: 'SALAO', nome: 'Lúcia', mesa: '6', itens: [['Frango a Passarinho (1kg)', 1], ['Suco 300ml', 2]], forma: 'CREDITO', depois: 'fechar' },
];

const COMANDAS_ABERTAS = [
  { nome: 'Família Silva', mesa: '4', itens: [['Prato por kg', 1, null, 612], ['Prato por kg', 1, null, 455], ['Coca-Cola 1L', 1]] },
  { nome: 'Seu Zé', mesa: '7', itens: [['Calabresa Acebolada (500g)', 1], ['Refrigerante Lata', 2], ['X-Burguer', 1, 'bem passado']] },
];

const ENTRADAS = {
  produtos: { 'Refrigerante Lata': 24, 'Coca-Cola 1L': 12, 'Coca-Cola 2L': 12, 'Suco 300ml': 12, 'Suco 900ml': 6 },
  insumos: { 'Pão de lanche': 20, 'Pão de cachorro-quente': 10 },
};
const PAO_ACABANDO = { insumo: 'Pão de lanche', saldo: 5 };

const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const log = (...a) => console.log(...a);

async function main() {
  const { values } = parseArgs({ options: { confirmar: { type: 'boolean', default: false } } });
  if (process.env.NODE_ENV === 'production' && !values.confirmar) {
    console.error('NODE_ENV=production: isto grava pedidos, clientes e estoque de demonstração no banco de produção.');
    console.error('Se é isso mesmo (demo no sistema publicado), rode de novo com: npm run seed:demo -w api -- --confirmar');
    process.exit(1);
  }

  const dono = await prisma.usuario.findFirst({ where: { papel: 'DONO', ativo: true }, orderBy: { id: 'asc' } });
  if (!dono) throw new Error('Nenhum DONO ativo. Rode antes: npm run criar-dono -w api -- --nome ... --email ... --senha ...');
  const usuarioId = dono.id;

  const agora = new Date();
  const dia = diaOperacional(agora, await horaVirada());
  const jaRodou = await prisma.pedido.count({
    where: { dataRef: paraCampoData(dia), cliente: { telefone: { in: CLIENTES.map((c) => c.telefone) } } },
  });
  if (jaRodou) {
    console.error(`Os dados de demonstração já foram criados no dia operacional ${dia} (${jaRodou} pedido(s) dos clientes de demo).`);
    process.exit(1);
  }
  const ultimoTrabalho = (await prisma.trabalhoImpressao.aggregate({ _max: { id: true } }))._max.id ?? 0;

  // ── Produtos e insumos por nome ──
  const produtos = new Map((await prisma.produto.findMany()).map((p) => [p.nome, p]));
  const insumos = new Map((await prisma.insumo.findMany()).map((i) => [i.nome, i]));
  const produto = (nome) => {
    const p = produtos.get(nome);
    if (!p) throw new Error(`Produto "${nome}" não existe. Rode antes: npm run seed -w api`);
    return p;
  };
  const insumo = (nome) => {
    const i = insumos.get(nome);
    if (!i) throw new Error(`Insumo "${nome}" não existe. Rode antes: npm run seed -w api`);
    return i;
  };
  const itensDe = (lista) =>
    lista.map(([nome, quantidade, observacao, pesoGramas]) => ({
      produtoId: produto(nome).id,
      quantidade,
      ...(observacao ? { observacao } : {}),
      ...(pesoGramas ? { pesoGramas } : {}),
    }));

  log(`Dia operacional: ${dia}. Usuário: ${dono.nome} (#${dono.id}).\n`);

  // ── 1. Bairros ──
  let bairros = await prisma.bairro.findMany({ where: { ativo: true }, orderBy: { id: 'asc' } });
  if (!bairros.length) {
    for (const b of BAIRROS_DEMO) await prisma.bairro.upsert({ where: { nome: b.nome }, update: { ativo: true }, create: b });
    bairros = await prisma.bairro.findMany({ where: { ativo: true }, orderBy: { id: 'asc' } });
    log(`Bairros: nenhum ativo; criados ${BAIRROS_DEMO.map((b) => `${b.nome} (${reais(b.taxaCentavos)})`).join(' e ')}. Ajuste na retaguarda.`);
  }
  const bairroDo = (i) => bairros[Math.min(i, bairros.length - 1)];

  // ── 2. Prato por kg ──
  const kg = produto('Prato por kg');
  if (kg.precoCentavos === 0 || !kg.ativo) {
    const preco = kg.precoCentavos || PRECO_KG_DEMO;
    await prisma.produto.update({ where: { id: kg.id }, data: { precoCentavos: preco, ativo: true } });
    produtos.set(kg.nome, { ...kg, precoCentavos: preco, ativo: true });
    log(`Prato por kg: ativado a ${reais(preco)}/kg${kg.precoCentavos ? '' : ' (preço de demonstração; defina o real na retaguarda)'}.`);
  }

  // ── 3. Estoque (entrada) ──
  for (const [nome, qtd] of Object.entries(ENTRADAS.produtos)) {
    if (!produto(nome).controlaEstoque) continue;
    await registrarEntrada({ produtoId: produto(nome).id }, { quantidade: qtd, motivo: MOTIVO }, { usuarioId });
  }
  for (const [nome, qtd] of Object.entries(ENTRADAS.insumos)) {
    await registrarEntrada({ insumoId: insumo(nome).id }, { quantidade: qtd, motivo: MOTIVO }, { usuarioId });
  }
  log('Estoque: entrada nas bebidas e nos pães.');

  // ── 4. Caixa ──
  if (!(await caixaAtual())) {
    await abrirCaixa({ valorInicialCentavos: 10000 }, { usuarioId });
    log('Caixa: aberto com fundo de troco de R$ 100,00.');
  } else {
    log('Caixa: já havia um aberto (os pedidos finalizados entram nele).');
  }

  // ── 5. Clientes ──
  const clientes = {};
  for (const c of CLIENTES) {
    let id;
    try {
      id = (await criarCliente({
        nome: c.nome,
        telefone: c.telefone,
        endereco: { rua: c.rua, numero: c.numero, complemento: c.complemento ?? null, referencia: c.referencia ?? null, bairroId: bairroDo(c.bairro).id },
      })).id;
    } catch (err) {
      if (err?.codigo !== 'CLIENTE_JA_EXISTE') throw err;
      id = err.detalhes.cliente.id;
    }
    const cliente = await prisma.cliente.findUnique({ where: { id }, include: { enderecos: { orderBy: [{ principal: 'desc' }, { id: 'desc' }] } } });
    if (!cliente.enderecos.length) throw new Error(`Cliente ${cliente.nome} sem endereço`);
    clientes[c.chave] = cliente;
  }
  log(`Clientes: ${CLIENTES.map((c) => c.nome).join(', ')}.\n`);

  // ── 6. Pedidos do dia ──
  const resumo = [];
  for (const spec of PEDIDOS) {
    const p = spec.canal === 'SALAO' ? await comandaFechada(spec, itensDe(spec.itens), usuarioId) : await delivery(spec, clientes[spec.cliente], itensDe(spec.itens), usuarioId);
    resumo.push(p);
  }

  // ── 7. Comandas abertas ──
  for (const c of COMANDAS_ABERTAS) {
    const comanda = await abrirComanda({ nomeCliente: c.nome, mesaRotulo: c.mesa }, { usuarioId });
    let atual = comanda;
    for (const item of itensDe(c.itens)) atual = await lancarItem(comanda.id, item, { usuarioId });
    resumo.push({ numero: atual.numeroDia, canal: 'SALAO', quem: `${c.nome} (mesa ${c.mesa})`, total: atual.totalCentavos, situacao: 'comanda aberta' });
  }

  // ── 8. Pão acabando ──
  await registrarAjuste({ insumoId: insumo(PAO_ACABANDO.insumo).id }, { saldoContado: PAO_ACABANDO.saldo, motivo: `${MOTIVO}: pão acabando` }, { usuarioId });

  // ── 9. Cupons já "impressos" ──
  const { count } = await prisma.trabalhoImpressao.updateMany({
    where: { id: { gt: ultimoTrabalho }, status: 'PENDENTE' },
    data: { status: 'IMPRESSO', impressoEm: new Date() },
  });

  log('Pedidos de demonstração:');
  for (const r of resumo) log(`  #${String(r.numero).padStart(2)}  ${r.canal.padEnd(8)} ${r.quem.padEnd(26)} ${reais(r.total).padStart(10)}  ${r.situacao}`);
  log(`\n${PAO_ACABANDO.insumo}: saldo ajustado para ${PAO_ACABANDO.saldo} (cada lanche gasta 1; zerou, os lanches somem do site).`);
  log(`${count} cupom(ns) da demonstração marcados como impressos (a impressora não vai soltá-los).`);
}

/** Site ou WhatsApp, pelo mesmo criarPedido da API; depois finaliza, cancela ou deixa na fila. */
async function delivery(spec, cliente, itens, usuarioId) {
  const endereco = cliente.enderecos[0];
  const base = { itens, enderecoId: endereco.id, formaPagamento: spec.forma, trocoParaCentavos: spec.troco ?? null };
  let pedido;
  let observacaoCanal = '';

  if (spec.canal === 'SITE') {
    try {
      // O site manda o total que o cliente viu; aqui ele vem do 409 PRECO_ALTERADO (preço do banco).
      pedido = await criarPedidoDoSite(cliente, { ...base, totalEsperadoCentavos: -1 }).catch((err) => {
        if (err?.codigo !== 'PRECO_ALTERADO') throw err;
        return criarPedidoDoSite(cliente, { ...base, totalEsperadoCentavos: err.detalhes.totalCentavos });
      });
      pedido = pedido.pedido;
    } catch (err) {
      if (!['LOJA_FECHADA', 'PRODUTO_INDISPONIVEL'].includes(err?.codigo)) throw err;
      // Loja fechada (ou outro turno): mesmo criarPedido pelo caminho da equipe, marcado SITE.
      pedido = (await criarPedidoDoWhatsapp({ clienteId: cliente.id, ...base }, { usuarioId })).pedido;
      await prisma.pedido.update({ where: { id: pedido.id }, data: { canal: 'SITE', criadoPorId: null } });
      observacaoCanal = ' (loja fechada agora: lançado sem trava de horário)';
    }
  } else {
    pedido = (await criarPedidoDoWhatsapp({ clienteId: cliente.id, ...base }, { usuarioId })).pedido;
  }

  let situacao = 'aberto na fila do PDV';
  if (spec.depois === 'finalizar') {
    await finalizarPedido(pedido.id, { formaPagamento: spec.forma });
    situacao = `finalizado (${spec.forma})`;
  } else if (spec.depois === 'cancelar') {
    await cancelarPedido(pedido.id, { usuarioId });
    situacao = 'cancelado (estoque devolvido)';
  }
  return { numero: pedido.numeroDia, canal: spec.canal, quem: cliente.nome, total: pedido.totalCentavos, situacao: situacao + observacaoCanal };
}

/** Comanda do salão: abre, lança item a item (baixa na hora) e fecha. */
async function comandaFechada(spec, itens, usuarioId) {
  const comanda = await abrirComanda({ nomeCliente: spec.nome, mesaRotulo: spec.mesa }, { usuarioId });
  let atual = comanda;
  for (const item of itens) atual = await lancarItem(comanda.id, item, { usuarioId });
  await fecharComanda(comanda.id, { formaPagamento: spec.forma, imprimirConta: false });
  return { numero: atual.numeroDia, canal: 'SALAO', quem: `${spec.nome} (mesa ${spec.mesa})`, total: atual.totalCentavos, situacao: `comanda fechada (${spec.forma})` };
}

try {
  await main();
} catch (err) {
  console.error(err instanceof ErroHttp ? `Erro da API (${err.codigo}): ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
