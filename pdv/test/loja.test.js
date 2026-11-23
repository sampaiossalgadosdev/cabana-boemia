import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { criarClienteApi } from '../src/main/clienteApi.js';
import { criarEstadoLoja } from '../src/main/loja.js';
import { temaDaLoja } from '../src/renderer/src/lib/tema.js';
import { digitosNfce, formatarChaveNfce, problemaNaChaveNfce } from '../src/renderer/src/lib/painel.js';

const AGORA = 1_800_000_000_000;
const jwt = (expMs) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 1, exp: Math.floor(expMs / 1000) })}.x`;
};

describe('loja do PDV', () => {
  test('X-Loja vai só nas requisições autenticadas e só quando há loja informada (ADMIN)', async () => {
    const vistos = [];
    let informada = null;
    const api = criarClienteApi({
      apiUrl: () => 'http://x/api',
      agora: () => AGORA,
      armazem: { ler: async () => 'r', guardar: async () => {}, apagar: async () => {} },
      lojaInformada: () => informada,
      fetch: async (url, init) => {
        vistos.push({ rota: new URL(url).pathname, loja: init.headers['x-loja'] ?? null });
        if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ accessToken: jwt(AGORA + 900_000), refreshToken: 'r', usuario: { papel: 'ADMIN' } }));
        return new Response(JSON.stringify({ ok: true }));
      },
    });
    informada = 'lanchonete-do-ze';
    await api.entrar('a@b.com', 'x');
    await api.requisitar('GET', '/equipe/pedidos');
    informada = null;
    await api.requisitar('GET', '/equipe/pedidos');
    assert.deepEqual(vistos, [
      { rota: '/api/auth/login', loja: null },
      { rota: '/api/equipe/pedidos', loja: 'lanchonete-do-ze' },
      { rota: '/api/equipe/pedidos', loja: null },
    ]);
  });

  test('estado: só o ADMIN informa a loja; logo inválida ou grande demais = sem logo (mostra o nome)', async () => {
    const respostas = {
      '/api/publico/imagens/1': () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
      '/api/publico/imagens/2': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      '/api/publico/imagens/3': () => new Response(new Uint8Array(700 * 1024), { headers: { 'content-type': 'image/png' } }),
    };
    let baixou = 0;
    const loja = criarEstadoLoja({
      servidor: () => 'https://cabana.exemplo',
      fetch: async (url) => {
        baixou += 1;
        return respostas[new URL(url).pathname]();
      },
    });
    loja.iniciar({ papel: 'DONO' }, 'outra');
    assert.equal(loja.informada(), null);
    loja.iniciar({ papel: 'ADMIN' }, 'lanchonete-do-ze');
    assert.equal(loja.informada(), 'lanchonete-do-ze');
    assert.equal((await loja.definirIdentidade({ nome: 'Zé', logoUrl: '/api/publico/imagens/1' })).logoDataUrl, 'data:image/webp;base64,AQID');
    await loja.definirIdentidade({ nome: 'Zé', logoUrl: '/api/publico/imagens/1' });
    assert.equal(baixou, 1, 'cache por endereço');
    assert.equal((await loja.definirIdentidade({ nome: 'Zé', logoUrl: '/api/publico/imagens/2' })).logoDataUrl, null);
    assert.equal((await loja.definirIdentidade({ nome: 'Zé', logoUrl: '/api/publico/imagens/3' })).logoDataUrl, null);
    assert.equal((await loja.definirIdentidade({ nome: 'Zé', logoUrl: null })).logoDataUrl, null);
  });

  test('tema: cor da loja; sem loja = Taaki Delivery', () => {
    const t = temaDaLoja({ nome: 'Lanchonete do Zé', corPrimaria: '#3B82F6', logoDataUrl: 'data:x' });
    assert.equal(t.variaveis['--cor-primaria'], '#3B82F6');
    assert.equal(t.variaveis['--cor-primaria-texto'], '#111111', 'cor clara: texto escuro');
    assert.equal(t.titulo, 'Lanchonete do Zé · PDV');
    assert.equal(t.logo, 'data:x');
    assert.equal(temaDaLoja(null).nome, 'Taaki Delivery');
    assert.equal(temaDaLoja(null).logo, null);
  });

  test('NFC-e no painel: só números, grupos de 4, modelo 65', () => {
    const chave = '41261112345678000190650010000000011123456780';
    assert.equal(digitosNfce(`${chave}999`), chave);
    assert.equal(formatarChaveNfce(chave).split(' ').length, 11);
    assert.equal(problemaNaChaveNfce(formatarChaveNfce(chave)), null);
    assert.equal(problemaNaChaveNfce(''), null, 'vazio = apagar');
    assert.match(problemaNaChaveNfce('4126'), /faltam 40/);
    assert.match(problemaNaChaveNfce(`${chave.slice(0, 20)}55${chave.slice(22)}`), /modelo 65/);
  });
});
