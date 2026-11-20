import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETA_SUGESTOES,
  TEMA_PADRAO,
  TEXTO_CLARO,
  TEXTO_ESCURO,
  avaliarCor,
  contraste,
  corParaTextoNaBase,
  normalizarCor,
  textoSobre,
  variaveisDoTema,
} from '../src/cores.js';

test('normalizarCor aceita com ou sem # e devolve maiúsculas', () => {
  assert.equal(normalizarCor('#c8102e'), '#C8102E');
  assert.equal(normalizarCor(' C8102E '), '#C8102E');
  assert.equal(normalizarCor('#C81'), null);
  assert.equal(normalizarCor('vermelho'), null);
  assert.equal(normalizarCor(null), null);
});

test('contraste segue a WCAG (preto × branco = 21)', () => {
  assert.equal(Math.round(contraste('#000000', '#FFFFFF')), 21);
  assert.equal(contraste('#C8102E', '#C8102E'), 1);
});

test('texto por cima: claro em cor escura, escuro em cor clara', () => {
  assert.equal(textoSobre('#C8102E'), TEXTO_CLARO);
  assert.equal(textoSobre('#1E3A5F'), TEXTO_CLARO);
  assert.equal(textoSobre('#3B82F6'), TEXTO_ESCURO);
});

test('cor clara demais é recusada (some na base clara)', () => {
  for (const c of ['#FFFF00', '#FBF3E8', '#F59E0B', '#FFFFFF']) {
    const a = avaliarCor(c);
    assert.equal(a.ok, false, c);
    assert.match(a.motivo, /clara demais/);
  }
});

test('cor no meio do caminho (nem texto claro nem escuro dão 4,5:1) é recusada', () => {
  const a = avaliarCor('#7A7A7A'); // cinza médio: branco 4,3:1 e #111 4,4:1
  assert.equal(a.ok, false);
  assert.ok(a.contrasteBase >= 3);
  assert.match(a.motivo, /difícil de ler/);
});

test('formato inválido = recusada com mensagem', () => {
  assert.deepEqual(avaliarCor('azul').ok, false);
  assert.match(avaliarCor('azul').motivo, /#RRGGBB/);
});

test('todas as sugestões da paleta passam, e o padrão também', () => {
  for (const { cor } of PALETA_SUGESTOES) assert.equal(avaliarCor(cor).ok, true, cor);
  assert.equal(avaliarCor(TEMA_PADRAO.corPrimaria).ok, true);
});

test('cor para texto na base sempre dá 4,5:1 contra o branco', () => {
  for (const c of ['#3B82F6', '#C8102E', '#1E7B3C', '#000000']) {
    assert.ok(contraste(corParaTextoNaBase(c), '#FFFFFF') >= 4.5, c);
  }
  assert.equal(corParaTextoNaBase('#1E3A5F'), '#1E3A5F', 'já passa: a mesma cor');
});

test('variaveisDoTema: cor válida vira as variáveis; ilegível cai no padrão', () => {
  const v = variaveisDoTema('#1d4ed8');
  assert.equal(v['--cor-primaria'], '#1D4ED8');
  assert.equal(v['--cor-primaria-texto'], TEXTO_CLARO);
  assert.equal(variaveisDoTema('#FFFF00')['--cor-primaria'], TEMA_PADRAO.corPrimaria);
  assert.equal(variaveisDoTema(null)['--cor-primaria'], TEMA_PADRAO.corPrimaria);
  for (const nome of ['--cor-primaria-escura', '--cor-primaria-suave', '--cor-primaria-na-base', '--cor-primaria-escura-texto']) {
    assert.match(v[nome], /^#[0-9A-F]{6}$/);
  }
});
