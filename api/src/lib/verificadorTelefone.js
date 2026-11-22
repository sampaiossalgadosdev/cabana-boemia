import { timingSafeEqual } from 'node:crypto';
import { normalizarTelefone } from '@restaurante/shared/telefone';
import { ErroHttp } from './erros.js';

/**
 * Verificador de telefone do login com celular (plugável).
 *
 * Interface (o que a rota usa; o Firebase entra depois implementando a mesma):
 *   enviarCodigo(telefone: string) → Promise<void>
 *   conferirCodigo(telefone: string, codigo: string) → Promise<boolean>
 * `telefone` sempre no formato +55DDD9XXXXXXXX (E.164). Erro de envio = ErroHttp.
 *
 * PHONE_VERIFIER escolhe a implementação:
 *   vazio/ausente → desligado (todo envio responde "indisponível");
 *   "test"        → números e códigos fixos de PHONE_TEST_NUMBERS, sem SMS.
 *                   PROIBIDO em produção: a API não sobe (problemasNoVerificador).
 */

export const VERIFICADORES = ['test'];

/** "43999990000" (como o banco guarda) → "+5543999990000". */
export const paraE164 = (digitos) => `+55${digitos}`;

/**
 * Celular do Brasil em qualquer formatação → "+55" + DDD + 9 dígitos, ou null.
 * A regra do celular (DDD em uso, 9 na frente) é a do shared, a mesma do site.
 */
export function telefoneE164(valor) {
  const d = normalizarTelefone(valor);
  return d ? paraE164(d) : null;
}

/** Produção = NODE_ENV=production (Railway) ou o ambiente "production" que o Railway injeta. */
export function ehProducao(env = process.env) {
  return env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT_NAME === 'production';
}

/**
 * PHONE_TEST_NUMBERS = "+5543999990001:123456,+5543999990002:654321".
 * @returns {{ numeros: Map<string, string>, problemas: string[] }}
 */
export function lerNumerosDeTeste(texto = '') {
  const numeros = new Map();
  const problemas = [];
  for (const parte of String(texto).split(',').map((p) => p.trim()).filter(Boolean)) {
    const [numero, codigo, ...resto] = parte.split(':').map((p) => p.trim());
    const tel = /^\+55\d{11}$/.test(numero ?? '') ? telefoneE164(numero) : null;
    if (!tel || resto.length) problemas.push(`PHONE_TEST_NUMBERS: "${numero ?? ''}" não é um celular +55 + DDD + 9 dígitos`);
    else if (!/^\d{6}$/.test(codigo ?? '')) problemas.push(`PHONE_TEST_NUMBERS: o código de ${tel} precisa ter 6 números`);
    else numeros.set(tel, codigo);
  }
  return { numeros, problemas };
}

/**
 * Motivos para a API não subir por causa do verificador (lista vazia = ok).
 * A trava principal: PHONE_VERIFIER=test em produção.
 */
export function problemasNoVerificador(env = process.env) {
  const qual = (env.PHONE_VERIFIER ?? '').trim();
  if (!qual) return [];
  if (!VERIFICADORES.includes(qual)) {
    return [`PHONE_VERIFIER="${qual}" não existe (use: ${VERIFICADORES.join(', ')}; vazio = login com celular desligado)`];
  }
  if (qual === 'test' && ehProducao(env)) {
    return ['PHONE_VERIFIER=test é só para desenvolvimento: em produção qualquer um entraria com os números de teste. Apague a variável.'];
  }
  const { numeros, problemas } = lerNumerosDeTeste(env.PHONE_TEST_NUMBERS);
  if (problemas.length) return problemas;
  if (!numeros.size) return ['PHONE_VERIFIER=test sem números: preencha PHONE_TEST_NUMBERS (ex.: +5543999990001:123456)'];
  return [];
}

const indisponivel = () =>
  new ErroHttp(503, 'Verificação por SMS ainda não disponível. Entre com Google ou Apple.', { codigo: 'SMS_INDISPONIVEL' });

const mesmoCodigo = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Verificador de TESTE: só os números da lista, cada um com o seu código fixo. Nada é enviado. */
export function criarVerificadorTeste(numeros) {
  return {
    nome: 'test',
    async enviarCodigo(telefone) {
      if (!numeros.has(telefone)) throw indisponivel();
    },
    async conferirCodigo(telefone, codigo) {
      const certo = numeros.get(telefone);
      return Boolean(certo) && mesmoCodigo(certo, codigo);
    },
  };
}

/** Sem verificador configurado: o login com celular responde "indisponível". */
export const verificadorDesligado = {
  nome: 'desligado',
  async enviarCodigo() {
    throw indisponivel();
  },
  async conferirCodigo() {
    throw indisponivel();
  },
};

/**
 * O verificador do ambiente. Configuração inválida (inclusive "test" em
 * produção) cai no desligado: o server.js já recusou subir antes de chegar aqui.
 */
export function criarVerificadorTelefone(env = process.env) {
  if (problemasNoVerificador(env).length) return verificadorDesligado;
  if ((env.PHONE_VERIFIER ?? '').trim() === 'test') {
    return criarVerificadorTeste(lerNumerosDeTeste(env.PHONE_TEST_NUMBERS).numeros);
  }
  return verificadorDesligado;
}
