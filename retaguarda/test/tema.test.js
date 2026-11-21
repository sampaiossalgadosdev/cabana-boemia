import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMA_PADRAO } from '@restaurante/shared/cores';
import { faviconDaInicial, temaDaLoja } from '../src/lib/tema.js';
import { problemaDoArquivo } from '../src/lib/imagem.js';

test('tema da loja: cor e logo da loja; sem loja = Delivery do Batiá', () => {
  const t = temaDaLoja({ nome: 'Lanchonete do Zé', logoUrl: '/api/publico/imagens/3', corPrimaria: '#1D4ED8' });
  assert.equal(t.nome, 'Lanchonete do Zé');
  assert.equal(t.logoUrl, '/api/publico/imagens/3');
  assert.equal(t.variaveis['--cor-primaria'], '#1D4ED8');
  assert.equal(t.variaveis['--cor-primaria-texto'], '#FFFFFF');

  const padrao = temaDaLoja(null);
  assert.equal(padrao.nome, TEMA_PADRAO.nome);
  assert.equal(padrao.logoUrl, null);
  assert.equal(padrao.variaveis['--cor-primaria'], TEMA_PADRAO.corPrimaria);
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
