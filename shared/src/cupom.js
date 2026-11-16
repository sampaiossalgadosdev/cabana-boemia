/**
 * Cupom da térmica, montado como linhas de texto já alinhadas. Puro (sem
 * dependências): o PDV converte as linhas em ESC/POS, ou grava em .txt no
 * modo teste, e os testes comparam o texto.
 *
 * Ordem (CLAUDE.md): nome do restaurante; número e origem; cliente (nome,
 * telefone, endereço); itens com observação em destaque; taxa de entrega e
 * total; pagamento e troco; data e hora.
 *
 * Cada linha: { texto, negrito?, grande? }. `texto` já vem com a largura
 * exata: `colunas` caracteres, ou `colunas / 2` quando `grande` (a fonte
 * dupla ocupa duas colunas por caractere).
 */
import { formatarTelefone } from './telefone.js';

export const LARGURAS = [48, 32];
export const TIPOS_CUPOM = ['PEDIDO', 'CANCELAMENTO', 'CONTA'];

const FUSO = 'America/Sao_Paulo';
const NOME_CANAL = { SITE: 'Site', WHATSAPP: 'WhatsApp', SALAO: 'Salão' };
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
  };
  return m;
}

function origem(pedido) {
  const canal = NOME_CANAL[pedido.canal] ?? pedido.canal;
  if (pedido.canal === 'SALAO') return pedido.mesaRotulo ? `${canal} - Mesa ${pedido.mesaRotulo}` : canal;
  return `${canal} - Delivery`;
}

function blocoCliente(m, pedido) {
  const temEntrega = Boolean(pedido.enderecoTexto);
  if (!pedido.telefone && !temEntrega && pedido.canal === 'SALAO') return;
  m.texto(pedido.nomeCliente, { negrito: true, primeiraLinha: 'Cliente: ', recuo: 9 });
  if (pedido.telefone) m.texto(formatarTelefone(pedido.telefone), { primeiraLinha: 'Tel: ', recuo: 5 });
  if (temEntrega) {
    m.texto(pedido.enderecoTexto, { primeiraLinha: 'End: ', recuo: 5 });
    if (pedido.bairroNome) m.texto(pedido.bairroNome, { primeiraLinha: 'Bairro: ', recuo: 8 });
  }
  m.separador();
}

function blocoItens(m, pedido, { observacoes = true } = {}) {
  for (const item of pedido.itens) {
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
  m.separador();
}

function blocoTotais(m, pedido) {
  if (pedido.taxaEntregaCentavos > 0 || pedido.enderecoTexto) {
    m.valor('Subtotal', formatarDinheiro(pedido.subtotalCentavos));
    m.valor('Taxa de entrega', formatarDinheiro(pedido.taxaEntregaCentavos));
  }
  m.valor('TOTAL', formatarDinheiro(pedido.totalCentavos), { negrito: true });
}

function blocoPagamento(m, pedido) {
  if (!pedido.formaPagamento) return;
  m.valor('Pagamento', NOME_PAGAMENTO[pedido.formaPagamento] ?? pedido.formaPagamento, { negrito: true });
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
}

/**
 * @param {{ id: number, tipo: 'PEDIDO' | 'CANCELAMENTO' | 'CONTA', criadoEm: string | Date, pedido: object }} trabalho
 *   `pedido` no formato público da API (itens com nome, quantidade, totais em centavos).
 * @param {{ colunas?: 48 | 32, restaurante?: string }} [opcoes]
 * @returns {{ texto: string, negrito?: boolean, grande?: boolean }[]}
 */
export function montarCupom(trabalho, { colunas = 48, restaurante = 'Cabana Boemia' } = {}) {
  if (!LARGURAS.includes(colunas)) throw new Error(`Largura inválida: ${colunas} (use ${LARGURAS.join(' ou ')})`);
  if (!TIPOS_CUPOM.includes(trabalho?.tipo)) throw new Error(`Tipo de cupom inválido: ${trabalho?.tipo}`);
  const { pedido, tipo } = trabalho;
  const m = criarMontador(colunas);

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
    blocoItens(m, pedido);
    blocoTotais(m, pedido);
    m.separador();
    m.centro(`Emitida em ${formatarDataHora(trabalho.criadoEm)}`);
    m.centro('Não é documento fiscal');
    return m.linhas;
  }

  cabecalho(m, restaurante, null, pedido);
  blocoCliente(m, pedido);
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
  return `${linhas.map((l) => (l.grande ? centralizar(l.texto.trim(), colunas) : l.texto).trimEnd()).join('\n')}\n`;
}
