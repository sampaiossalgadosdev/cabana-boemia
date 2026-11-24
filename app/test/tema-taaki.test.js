import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contraste } from '@restaurante/shared/cores';
import { coresTaaki as c, marcaTaaki } from '../src/tema/paleta.js';
import { coresDaLoja } from '../src/logica/lojas.js';

const TEXTO = 4.5;
const ICONE = 3;

test('paleta do Taaki: as cores do logo', () => {
  assert.equal(marcaTaaki.marinho, '#0A1428');
  assert.equal(marcaTaaki.laranja, '#F26B1D');
  assert.equal(marcaTaaki.laranjaClaro, '#FD9502');
  assert.equal(marcaTaaki.destaque, '#E02502');
  assert.equal(c.cabecalho, marcaTaaki.marinho);
  assert.equal(c.acao, marcaTaaki.laranja);
});

test('tema do Taaki: todo texto com 4,5:1 e ícone/borda de ação com 3:1', () => {
  const pares = [
    ['texto', 'fundo'],
    ['texto', 'superficie'],
    ['textoSuave', 'fundo'],
    ['textoSuave', 'superficie'],
    ['textoInverso', 'cabecalho'],
    ['textoAcao', 'acao'],
    ['textoAcao', 'acaoPressionada'],
    ['textoAcao', 'destaque'],
    ['acaoTexto', 'fundo'],
    ['acaoTexto', 'superficie'],
    ['preco', 'superficie'],
    ['erro', 'superficie'],
    ['erro', 'avisoFundo'],
    ['aviso', 'superficie'],
    ['texto', 'avisoFundo'],
  ];
  for (const [frente, fundo] of pares) {
    const r = contraste(c[frente], c[fundo]);
    assert.ok(r >= TEXTO, `${frente} sobre ${fundo}: ${r.toFixed(2)}`);
  }
  assert.ok(contraste(c.acao, c.superficie) >= ICONE, 'laranja como ícone/borda no branco');
});

test('loja com cor própria: texto e links na cor dela, escurecida até 4,5:1 no fundo', () => {
  const azul = coresDaLoja({ corPrimaria: '#3B82F6', corTexto: '#111111' }, c);
  assert.equal(azul.acao, '#3B82F6');
  assert.ok(contraste(azul.acaoTexto, '#FFFFFF') >= TEXTO);
  assert.equal(azul.erro, c.erro, 'erro continua o do Taaki');
  assert.equal(azul.fundo, c.fundo);
});
