/**
 * Cupom da térmica, montado como linhas de texto já alinhadas. Puro (sem
 * dependências): o PDV converte as linhas em ESC/POS, ou grava em .txt no
 * modo teste, e os testes comparam o texto.
 *
 * Ordem (CLAUDE.md): nome do restaurante; número e origem; cliente (nome,
 * telefone, endereço); itens com observação em destaque; taxa de entrega e
 * total; pagamento e troco; data e hora.
 *
 * Cada linha: { texto, negrito?, grande?, qr? }. `texto` já vem com a largura
 * exata: `colunas` caracteres, ou `colunas / 2` quando `grande` (a fonte
 * dupla ocupa duas colunas por caractere). Linha com `qr` (link do mapa da
 * entrega) vira QR code na térmica e some no texto (o link vem escrito embaixo).
 */
import { formatarTelefone } from './telefone.js';
import { agruparItens } from './itens.js';
import { formatarDistancia } from './mapa.js';

export const LARGURAS = [48, 32];
export const TIPOS_CUPOM = ['PEDIDO', 'CANCELAMENTO', 'CONTA', 'FECHAMENTO', 'RELATORIO_DIA'];

const FUSO = 'America/Sao_Paulo';
const NOME_CANAL = { SITE: 'Site', APP: 'App', WHATSAPP: 'WhatsApp', SALAO: 'Salão' };
const NOME_PAGAMENTO = { PIX: 'Pix', DINHEIRO: 'Dinheiro', DEBITO: 'Débito', CREDITO: 'Crédito' };

const dataHora = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante → "14/11/2026 20:15" no horário de São Paulo. */
export function formatarDataHora(instante) {
  const p = Object.fromEntries(dataHora.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Centavos → "R$ 1.234,56" (sem Intl: mesmo texto em qualquer máquina). */
export function formatarDinheiro(centavos) {
  const v = Math.round(Number(centavos) || 0);
  const sinal = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sinal}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

/** Gramas → "0,450 kg". */
export const formatarPeso = (g) => `${(g / 1000).toFixed(3).replace('.', ',')} kg`;

/**
 * Texto que a térmica consegue imprimir: aspas/travessões trocados por ASCII,
 * quebras de linha viram espaço, fora do Latin-1 (emoji etc.) é removido.
 */
export function limparTexto(valor) {
  return String(valor ?? '')
    .normalize('NFC')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\s ]+/g, ' ')
    .replace(/[^ -~¡-ÿ]/g, '')
    .trim();
}

/** Quebra em linhas de até `largura`, por palavra (palavra maior é cortada). */
export function quebrar(texto, largura) {
  const linhas = [];
  let atual = '';
  for (let palavra of limparTexto(texto).split(' ')) {
    if (!palavra) continue;
    while (palavra.length > largura) {
      if (atual) {
        linhas.push(atual);
        atual = '';
      }
      linhas.push(palavra.slice(0, largura));
      palavra = palavra.slice(largura);
    }
    if (!palavra) continue;
    if (!atual) atual = palavra;
    else if (atual.length + 1 + palavra.length <= largura) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

const centralizar = (t, largura) => {
  const s = t.slice(0, largura);
  const esq = Math.floor((largura - s.length) / 2);
  return (' '.repeat(esq) + s).padEnd(largura);
};

/** Esquerda e direita na mesma linha; se não couber, a direita desce. */
function colunasLR(esquerda, direita, largura) {
  const d = limparTexto(direita);
  const espaco = largura - d.length - 1;
  const partes = quebrar(esquerda, Math.max(1, espaco));
  if (!partes.length) partes.push('');
  const ultima = partes.pop();
  return [...partes.map((p) => p.padEnd(largura)), ultima.padEnd(largura - d.length) + d];
}

function criarMontador(colunas) {
  const linhas = [];
  const metade = Math.floor(colunas / 2);
  const m = {
    linhas,
    colunas,
    texto(t, { negrito = false, recuo = 0, primeiraLinha = '' } = {}) {
      const largura = colunas - recuo;
      quebrar(t, largura).forEach((parte, i) => {
        const prefixo = i === 0 && primeiraLinha ? primeiraLinha : ' '.repeat(recuo);
        linhas.push({ texto: (prefixo + parte).padEnd(colunas), negrito });
      });
      return m;
    },
    centro(t, { negrito = false } = {}) {
      for (const parte of quebrar(t, colunas)) linhas.push({ texto: centralizar(parte, colunas), negrito });
      return m;
    },
    grande(t) {
      for (const parte of quebrar(t, metade)) linhas.push({ texto: centralizar(parte, metade), negrito: true, grande: true });
      return m;
    },
    valor(rotulo, v, { negrito = false } = {}) {
      for (const l of colunasLR(rotulo, v, colunas)) linhas.push({ texto: l, negrito });
      return m;
    },
    separador(c = '-') {
      linhas.push({ texto: c.repeat(colunas) });
      return m;
    },
    vazio() {
      linhas.push({ texto: ' '.repeat(colunas) });
      return m;
    },
    qr(valor) {
      linhas.push({ texto: ' '.repeat(colunas), qr: valor });
      return m;
    },
  };
  return m;
}

function origem(pedido) {
  const canal = NOME_CANAL[pedido.canal] ?? pedido.canal;
  if (pedido.canal === 'SALAO') return pedido.mesaRotulo ? `${canal} - Mesa ${pedido.mesaRotulo}` : canal;
  return `${canal} - ${pedido.encomenda ? 'Encomenda' : 'Delivery'}`;
}

/** Encomenda: horário marcado e retirada no balcão, em destaque logo abaixo da origem. */
function blocoEncomenda(m, pedido) {
  if (!pedido.encomenda) return;
  if (pedido.agendadoPara) m.centro(`PARA ${formatarDataHora(pedido.agendadoPara)}`, { negrito: true });
  if (pedido.retirarNoBalcao) m.centro('RETIRAR NO BALCÃO', { negrito: true });
  m.separador();
}

/** "3,2 km" ou "~3,2 km (estimada)" (linha reta × 1,3 quando a rota falhou). */
export function textoDistancia(pedido) {
  if (!Number.isInteger(pedido?.distanciaMetros)) return null;
  const d = formatarDistancia(pedido.distanciaMetros);
  return pedido.distanciaEstimada ? `~${d} (estimada)` : d;
}

function blocoCliente(m, pedido, { mapa = false, distancia: comDistancia = false } = {}) {
  const temEntrega = Boolean(pedido.enderecoTexto);
  if (!pedido.telefone && !temEntrega && pedido.canal === 'SALAO') return;
  m.texto(pedido.nomeCliente, { negrito: true, primeiraLinha: 'Cliente: ', recuo: 9 });
  if (pedido.telefone) m.texto(formatarTelefone(pedido.telefone), { primeiraLinha: 'Tel: ', recuo: 5 });
  if (temEntrega) {
    m.texto(pedido.enderecoTexto, { primeiraLinha: 'End: ', recuo: 5 });
    if (pedido.bairroNome) m.texto(pedido.bairroNome, { primeiraLinha: 'Bairro: ', recuo: 8 });
    const distancia = textoDistancia(pedido);
    if (comDistancia && distancia) m.texto(distancia, { primeiraLinha: 'Distância: ', recuo: 11 });
    // Pino do cliente: QR para o entregador abrir no celular, com o link escrito embaixo.
    if (mapa && pedido.linkMapa) {
      m.separador();
      m.centro('Mapa da entrega (aponte a câmera):');
      m.qr(pedido.linkMapa);
      m.texto(pedido.linkMapa);
    }
  }
  m.separador();
}

function blocoItens(m, pedido, { observacoes = true, itens = pedido.itens } = {}) {
  for (const item of itens) {
    const qtd = item.pesoGramas ? `${formatarPeso(item.pesoGramas)} ` : `${item.quantidade}x `;
    const linhas = colunasLR(item.nome, formatarDinheiro(item.totalCentavos), m.colunas - qtd.length);
    linhas.forEach((l, i) => m.linhas.push({ texto: (i === 0 ? qtd : ' '.repeat(qtd.length)) + l }));
    if (item.pesoGramas) m.texto(`${formatarDinheiro(item.precoUnitarioCentavos)}/kg`, { recuo: qtd.length });
    else if (item.quantidade > 1) m.texto(`${formatarDinheiro(item.precoUnitarioCentavos)} cada`, { recuo: qtd.length });
    // Observação em destaque: negrito e em linha própria.
    if (observacoes && item.observacao) {
      m.texto(item.observacao, { negrito: true, primeiraLinha: `${' '.repeat(qtd.length)}OBS: `, recuo: qtd.length + 5 });
    }
  }
  // Observação do pedido inteiro (lançado no PDV), também em destaque.
  if (observacoes && pedido.observacao) {
    m.texto(pedido.observacao, { negrito: true, primeiraLinha: 'OBS DO PEDIDO: ', recuo: 15 });
  }
  m.separador();
}

function blocoTotais(m, pedido) {
  const entrega = pedido.taxaEntregaCentavos > 0 || pedido.enderecoTexto;
  if (entrega || pedido.descontoCentavos > 0) m.valor('Subtotal', formatarDinheiro(pedido.subtotalCentavos));
  if (entrega) {
    // Entrega sem taxa (frete grátis ou bairro sem taxa): "Grátis", não "R$ 0,00".
    const gratis = pedido.enderecoTexto && pedido.taxaEntregaCentavos === 0;
    m.valor('Taxa de entrega', gratis ? 'Grátis' : formatarDinheiro(pedido.taxaEntregaCentavos));
  }
  if (pedido.descontoCentavos > 0) m.valor('Desconto', `-${formatarDinheiro(pedido.descontoCentavos)}`);
  m.valor('TOTAL', formatarDinheiro(pedido.totalCentavos), { negrito: true });
}

function blocoPagamento(m, pedido) {
  if (!pedido.formaPagamento) return;
  const forma = NOME_PAGAMENTO[pedido.formaPagamento] ?? pedido.formaPagamento;
  // Já pago no balcão ("pago agora"): o entregador não cobra nem leva troco.
  if (pedido.pagoEm) {
    m.valor('Pagamento', `${forma} - JÁ PAGO`, { negrito: true });
    return;
  }
  m.valor('Pagamento', forma, { negrito: true });
  if (pedido.formaPagamento === 'DINHEIRO' && pedido.trocoParaCentavos) {
    m.valor('Troco para', formatarDinheiro(pedido.trocoParaCentavos));
    m.valor('Levar de troco', formatarDinheiro(pedido.trocoParaCentavos - pedido.totalCentavos), { negrito: true });
  }
}

function cabecalho(m, restaurante, titulo, pedido) {
  m.grande(restaurante.toUpperCase()).separador('=');
  if (titulo) m.grande(titulo);
  m.grande(`PEDIDO #${pedido.numeroDia}`);
  m.centro(origem(pedido)).separador();
  blocoEncomenda(m, pedido);
}

const hora = (instante) => formatarDataHora(instante).slice(11);

/**
 * Resumo do fechamento de caixa. NUNCA mostra o esperado nem a diferença
 * (fechamento cego; só o dono vê na retaguarda). Sai depois que o contado já
 * foi gravado, então os totais por forma não revelam nada a tempo.
 */
function cupomFechamento(m, trabalho, restaurante) {
  const c = trabalho.caixa;
  m.grande(restaurante.toUpperCase()).separador('=');
  m.grande('FECHAMENTO DE CAIXA').separador();
  m.valor('Abertura', formatarDataHora(c.abertoEm));
  m.valor('Aberto por', c.abertoPor?.nome ?? '-');
  m.valor('Fechamento', formatarDataHora(c.fechadoEm));
  m.valor('Fechado por', c.fechadoPor?.nome ?? '-');
  m.separador();
  m.valor('Fundo de troco', formatarDinheiro(c.valorInicialCentavos));
  for (const [tipo, titulo] of [['SUPRIMENTO', 'Suprimentos'], ['SANGRIA', 'Sangrias']]) {
    const lista = c.movimentos.filter((mv) => mv.tipo === tipo);
    if (!lista.length) continue;
    m.texto(`${titulo}:`, { negrito: true });
    for (const mv of lista) m.valor(`${hora(mv.criadoEm)} ${mv.motivo}`, formatarDinheiro(mv.valorCentavos));
  }
  m.separador();
  m.texto('Vendas por forma de pagamento', { negrito: true });
  // Dinheiro primeiro: é o que foi contado na gaveta.
  const ordem = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];
  const totais = [...(c.totaisPorForma ?? [])].sort((a, b) => ordem.indexOf(a.forma) - ordem.indexOf(b.forma));
  if (!totais.length) m.texto('Nenhuma venda');
  for (const t of totais) {
    m.valor(`${NOME_PAGAMENTO[t.forma] ?? t.forma} (${t.quantidade})`, formatarDinheiro(t.totalCentavos));
  }
  const qtd = totais.reduce((s, t) => s + t.quantidade, 0);
  const total = totais.reduce((s, t) => s + t.totalCentavos, 0);
  m.valor(`Total vendido (${qtd})`, formatarDinheiro(total), { negrito: true });
  m.separador();
  m.valor('DINHEIRO CONTADO', formatarDinheiro(c.valorContadoCentavos), { negrito: true });
  if (c.observacao) m.texto(c.observacao, { primeiraLinha: 'Obs: ', recuo: 5 });
  m.separador();
  m.centro(`Emitido em ${formatarDataHora(trabalho.criadoEm)}`);
  return m.linhas;
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "2026-11-13" → "13/11/2026 (sexta)". */
function formatarDia(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a} (${DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]})`;
}

/**
 * Resumo do dia OPERACIONAL (vira às horaViradaDia): totais, formas, canais,
 * mais vendidos e cancelados. Sem nada do caixa (esperado/diferença).
 */
function cupomRelatorioDia(m, trabalho, restaurante) {
  const r = trabalho.relatorio;
  const hh = `${String(r.horaViradaDia).padStart(2, '0')}:00`;
  m.grande(restaurante.toUpperCase()).separador('=');
  m.grande('RESUMO DO DIA').separador();
  m.centro(formatarDia(r.data), { negrito: true });
  m.centro(`Expediente das ${hh} às ${hh} do dia seguinte`);
  m.separador();
  m.valor('Pedidos finalizados', String(r.quantidadePedidos));
  m.valor('TOTAL VENDIDO', formatarDinheiro(r.totalCentavos), { negrito: true });
  m.valor('Ticket médio', formatarDinheiro(r.ticketMedioCentavos));
  m.valor('Taxas de entrega', formatarDinheiro(r.taxaEntregaCentavos));
  if (r.descontoCentavos > 0) m.valor('Descontos', `-${formatarDinheiro(r.descontoCentavos)}`);
  m.separador();
  m.texto('Por forma de pagamento', { negrito: true });
  for (const f of r.porFormaPagamento) {
    m.valor(`${NOME_PAGAMENTO[f.forma] ?? f.forma} (${f.quantidade})`, formatarDinheiro(f.totalCentavos));
  }
  m.texto('Por canal', { negrito: true });
  for (const c of r.porCanal) {
    m.valor(`${NOME_CANAL[c.canal] ?? c.canal} (${c.quantidade})`, formatarDinheiro(c.totalCentavos));
  }
  m.separador();
  m.texto('Mais vendidos', { negrito: true });
  if (!r.topPorQuantidade.length) m.texto('Nenhuma venda');
  for (const p of r.topPorQuantidade) {
    const peso = p.pesoGramas ? ` (${formatarPeso(p.pesoGramas)})` : '';
    m.valor(`${p.quantidade}x ${p.nome}${peso}`, formatarDinheiro(p.totalCentavos));
  }
  m.separador();
  m.valor(`Pedidos cancelados (${r.cancelados.quantidade})`, formatarDinheiro(r.cancelados.totalCentavos));
  m.valor(`Itens removidos (${r.itensRemovidos.quantidade})`, formatarDinheiro(r.itensRemovidos.totalCentavos));
  m.separador();
  m.centro(`Emitido em ${formatarDataHora(trabalho.criadoEm)}`);
  return m.linhas;
}

/**
 * @param {{ id: number, tipo: 'PEDIDO' | 'CANCELAMENTO' | 'CONTA' | 'FECHAMENTO' | 'RELATORIO_DIA', criadoEm: string | Date, pedido?: object, caixa?: object, relatorio?: object }} trabalho
 *   `pedido` no formato público da API (itens com nome, quantidade, totais em centavos);
 *   FECHAMENTO traz `caixa` (resumo sem esperado nem diferença) no lugar do pedido;
 *   RELATORIO_DIA traz `relatorio` (GET /retaguarda/relatorios/dia).
 * @param {{ colunas?: 48 | 32, restaurante?: string, qrMapa?: boolean }} [opcoes]
 *   `qrMapa`: QR do mapa da entrega no cupom do pedido (padrão ligado; opção da tela Impressora).
 * @returns {{ texto: string, negrito?: boolean, grande?: boolean }[]}
 */
export function montarCupom(trabalho, { colunas = 48, restaurante = 'Cabana Boemia', qrMapa = true } = {}) {
  if (!LARGURAS.includes(colunas)) throw new Error(`Largura inválida: ${colunas} (use ${LARGURAS.join(' ou ')})`);
  if (!TIPOS_CUPOM.includes(trabalho?.tipo)) throw new Error(`Tipo de cupom inválido: ${trabalho?.tipo}`);
  const { pedido, tipo } = trabalho;
  const m = criarMontador(colunas);

  if (tipo === 'FECHAMENTO') return cupomFechamento(m, trabalho, restaurante);
  if (tipo === 'RELATORIO_DIA') return cupomRelatorioDia(m, trabalho, restaurante);

  if (tipo === 'CANCELAMENTO') {
    cabecalho(m, restaurante, 'PEDIDO CANCELADO', pedido);
    blocoCliente(m, pedido);
    blocoItens(m, pedido, { observacoes: false });
    blocoTotais(m, pedido);
    m.separador();
    m.centro(`Pedido em ${formatarDataHora(pedido.criadoEm)}`);
    m.centro(`Cancelado em ${formatarDataHora(trabalho.criadoEm)}`, { negrito: true });
    m.separador('*').grande('CANCELADO').separador('*');
    return m.linhas;
  }

  if (tipo === 'CONTA') {
    cabecalho(m, restaurante, 'CONTA', pedido);
    // Comanda do salão: o nome é o que a atendente usa para entregar a conta.
    m.texto(pedido.nomeCliente, { negrito: true, primeiraLinha: 'Cliente: ', recuo: 9 });
    m.separador();
    // Um ItemPedido por toque no banco; na conta, "4x Refrigerante Lata".
    blocoItens(m, pedido, { itens: agruparItens(pedido.itens) });
    blocoTotais(m, pedido);
    blocoPagamento(m, pedido);
    m.separador();
    m.centro(`Emitida em ${formatarDataHora(trabalho.criadoEm)}`);
    m.centro('Não é documento fiscal');
    return m.linhas;
  }

  cabecalho(m, restaurante, null, pedido);
  // QR do mapa só no cupom do pedido (o do cancelamento não sai para a rua).
  blocoCliente(m, pedido, { mapa: qrMapa, distancia: true });
  blocoItens(m, pedido);
  blocoTotais(m, pedido);
  blocoPagamento(m, pedido);
  m.separador();
  if (pedido.tempoEstimadoMin) m.centro(`Previsão: ${pedido.tempoEstimadoMin} min`);
  m.centro(formatarDataHora(pedido.criadoEm));
  return m.linhas;
}

/**
 * Texto puro do cupom (modo teste .txt e snapshots). Linha grande fica
 * centralizada na largura toda, como sai no papel.
 */
export function cupomParaTexto(linhas, colunas = 48) {
  const visiveis = linhas.filter((l) => !l.qr); // o QR só existe no papel; o link vem escrito
  return `${visiveis.map((l) => (l.grande ? centralizar(l.texto.trim(), colunas) : l.texto).trimEnd()).join('\n')}\n`;
}
