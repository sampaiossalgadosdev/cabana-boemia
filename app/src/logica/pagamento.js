/**
 * Pagamento pelo app (Pix): opções da tela, contagem regressiva, estado do Pix, o Pix pendente
 * guardado no aparelho (para retomar se o app fechar) e os erros. Lógica pura, testada
 * (test/pagamento.test.js). Regras em docs/pagamento-online.md (Etapa 4).
 */
import { lerTexto, gravarTexto, removerTexto } from './armazenamento.js';
import { FORMAS_PAGAMENTO } from './pedido.js';

/** Opção "Pix pelo app" na escolha da forma (o resto são as formas na entrega). */
export const PIX_ONLINE = 'PIX_ONLINE';
/** A tela do Pix consulta a nossa API a cada 5 s. */
export const INTERVALO_CONSULTA_MS = 5_000;
/** Pix guardado há mais disto não é retomado (o pedido já expirou faz tempo). */
export const VALIDADE_RETOMADA_MS = 24 * 60 * 60 * 1000;
export const CHAVE_PIX_PENDENTE = 'delivery-abatia:pix-pendente:v1';

export const MENSAGEM_FALHA_PIX = 'Não foi possível gerar o Pix agora. Tente de novo ou escolha outra forma de pagamento.';
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
  if (formas?.online?.includes('PIX')) opcoes.push({ valor: PIX_ONLINE, rotulo: 'Pix pelo app (pagar agora)', agora: true });
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
 * `email`: falta o e-mail no cadastro; `formas`: a loja parou de aceitar Pix pelo app.
 * Outros erros: null (o checkout trata como sempre).
 */
export function interpretarErroDoPix(erro) {
  switch (erro?.codigo) {
    case 'PAGAMENTO_FALHOU':
      return { acao: 'novaChave', mensagem: MENSAGEM_FALHA_PIX };
    case 'PIX_EXPIRADO':
      return { acao: 'novaChave', mensagem: MENSAGEM_PIX_EXPIRADO };
    case 'EMAIL_OBRIGATORIO':
      return { acao: 'email', mensagem: 'Informe seu e-mail para pagar com Pix.' };
    case 'PAGAMENTO_ONLINE_INDISPONIVEL':
      return { acao: 'formas', mensagem: erro.message };
    default:
      return null;
  }
}

/** E-mail com formato aceitável (a API confere de novo). */
export const emailValido = (texto) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(texto ?? '').trim());
