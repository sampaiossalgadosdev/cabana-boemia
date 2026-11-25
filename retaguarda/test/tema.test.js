import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMA_PADRAO, contraste } from '@restaurante/shared/cores';
import { TEMA_TAAKI, aplicarTema, definirLogoTaaki, faviconDaInicial, temaDaLoja } from '../src/lib/tema.js';
import { problemaDoArquivo } from '../src/lib/imagem.js';

test('tema da loja: cor e logo da loja; sem loja = estilo do Taaki Delivery', () => {
  const t = temaDaLoja({ nome: 'Lanchonete do Zé', logoUrl: '/api/publico/imagens/3', corPrimaria: '#1D4ED8' });
  assert.equal(t.nome, 'Lanchonete do Zé');
  assert.equal(t.logoUrl, '/api/publico/imagens/3');
  assert.equal(t.variaveis['--cor-primaria'], '#1D4ED8');
  assert.equal(t.variaveis['--cor-primaria-texto'], '#FFFFFF');
  assert.equal(t.taaki, false);

  const taaki = temaDaLoja(null);
  assert.equal(taaki.nome, 'Taaki Delivery');
  assert.equal(taaki.taaki, true);
  assert.equal(taaki.variaveis['--cor-primaria'], '#F26B1D');
  assert.equal(taaki.variaveis['--cor-menu'], '#0A1428');
  definirLogoTaaki('/admin/assets/logo-taaki.jpg');
  assert.equal(temaDaLoja(null).logoUrl, '/admin/assets/logo-taaki.jpg');
  assert.equal(temaDaLoja({ nome: 'Sem logo', corPrimaria: '#1D4ED8' }).logoUrl, null, 'loja sem logo não herda a do Taaki');
  definirLogoTaaki(null);
});

test('estilo do Taaki: contraste acessível nas combinações usadas', () => {
  const v = TEMA_TAAKI.variaveis;
  const pares = [
    [v['--cor-primaria-texto'], v['--cor-acao']], // botão
    [v['--cor-primaria-texto'], v['--cor-acao-hover']],
    [v['--cor-menu-texto'], v['--cor-menu']], // menu
    [v['--cor-primaria-escura-texto'], v['--cor-primaria-escura']], // aba ativa
    [v['--cor-primaria-na-base'], '#FFFFFF'], // texto laranja na base
    [v['--cor-primaria-na-base'], v['--cor-fundo']],
    [v['--cor-texto'], v['--cor-fundo']],
    [v['--cor-texto-suave'], v['--cor-fundo']],
    [v['--cor-texto-suave'], v['--cor-creme']],
  ];
  for (const [texto, fundo] of pares) assert.ok(contraste(texto, fundo) >= 4.5, `${texto} sobre ${fundo}: ${contraste(texto, fundo).toFixed(2)}`);
});

test('aplicarTema: troca Taaki e loja sem sobrar variável do tema anterior', () => {
  const estilo = new Map();
  const meta = { conteudo: '', setAttribute(_n, valor) { this.conteudo = valor; } };
  const link = { href: '', removeAttribute() {} };
  const doc = {
    documentElement: {
      dataset: {},
      style: { setProperty: (n, v) => estilo.set(n, v), removeProperty: (n) => estilo.delete(n) },
    },
    querySelector: (sel) => (sel.startsWith('meta') ? meta : link),
  };
  aplicarTema(null, doc);
  assert.equal(doc.documentElement.dataset.tema, 'taaki');
  assert.equal(estilo.get('--cor-fundo'), '#F5F7FA');
  assert.equal(meta.conteudo, '#0A1428');

  aplicarTema({ nome: 'Loja', corPrimaria: '#1D4ED8' }, doc);
  assert.equal(doc.documentElement.dataset.tema, 'loja');
  assert.equal(estilo.get('--cor-primaria'), '#1D4ED8');
  for (const nome of ['--cor-fundo', '--cor-menu', '--cor-creme', '--cor-acao']) assert.ok(!estilo.has(nome), `${nome} volta ao tokens.css`);

  aplicarTema(null, doc);
  assert.equal(estilo.get('--cor-primaria'), '#F26B1D');
});

test('cor ilegível vinda da loja cai no padrão (nunca deixa o texto sumir)', () => {
  assert.equal(temaDaLoja({ nome: 'X', corPrimaria: '#FFFF00' }).variaveis['--cor-primaria'], TEMA_PADRAO.corPrimaria);
});

test('favicon sem logo: SVG com a inicial, escapado', () => {
  const url = faviconDaInicial('<Zé>', '#1D4ED8', '#FFFFFF');
  assert.match(url, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(url.slice('data:image/svg+xml,'.length));
  assert.ok(!svg.includes('<Z'), 'sem tag injetada');
  assert.match(svg, /fill="#1D4ED8"/);
});

test('arquivo da logo: só PNG/JPEG/WebP até 500 KB', () => {
  assert.equal(problemaDoArquivo({ type: 'image/png', size: 1000 }), null);
  assert.match(problemaDoArquivo({ type: 'image/svg+xml', size: 1000 }), /PNG, JPEG ou WebP/);
  assert.match(problemaDoArquivo({ type: 'image/png', size: 600 * 1024 }), /500 KB/);
});
