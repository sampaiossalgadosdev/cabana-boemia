import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ETIQUETA_ANUNCIO, acaoDoAnuncio, anunciosParaMostrar, rotuloDoAnuncio } from '../src/logica/anuncios.js';
import { PLATAFORMA_PADRAO, dadosDaPlataforma, precisaAceitar } from '../src/logica/plataforma.js';

const BASE = 'https://cabana.managerpix.com.br/api';
const loja = { id: 1, anunciante: 'Lanchonete Teste', imagemUrl: '/api/publico/anuncios/imagens/7', destino: { tipo: 'LOJA', slug: 'lanchonete-teste', nome: 'Lanchonete Teste' } };
const link = { id: 2, anunciante: 'Mercado do Zé', imagemUrl: '/api/publico/anuncios/imagens/8', destino: { tipo: 'LINK', url: 'https://mercado.example.com/oferta' } };

test('destino do anúncio: loja do app ou link https; o resto é ignorado', () => {
  assert.deepEqual(acaoDoAnuncio(loja), { tipo: 'loja', caminho: '/loja/lanchonete-teste' });
  assert.deepEqual(acaoDoAnuncio(link), { tipo: 'link', url: 'https://mercado.example.com/oferta' });
  assert.equal(acaoDoAnuncio({ destino: { tipo: 'LINK', url: 'http://inseguro.example.com' } }), null);
  assert.equal(acaoDoAnuncio({ destino: { tipo: 'LINK', url: 'javascript:alert(1)' } }), null);
  assert.equal(acaoDoAnuncio({ destino: { tipo: 'LOJA', slug: '../admin' } }), null);
  assert.equal(acaoDoAnuncio(null), null);
});

test('anúncios para mostrar: imagem com a base da API, sem os inválidos; etiqueta e rótulo acessível', () => {
  const r = anunciosParaMostrar([loja, link, { id: 3, imagemUrl: null, destino: link.destino }, { ...link, id: 4, destino: { tipo: 'X' } }], BASE);
  assert.deepEqual(r.map((a) => a.id), [1, 2]);
  assert.equal(r[0].imagem, 'https://cabana.managerpix.com.br/api/publico/anuncios/imagens/7');
  assert.deepEqual(anunciosParaMostrar(undefined, BASE), []);
  assert.equal(ETIQUETA_ANUNCIO, 'Patrocinado');
  assert.equal(rotuloDoAnuncio(r[0]), 'Patrocinado: Lanchonete Teste. Abre a loja Lanchonete Teste.');
  assert.equal(rotuloDoAnuncio(r[1]), 'Patrocinado: Mercado do Zé. Abre o site do anunciante.');
});

test('dados da plataforma: resposta da API conferida; sem resposta = padrão com os links legais', () => {
  assert.deepEqual(dadosDaPlataforma(null), PLATAFORMA_PADRAO);
  const d = dadosDaPlataforma({
    plataforma: { nome: 'Delivery Abatiá', responsavel: 'Fulano', documento: null, cidade: 'Abatiá-PR', identificacao: 'Fulano, Abatiá-PR' },
    contato: { email: 'contato@exemplo.com', formulario: '/excluir-conta' },
    documentos: { versao: '2026-11-20', vigencia: '20 de novembro de 2026', privacidade: '/privacidade-app', termos: 'javascript:x', excluirConta: '/excluir-conta' },
  });
  assert.equal(d.plataforma.responsavel, 'Fulano');
  assert.equal(d.contato.email, 'contato@exemplo.com');
  assert.equal(d.documentos.versao, '2026-11-20');
  assert.equal(d.documentos.termos, '/termos-app', 'caminho estranho volta ao padrão');
  assert.equal(dadosDaPlataforma({ contato: { email: 'sem-arroba' } }).contato.email, null);
});

test('precisaAceitar: só logado e com o aceite pendente', () => {
  assert.equal(precisaAceitar('logado', { precisaAceite: true }), true);
  assert.equal(precisaAceitar('logado', { precisaAceite: false }), false);
  assert.equal(precisaAceitar('anonimo', null), false);
  assert.equal(precisaAceitar('erro', { precisaAceite: true }), false);
});
