/**
 * Cifra dos tokens da loja (Mercado Pago) guardados no banco: AES-256-GCM com a
 * chave TOKEN_ENCRYPTION_KEY (64 caracteres hexadecimais = 32 bytes).
 *
 * Formato: "v1.<iv>.<tag>.<dados>" (base64url; IV aleatório de 12 bytes por cifra).
 * O prefixo de versão permite trocar de chave depois (v2 com a nova, relendo a v1).
 * Dado adulterado ou chave errada = erro (a tag do GCM não confere). Nunca registrar
 * o texto aberto nem a chave em log.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';

/** Problema na chave (texto para o log), ou null se ela é válida. */
export function problemaNaChave(chaveHex) {
  const v = String(chaveHex ?? '').trim();
  if (!v) return 'TOKEN_ENCRYPTION_KEY ausente';
  if (!/^[0-9a-fA-F]{64}$/.test(v)) return 'TOKEN_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais (32 bytes)';
  return null;
}

/** Chave em bytes, lida do ambiente (lança se inválida). */
export function chaveDoAmbiente(env = process.env) {
  const problema = problemaNaChave(env.TOKEN_ENCRYPTION_KEY);
  if (problema) throw new Error(problema);
  return Buffer.from(env.TOKEN_ENCRYPTION_KEY.trim(), 'hex');
}

/**
 * @param {string} texto
 * @param {Buffer} [chave] 32 bytes (padrão: a do ambiente)
 */
export function cifrar(texto, chave = chaveDoAmbiente()) {
  if (typeof texto !== 'string') throw new TypeError('cifrar: texto deve ser string');
  const iv = randomBytes(12);
  const cifra = createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  return [VERSAO, iv.toString('base64url'), cifra.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

/**
 * @param {string} cifrado no formato de `cifrar`
 * @param {Buffer} [chave]
 */
export function decifrar(cifrado, chave = chaveDoAmbiente()) {
  const partes = String(cifrado ?? '').split('.');
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new Error('decifrar: formato desconhecido');
  const [, iv, tag, dados] = partes.map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64url')));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('decifrar: formato desconhecido');
  const decifra = createDecipheriv(ALGORITMO, chave, iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8');
}
