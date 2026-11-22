/**
 * Login com celular (código de 6 dígitos): regras da tela, sem React Native.
 * A API normaliza o número (+55 + DDD + 9 dígitos); aqui só a prévia, com a
 * mesma regra do shared (a do site e do Perfil).
 */
import { normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';

/** Espera para pedir outro código (a API recusa antes: AGUARDE_REENVIO). */
export const REENVIO_SEGUNDOS = 60;

export const ERRO_REDE_CELULAR = 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';

/** O celular digitado (com ou sem máscara) é válido para pedir o código? */
export const celularValido = (texto) => normalizarTelefone(texto) !== null;

/** Só os números do código, no máximo 6 (colar "123 456" ou "123-456" também vale). */
export const limparCodigo = (texto) => String(texto ?? '').replace(/\D/g, '').slice(0, 6);

export const codigoCompleto = (codigo) => /^\d{6}$/.test(codigo ?? '');

/** Segundos que faltam para liberar o "Reenviar código" (0 = liberado). */
export function segundosParaReenviar(liberaEm, agora = Date.now()) {
  if (!liberaEm) return 0;
  return Math.max(0, Math.ceil((liberaEm - agora) / 1000));
}

/** "Reenviar código" / "Reenviar código em 0:45". */
export function textoReenvio(segundos) {
  if (segundos <= 0) return 'Reenviar código';
  const m = Math.floor(segundos / 60);
  const s = String(segundos % 60).padStart(2, '0');
  return `Reenviar código em ${m}:${s}`;
}

/**
 * Erro da API (ou da rede) → o que a tela faz:
 * `{ mensagem, campo: 'celular' | 'codigo' | 'geral', esperarSegundos? }`.
 * `esperarSegundos`: a API mandou esperar (o contador do reenvio passa a valer isso).
 */
export function interpretarErroCelular(erro) {
  if (!erro?.status) return { mensagem: ERRO_REDE_CELULAR, campo: 'geral' };
  const segundos = Number(erro.detalhes?.segundos) || undefined;
  switch (erro.codigo) {
    case 'TELEFONE_INVALIDO':
      return { mensagem: 'Número inválido. Digite o celular com DDD, ex.: (43) 99999-0000.', campo: 'celular' };
    case 'CODIGO_INVALIDO':
      return { mensagem: 'Código errado. Confira os 6 números e tente de novo.', campo: 'codigo' };
    case 'SMS_INDISPONIVEL':
      return {
        mensagem: 'Verificação por SMS ainda não disponível para este número. Entre com Google ou Apple.',
        campo: 'geral',
      };
    case 'AGUARDE_REENVIO':
      return { mensagem: 'Aguarde para pedir outro código.', campo: 'geral', esperarSegundos: segundos };
    case 'MUITOS_ENVIOS':
    case 'MUITAS_TENTATIVAS':
      return {
        mensagem: `Muitas tentativas. Aguarde ${segundos ? textoEspera(segundos) : 'alguns minutos'} e tente de novo.`,
        campo: 'geral',
        esperarSegundos: erro.codigo === 'MUITOS_ENVIOS' ? segundos : undefined,
      };
    case 'VALIDACAO':
      return { mensagem: erro.message || 'Confira o número e o código.', campo: 'codigo' };
    default:
      return { mensagem: erro.message || 'Não foi possível entrar. Tente de novo.', campo: 'geral' };
  }
}

/** 45 → "45 segundos"; 61 → "2 minutos"; 3500 → "59 minutos". */
export function textoEspera(segundos) {
  if (segundos < 60) return `${segundos} segundo${segundos === 1 ? '' : 's'}`;
  const min = Math.ceil(segundos / 60);
  return `${min} minuto${min === 1 ? '' : 's'}`;
}

export { MENSAGEM_TELEFONE_INVALIDO };
