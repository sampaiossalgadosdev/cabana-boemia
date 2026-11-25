import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cifrar, decifrar, problemaNaChave, chaveDoAmbiente } from '../src/lib/cifra.js';
import {
  formasDaLoja,
  minimoFreteGratisPlataforma,
  pagamentoOnlineDisponivel,
  pagamentoOnlineLigado,
  problemasNoPagamentoOnline,
} from '../src/lib/pagamentoOnline.js';
import { raizApi } from './helpers/banco.js';

const CHAVE_HEX = 'ab'.repeat(32);
const CHAVE = Buffer.from(CHAVE_HEX, 'hex');

describe('cifra dos tokens (AES-256-GCM)', () => {
  test('ida e volta; cada cifra sai diferente (IV aleatório); nada do texto aparece', () => {
    const token = 'APP_USR-1234567890-abcdef-token-da-loja';
    const a = cifrar(token, CHAVE);
    const b = cifrar(token, CHAVE);
    assert.notEqual(a, b);
    assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!a.includes('APP_USR'));
    assert.equal(decifrar(a, CHAVE), token);
    assert.equal(decifrar(cifrar('', CHAVE), CHAVE), '');
    assert.equal(decifrar(cifrar('ação ✓', CHAVE), CHAVE), 'ação ✓');
  });

  test('chave errada falha', () => {
    const c = cifrar('segredo', CHAVE);
    assert.throws(() => decifrar(c, randomBytes(32)));
  });

  test('dado adulterado ou formato estranho falha', () => {
    const [v, iv, tag, dados] = cifrar('segredo', CHAVE).split('.');
    const trocado = Buffer.from(dados, 'base64url');
    trocado[0] ^= 1;
    assert.throws(() => decifrar([v, iv, tag, trocado.toString('base64url')].join('.'), CHAVE));
    assert.throws(() => decifrar(`v2.${iv}.${tag}.${dados}`, CHAVE), /formato/);
    assert.throws(() => decifrar('qualquer coisa', CHAVE), /formato/);
    assert.throws(() => decifrar(null, CHAVE), /formato/);
  });

  test('chave do ambiente: 64 hexadecimais; senão o motivo', () => {
    assert.equal(problemaNaChave(CHAVE_HEX), null);
    assert.equal(problemaNaChave(CHAVE_HEX.toUpperCase()), null);
    assert.match(problemaNaChave(''), /ausente/);
    assert.match(problemaNaChave(undefined), /ausente/);
    assert.match(problemaNaChave('ab'.repeat(31)), /64 caracteres/);
    assert.match(problemaNaChave('zz'.repeat(32)), /64 caracteres/);
    assert.deepEqual(chaveDoAmbiente({ TOKEN_ENCRYPTION_KEY: CHAVE_HEX }), CHAVE);
    assert.throws(() => chaveDoAmbiente({ TOKEN_ENCRYPTION_KEY: 'curta' }));
  });
});

describe('flag PAGAMENTO_ONLINE_ATIVO e disponibilidade por loja', () => {
  const LIGADA = { PAGAMENTO_ONLINE_ATIVO: 'sim', TOKEN_ENCRYPTION_KEY: CHAVE_HEX };
  const loja = { modoEntrega: 'PROPRIO', pagamentoOnlineAtivo: true };
  const conectada = { status: 'CONECTADA' };

  test('só "sim" liga (maiúsculas e espaços não importam)', () => {
    assert.equal(pagamentoOnlineLigado({}), false);
    assert.equal(pagamentoOnlineLigado({ PAGAMENTO_ONLINE_ATIVO: '' }), false);
    assert.equal(pagamentoOnlineLigado({ PAGAMENTO_ONLINE_ATIVO: 'true' }), false);
    assert.equal(pagamentoOnlineLigado({ PAGAMENTO_ONLINE_ATIVO: ' SIM ' }), true);
  });

  test('flag ligada exige a chave válida; desligada não exige nada', () => {
    assert.deepEqual(problemasNoPagamentoOnline({}), []);
    assert.deepEqual(problemasNoPagamentoOnline({ TOKEN_ENCRYPTION_KEY: 'lixo' }), []);
    assert.deepEqual(problemasNoPagamentoOnline(LIGADA), []);
    assert.match(problemasNoPagamentoOnline({ PAGAMENTO_ONLINE_ATIVO: 'sim' })[0], /TOKEN_ENCRYPTION_KEY ausente/);
    assert.match(problemasNoPagamentoOnline({ PAGAMENTO_ONLINE_ATIVO: 'sim', TOKEN_ENCRYPTION_KEY: 'abc' })[0], /64 caracteres/);
  });

  test('disponível só com flag + loja ligada + conexão CONECTADA', () => {
    assert.equal(pagamentoOnlineDisponivel(loja, conectada, LIGADA), true);
    assert.equal(pagamentoOnlineDisponivel(loja, conectada, {}), false);
    assert.equal(pagamentoOnlineDisponivel({ ...loja, pagamentoOnlineAtivo: false }, conectada, LIGADA), false);
    assert.equal(pagamentoOnlineDisponivel(loja, null, LIGADA), false);
    assert.equal(pagamentoOnlineDisponivel(loja, { status: 'EXPIRADA' }, LIGADA), false);
    assert.equal(pagamentoOnlineDisponivel(loja, { status: 'DESCONECTADA' }, LIGADA), false);
  });

  test('flag desligada: as formas de hoje, sem online, mesmo com a loja conectada', () => {
    assert.deepEqual(formasDaLoja(loja, conectada, {}), { naEntrega: ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO'], online: [] });
    assert.deepEqual(formasDaLoja(loja, conectada, LIGADA).online, ['PIX', 'CARTAO_ONLINE']);
    assert.deepEqual(formasDaLoja({ modoEntrega: 'PLATAFORMA' }, null, {}), { naEntrega: ['DINHEIRO'], online: [] });
  });

  test('mínimo do frete grátis em loja PLATAFORMA: padrão R$ 20,00, configurável', () => {
    assert.equal(minimoFreteGratisPlataforma({}), 2000);
    assert.equal(minimoFreteGratisPlataforma({ FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: '3500' }), 3500);
    assert.equal(minimoFreteGratisPlataforma({ FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: 'abc' }), 2000);
    assert.equal(minimoFreteGratisPlataforma({ FRETE_GRATIS_MINIMO_PLATAFORMA_CENTAVOS: '0' }), 2000);
  });
});

describe('server.js com o pagamento online ligado', () => {
  test('sem chave: sai com código 1 e explica o motivo', async () => {
    const env = { ...process.env, PORT: '0', PAGAMENTO_ONLINE_ATIVO: 'sim', TOKEN_ENCRYPTION_KEY: '' };
    const { codigo, saida } = await new Promise((resolve) => {
      const filho = spawn(process.execPath, [path.join(raizApi, 'src', 'server.js')], { env });
      let saida = '';
      filho.stdout.on('data', (d) => (saida += d));
      filho.stderr.on('data', (d) => (saida += d));
      const timer = setTimeout(() => filho.kill(), 10_000);
      filho.on('exit', (codigo) => {
        clearTimeout(timer);
        resolve({ codigo, saida });
      });
    });
    assert.equal(codigo, 1);
    assert.match(saida, /A API não vai iniciar \(pagamento online\)/);
    assert.match(saida, /TOKEN_ENCRYPTION_KEY ausente/);
    assert.doesNotMatch(saida, /API ouvindo/);
  });
});
