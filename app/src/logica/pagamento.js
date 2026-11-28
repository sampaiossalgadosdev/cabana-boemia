/**
 * Pagamento pelo app (Pix e cartão): opções da tela, contagem regressiva, estado do Pix e do
 * cartão, o pagamento pendente guardado no aparelho (para retomar se o app fechar) e os erros.
 * Lógica pura, testada (test/pagamento.test.js). Regras em docs/pagamento-online.md (Etapas 4 e 7).
 */
import { lerTexto, gravarTexto, removerTexto } from './armazenamento.js';
import { FORMAS_PAGAMENTO } from './pedido.js';

/** Opção "Pix pelo app" na escolha da forma (o resto são as formas na entrega). */
export const PIX_ONLINE = 'PIX_ONLINE';
/**
 * Opção "Cartão pelo app" (Etapa 7): Checkout Pro no navegador do app. Crédito à vista, débito,
 * pré-pago ou saldo Mercado Pago (Decisão 2 da Etapa 7), por isso "Cartão" e não "crédito".
 */
export const CARTAO_APP = 'CARTAO_APP';
export const CHAVE_CARTAO_PENDENTE = 'delivery-abatia:cartao-pendente:v1';
export const MENSAGEM_FALHA_CARTAO = 'Não foi possível abrir o pagamento com cartão agora. Tente de novo ou escolha outra forma de pagamento.';
export const MENSAGEM_CARTAO_PAGO_TARDE =
  'O pagamento chegou depois do prazo e o pedido não foi enviado à loja. O valor será devolvido pelo Mercado Pago (no cartão de crédito, na fatura). Sua sacola continua guardada.';
export const MENSAGEM_CARTAO_EXPIRADO =
  'O prazo para pagar acabou e o pedido não foi enviado. Sua sacola continua guardada: é só fazer o pedido de novo.';
/** A tela do Pix consulta a nossa API a cada 5 s. */
export const INTERVALO_CONSULTA_MS = 5_000;
/** Pix guardado há mais disto não é retomado (o pedido já expirou faz tempo). */
export const VALIDADE_RETOMADA_MS = 24 * 60 * 60 * 1000;
export const CHAVE_PIX_PENDENTE = 'delivery-abatia:pix-pendente:v1';

export const MENSAGEM_FALHA_PIX = 'Não foi possível gerar o Pix agora. Tente de novo ou escolha outra forma de pagamento.';
/** O Mercado Pago recusou o e-mail do pagador (Decisão 0 da Etapa 5). */
export const MENSAGEM_EMAIL_RECUSADO = 'O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo.';
export const MENSAGEM_PIX_EXPIRADO = 'O prazo para pagar o Pix acabou e o pedido não foi enviado. Sua sacola continua guardada: é só fazer o pedido de novo.';
export const MENSAGEM_PAGO_TARDE =
  'O pagamento chegou depois do prazo e o pedido não foi enviado à loja. O valor será devolvido para a sua conta. Sua sacola continua guardada.';
export const TEXTO_CAMPANHA = 'Verifique seu telefone para ganhar frete grátis na primeira compra';

/**
 * Opções da tela de pagamento a partir das formas da loja (`formasPagamento` da prévia):
 * Pix pelo app primeiro (se a loja aceita), depois as formas na entrega.
 * Sem formas da API (prévia indisponível): as quatro formas na entrega, como antes.
 * @param {{ naEntrega?: string[], online?: string[] } | null} formas
 */
export function opcoesDePagamento(formas) {
  const naEntrega = formas?.naEntrega ?? FORMAS_PAGAMENTO.map((f) => f.valor);
  const opcoes = [];
  if (formas?.online?.includes('PIX')) {
    opcoes.push({
      valor: PIX_ONLINE,
      rotulo: 'Pix pelo app (pagar agora)',
      agora: true,
      detalhe: 'Pix com QR code ou copia e cola; o pedido vai para a loja quando o pagamento for aprovado.',
    });
  }
  if (formas?.online?.includes('CARTAO_ONLINE')) {
    opcoes.push({
      valor: CARTAO_APP,
      rotulo: 'Cartão pelo app (pagar agora)',
      agora: true,
      detalhe: 'Crédito à vista ou débito, na página segura do Mercado Pago; o pedido vai para a loja quando o pagamento for aprovado.',
    });
  }
  for (const f of FORMAS_PAGAMENTO) if (naEntrega.includes(f.valor)) opcoes.push({ ...f, agora: false });
  return opcoes;
}

/** Tempo até `expiraEm`: segundos inteiros (nunca negativo) e "mm:ss". */
export function tempoRestante(expiraEm, agora = Date.now()) {
  const fim = new Date(expiraEm).getTime();
  const segundos = Number.isFinite(fim) ? Math.max(0, Math.ceil((fim - Number(agora)) / 1000)) : 0;
  const mm = String(Math.floor(segundos / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');
  return { segundos, texto: `${mm}:${ss}`, acabou: segundos === 0 };
}

/**
 * Estado da tela a partir do pagamento da API: 'aguardando' (PENDENTE), 'aprovado',
 * 'pago_tarde' (A_ESTORNAR: pago depois de expirar) ou 'expirado' (o resto).
 */
export function estadoDoPix(pagamento) {
  switch (pagamento?.status) {
    case 'PENDENTE':
      return 'aguardando';
    case 'APROVADO':
      return 'aprovado';
    case 'A_ESTORNAR':
      return 'pago_tarde';
    default:
      return 'expirado';
  }
}

/** O que fica no aparelho enquanto o Pix não é pago (para retomar a tela se o app fechar). */
export function pixParaGuardar({ pedido, pagamento }, loja) {
  return {
    pedidoId: pedido.id,
    loja: loja ? { slug: loja.slug, nome: loja.nome } : null,
    valorCentavos: pagamento.valorCentavos ?? pedido.totalCentavos,
    qrCode: pagamento.qrCode,
    qrCodeBase64: pagamento.qrCodeBase64,
    expiraEm: pagamento.expiraEm,
    guardadoEm: new Date().toISOString(),
  };
}

/** Pix guardado com o formato certo e não velho demais; senão null. */
export function pixGuardadoValido(dados, agora = Date.now()) {
  if (!dados || !Number.isInteger(dados.pedidoId) || typeof dados.qrCode !== 'string' || !dados.expiraEm) return null;
  const expira = new Date(dados.expiraEm).getTime();
  if (!Number.isFinite(expira) || Number(agora) - expira > VALIDADE_RETOMADA_MS) return null;
  return dados;
}

export async function salvarPixPendente(dados, storage) {
  return gravarTexto(CHAVE_PIX_PENDENTE, JSON.stringify(dados), storage);
}

export async function lerPixPendente(storage, agora = Date.now()) {
  const texto = await lerTexto(CHAVE_PIX_PENDENTE, storage);
  if (!texto) return null;
  try {
    return pixGuardadoValido(JSON.parse(texto), agora);
  } catch {
    return null;
  }
}

export const apagarPixPendente = (storage) => removerTexto(CHAVE_PIX_PENDENTE, storage);

/**
 * Erros do envio com Pix. `novaChave`: o pedido anterior foi encerrado (o próximo é outro);
 * `email`: falta o e-mail no cadastro, ou o Mercado Pago recusou o e-mail (aí `novaChave` também:
 * o pedido expirou); `formas`: a loja parou de aceitar Pix pelo app.
 * Outros erros: null (o checkout trata como sempre).
 */
export function interpretarErroDoPix(erro, meio = 'PIX') {
  const cartao = meio === 'CARTAO';
  switch (erro?.codigo) {
    case 'PAGAMENTO_FALHOU':
      return { acao: 'novaChave', mensagem: cartao ? MENSAGEM_FALHA_CARTAO : MENSAGEM_FALHA_PIX };
    case 'PIX_EXPIRADO':
      return { acao: 'novaChave', mensagem: cartao ? MENSAGEM_CARTAO_EXPIRADO : MENSAGEM_PIX_EXPIRADO };
    case 'EMAIL_OBRIGATORIO':
      return { acao: 'email', mensagem: 'Informe seu e-mail para pagar pelo app.' };
    case 'EMAIL_RECUSADO_PAGAMENTO':
      return { acao: 'email', novaChave: true, mensagem: MENSAGEM_EMAIL_RECUSADO };
    case 'PAGAMENTO_ONLINE_INDISPONIVEL':
      return { acao: 'formas', mensagem: erro.message };
    default:
      return null;
  }
}

// ───────── Cartão pelo app (Etapa 7: Checkout Pro) ─────────

/**
 * Estado da tela do cartão a partir do pagamento da API: 'aguardando' (PENDENTE, ainda sem
 * tentativa recusada), 'recusado' (PENDENTE com a última tentativa recusada: o pedido continua
 * esperando, Decisão 3 da Etapa 7), 'aprovado', 'pago_tarde' (A_ESTORNAR) ou 'expirado' (o resto).
 */
export function estadoDoCartao(pagamento) {
  if (pagamento?.status === 'PENDENTE') return pagamento.recusa ? 'recusado' : 'aguardando';
  const pix = estadoDoPix(pagamento);
  return pix === 'aguardando' ? 'expirado' : pix;
}

/** O que fica no aparelho enquanto o cartão não é pago (o link do checkout para "Tentar de novo"). */
export function cartaoParaGuardar({ pedido, pagamento }, loja) {
  return {
    pedidoId: pedido.id,
    loja: loja ? { slug: loja.slug, nome: loja.nome } : null,
    valorCentavos: pagamento.valorCentavos ?? pedido.totalCentavos,
    checkoutUrl: pagamento.checkoutUrl,
    expiraEm: pagamento.expiraEm,
    guardadoEm: new Date().toISOString(),
  };
}

/** Só abre link https do Mercado Pago (o que a API mandou); outro = null. */
export function checkoutSeguro(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && /(^|\.)mercadopago\.com(\.br)?$|(^|\.)mercadolivre\.com(\.br)?$/.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Cartão guardado com o formato certo e não velho demais; senão null. */
export function cartaoGuardadoValido(dados, agora = Date.now()) {
  if (!dados || !Number.isInteger(dados.pedidoId) || typeof dados.checkoutUrl !== 'string' || !dados.expiraEm) return null;
  const expira = new Date(dados.expiraEm).getTime();
  if (!Number.isFinite(expira) || Number(agora) - expira > VALIDADE_RETOMADA_MS) return null;
  return dados;
}

export async function salvarCartaoPendente(dados, storage) {
  return gravarTexto(CHAVE_CARTAO_PENDENTE, JSON.stringify(dados), storage);
}

export async function lerCartaoPendente(storage, agora = Date.now()) {
  const texto = await lerTexto(CHAVE_CARTAO_PENDENTE, storage);
  if (!texto) return null;
  try {
    return cartaoGuardadoValido(JSON.parse(texto), agora);
  } catch {
    return null;
  }
}

export const apagarCartaoPendente = (storage) => removerTexto(CHAVE_CARTAO_PENDENTE, storage);

/** E-mail com formato aceitável (a API confere de novo). */
export const emailValido = (texto) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(texto ?? '').trim());

// ───────── Pedido pago online: aceite, cancelamento e estorno (Etapa 5) ─────────

/** Para onde o dinheiro volta, conforme o meio. */
const VOLTA = { PIX: 'O valor do Pix volta para a sua conta.', CARTAO_ONLINE: 'O valor volta pelo Mercado Pago para o cartão ou a conta usada (no crédito, na fatura).' };

/**
 * Texto do pedido pago online no histórico (aba Pedidos), ou null. Recusado ou cancelado com
 * estorno: para onde o dinheiro volta (Pix na conta, cartão na fatura).
 * @param {{ status: string, podeCancelar?: boolean, pagamentoOnline?: { meio: string, situacao: string, valorEstornadoCentavos: number } | null }} pedido
 * @param {(centavos: number) => string} formatar
 */
export function avisoDoPedidoOnline(pedido, formatar = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`) {
  const p = pedido?.pagamentoOnline;
  if (!p) return null;
  const volta = VOLTA[p.meio] ?? VOLTA.PIX;
  if (pedido.podeCancelar) return { tipo: 'aguardando', texto: 'Pago. Aguardando a loja aceitar.' };
  if (pedido.status === 'CANCELADO') {
    if (p.situacao === 'ESTORNADO') return { tipo: 'estorno', texto: `Pedido cancelado e estornado. ${volta}` };
    if (p.situacao === 'ESTORNADO_PARCIAL') {
      return { tipo: 'estorno', texto: `Pedido cancelado. ${formatar(p.valorEstornadoCentavos)} foram estornados. ${volta}` };
    }
    if (p.situacao === 'ESTORNO_PENDENTE') {
      return { tipo: 'estorno', texto: 'Pedido cancelado. A devolução do valor está em andamento; se não aparecer em alguns dias, fale com o Taaki.' };
    }
  }
  if (['ESTORNADO', 'ESTORNADO_PARCIAL'].includes(p.situacao) && p.valorEstornadoCentavos > 0) {
    return { tipo: 'estorno', texto: `${formatar(p.valorEstornadoCentavos)} foram estornados. ${volta}` };
  }
  return null;
}

/** Erros do "Cancelar pedido" do app (a loja aceitou no meio, pedido já encerrado…). */
export function mensagemDoCancelamento(erro) {
  switch (erro?.codigo) {
    case 'PEDIDO_JA_ACEITO':
      return 'A loja já aceitou o pedido. Para cancelar, fale com a loja pelo WhatsApp.';
    case 'PEDIDO_ENCERRADO':
      return 'Este pedido já foi encerrado.';
    default:
      return erro?.message || 'Não foi possível cancelar agora. Confira sua conexão e tente de novo.';
  }
}
