import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { cnpjValido, cpfValido, normalizarCpfCnpj } from '../src/lib/documento.js';
import { situacao } from '../src/services/anuncio.service.js';
import { DOCUMENTOS_APP, dadosDaPlataforma, precisaAceite } from '../src/lib/controlador.js';
import { paginaPrivacidade, paginaTermos, VIGENCIA } from '../src/routes/legal.routes.js';

/**
 * Anúncios do app (carrossel "Patrocinado"), aceite dos termos/política por
 * versão, consentimento de marketing e GET /publico/app (tela "Sobre").
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const local = (iso) => new Date(`${iso}-03:00`);
const CPF = '52998224725';
const CNPJ = '11222333000181';

// ───────────── Sem banco ─────────────

test('CPF e CNPJ: dígitos verificadores, formatação aceita, repetidos recusados', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224724'), false);
  assert.equal(cpfValido('11111111111'), false);
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11222333000182'), false);
  assert.equal(normalizarCpfCnpj(' 11.222.333/0001-81 '), CNPJ);
  assert.equal(normalizarCpfCnpj('123'), null);
});

test('situação do anúncio: agendado, no ar, encerrado (fim exclusivo), desativado', () => {
  const a = { ativo: true, inicio: local('2026-11-20T00:00'), fim: local('2026-11-21T00:00') };
  assert.equal(situacao(a, local('2026-11-19T23:59')), 'AGENDADO');
  assert.equal(situacao(a, local('2026-11-20T00:00')), 'NO_AR');
  assert.equal(situacao(a, local('2026-11-21T00:00')), 'ENCERRADO');
  assert.equal(situacao({ ...a, ativo: false }, local('2026-11-20T12:00')), 'DESATIVADO');
});

test('documentos do app: versão atual, precisaAceite, Sobre e textos novos da política', () => {
  assert.equal(precisaAceite(null), true);
  assert.equal(precisaAceite('2000-01-01'), true);
  assert.equal(precisaAceite(DOCUMENTOS_APP.versao), false);
  assert.equal(VIGENCIA, DOCUMENTOS_APP.vigencia);
  const d = dadosDaPlataforma('contato@exemplo.com');
  assert.equal(d.documentos.versao, DOCUMENTOS_APP.versao);
  assert.equal(d.contato.email, 'contato@exemplo.com');
  assert.equal(dadosDaPlataforma(null).contato.email, null);
  assert.equal(d.documentos.privacidade, '/privacidade-app');
  const p = paginaPrivacidade('contato@exemplo.com');
  assert.match(p, /Estados Unidos<\/strong> \(região US East\)/);
  assert.match(p, /transferência internacional de dados/);
  assert.match(p, /Patrocinado/);
  assert.match(p, /Perfil › Comunicações/);
  assert.match(p, /não usamos seus dados para escolher anúncios/);
  assert.match(paginaTermos(null), /Anúncios e comunicações/);
});

// ───────────── Com banco ─────────────

describe('anúncios, aceite e marketing', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let agora = local('2026-11-20T12:00');
  let tkAdmin;
  let tkDono;
  let tkCliente;
  let cliente;
  let lojaTeste;

  async function api(metodo, rota, { corpo, token, bruto, tipo } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (bruto) headers['content-type'] = tipo ?? 'image/png';
    else if (corpo !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${rota}`, { method: metodo, headers, body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)) });
    const buf = Buffer.from(await res.arrayBuffer());
    let dados = buf;
    if ((res.headers.get('content-type') ?? '').includes('json')) dados = JSON.parse(buf.toString('utf8'));
    return { status: res.status, headers: res.headers, corpo: dados };
  }
  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;

  async function imagem() {
    const r = await api('POST', '/plataforma/anuncios/imagens', { token: tkAdmin, bruto: PNG });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.imagemId;
  }

  const anuncio = async (campos = {}) => ({
    anuncianteNome: 'Mercado do Zé',
    anuncianteDocumento: '11.222.333/0001-81',
    imagemId: await imagem(),
    destino: 'LINK',
    destinoUrl: 'https://mercadodoze.example.com',
    inicio: '2026-11-20T00:00:00-03:00',
    fim: '2026-11-27T00:00:00-03:00',
    valorPagoCentavos: 15000,
    naoDirigidoACriancas: true,
    ...campos,
  });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const usuarios = await import('../src/services/usuario.service.js');
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@teste.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');
    lojaTeste = await prisma.loja.create({ data: { slug: 'lanchonete-teste', nome: 'Lanchonete Teste' } });
    cliente = await prisma.cliente.create({ data: { googleId: 'g-anuncios', nome: 'Ana', email: 'ana@gmail.com', telefone: '43999990000' } });

    servidor = criarApp({ log: false, relogio: () => agora, emailTitular: 'titular@teste.test' }).listen(0);
    await new Promise((r) => servidor.once('listening', r));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tkAdmin = await login('admin@teste.test', 'senha-do-admin');
    tkDono = await login('dono@teste.test', 'senha-do-dono');
    tkCliente = gerarTokenCliente(cliente);
  });

  after(async () => {
    await new Promise((r) => servidor?.close(r));
    await prisma?.$disconnect();
  });

  test('só o ADMIN cadastra anúncios (DONO = 403, sem login = 401)', async () => {
    assert.equal((await api('GET', '/plataforma/anuncios', { token: tkDono })).status, 403);
    assert.equal((await api('GET', '/plataforma/anuncios')).status, 401);
    assert.equal((await api('POST', '/plataforma/anuncios/imagens', { token: tkDono, bruto: PNG })).status, 403);
  });

  test('imagem: tipo pelos bytes e tamanho', async () => {
    const svg = await api('POST', '/plataforma/anuncios/imagens', { token: tkAdmin, bruto: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), tipo: 'image/svg+xml' });
    assert.equal(svg.status, 415);
    const grande = await api('POST', '/plataforma/anuncios/imagens', { token: tkAdmin, bruto: Buffer.concat([PNG, Buffer.alloc(510 * 1024)]) });
    assert.equal(grande.status, 413);
  });

  test('criar: validações (documento, link, período, destino, declaração sobre crianças)', async () => {
    const tenta = async (campos) => api('POST', '/plataforma/anuncios', { token: tkAdmin, corpo: await anuncio(campos) });
    assert.equal((await tenta({ anuncianteDocumento: '11222333000182' })).corpo.erro.codigo, 'VALIDACAO');
    assert.equal((await tenta({ destinoUrl: 'http://inseguro.example.com' })).status, 400);
    assert.equal((await tenta({ destinoUrl: null })).status, 400);
    assert.equal((await tenta({ destino: 'LOJA', destinoUrl: null })).status, 400);
    assert.equal((await tenta({ destino: 'LOJA', destinoUrl: null, destinoLojaId: 999 })).corpo.erro.codigo, 'LOJA_NAO_ENCONTRADA');
    assert.equal((await tenta({ fim: '2026-11-19T00:00:00-03:00' })).status, 400);
    const crianca = await tenta({ naoDirigidoACriancas: false });
    assert.equal(crianca.status, 400);
    assert.match(crianca.corpo.erro.detalhes[0].mensagem, /crianças/);
    assert.equal((await tenta({ imagemId: 99999 })).corpo.erro.codigo, 'IMAGEM_INVALIDA');
  });

  test('ciclo: cria (link e loja), aparece no app só no período, com a loja ativa; desativar tira do ar', async () => {
    const link = await api('POST', '/plataforma/anuncios', { token: tkAdmin, corpo: await anuncio({ ordem: 2 }) });
    assert.equal(link.status, 201, JSON.stringify(link.corpo));
    assert.equal(link.corpo.anuncio.anuncianteDocumento, CNPJ);
    assert.equal(link.corpo.anuncio.situacao, 'NO_AR');
    const loja = await api('POST', '/plataforma/anuncios', {
      token: tkAdmin,
      corpo: await anuncio({ anuncianteNome: 'Lanchonete Teste', anuncianteDocumento: CPF, destino: 'LOJA', destinoUrl: null, destinoLojaId: lojaTeste.id, ordem: 1 }),
    });
    assert.equal(loja.status, 201, JSON.stringify(loja.corpo));
    const futuro = await api('POST', '/plataforma/anuncios', {
      token: tkAdmin,
      corpo: await anuncio({ inicio: '2026-12-01T00:00:00-03:00', fim: '2026-12-02T00:00:00-03:00' }),
    });
    assert.equal(futuro.corpo.anuncio.situacao, 'AGENDADO');

    let pub = await api('GET', '/publico/anuncios');
    assert.equal(pub.status, 200);
    assert.deepEqual(
      pub.corpo.anuncios.map((a) => a.destino),
      [{ tipo: 'LOJA', slug: 'lanchonete-teste', nome: 'Lanchonete Teste' }, { tipo: 'LINK', url: 'https://mercadodoze.example.com' }],
    );
    const [primeiro] = pub.corpo.anuncios;
    assert.equal(primeiro.anunciante, 'Lanchonete Teste');
    assert.equal(primeiro.anuncianteDocumento, undefined, 'o app não recebe o documento');
    assert.equal(primeiro.valorPagoCentavos, undefined, 'nem o valor pago');

    // imagem pública com cache longo
    const img = await api('GET', primeiro.imagemUrl.replace('/api', ''));
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.ok(PNG.equals(img.corpo));

    // loja desativada: o anúncio dela sai do carrossel
    await prisma.loja.update({ where: { id: lojaTeste.id }, data: { ativa: false } });
    pub = await api('GET', '/publico/anuncios');
    assert.deepEqual(pub.corpo.anuncios.map((a) => a.destino.tipo), ['LINK']);
    await prisma.loja.update({ where: { id: lojaTeste.id }, data: { ativa: true } });

    // desativar
    const off = await api('PATCH', `/plataforma/anuncios/${link.corpo.anuncio.id}`, { token: tkAdmin, corpo: { ativo: false } });
    assert.equal(off.corpo.anuncio.situacao, 'DESATIVADO');
    pub = await api('GET', '/publico/anuncios');
    assert.deepEqual(pub.corpo.anuncios.map((a) => a.destino.tipo), ['LOJA']);

    // fora do período (depois do fim, que é exclusivo)
    agora = local('2026-11-27T00:00');
    assert.deepEqual((await api('GET', '/publico/anuncios')).corpo.anuncios, []);
    agora = local('2026-11-20T12:00');

    const lista = await api('GET', '/plataforma/anuncios', { token: tkAdmin });
    assert.equal(lista.corpo.anuncios.length, 3);
  });

  test('alterar: troca de destino e de imagem (a antiga é apagada); fim antes do início = 400', async () => {
    const { corpo } = await api('POST', '/plataforma/anuncios', { token: tkAdmin, corpo: await anuncio() });
    const id = corpo.anuncio.id;
    const antiga = corpo.anuncio.imagemId;
    const nova = await imagem();
    const r = await api('PATCH', `/plataforma/anuncios/${id}`, { token: tkAdmin, corpo: { imagemId: nova, destino: 'LOJA', destinoLojaId: lojaTeste.id } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.anuncio.destinoUrl, null);
    assert.equal(r.corpo.anuncio.destinoLoja.slug, 'lanchonete-teste');
    assert.equal(await prisma.imagemAnuncio.count({ where: { id: antiga } }), 0);
    const ruim = await api('PATCH', `/plataforma/anuncios/${id}`, { token: tkAdmin, corpo: { fim: '2026-11-01T00:00:00-03:00' } });
    assert.equal(ruim.status, 400);
    assert.equal((await api('PATCH', '/plataforma/anuncios/99999', { token: tkAdmin, corpo: { ativo: false } })).status, 404);
  });

  test('registro: o banco não deixa apagar antes de 1 ano depois do fim (nem burlar os CHECKs)', async () => {
    const a = await prisma.anuncio.findFirst();
    await assert.rejects(prisma.anuncio.delete({ where: { id: a.id } }), /1 ano depois do fim/);
    // fim há mais de 1 ano: pode apagar
    await prisma.anuncio.update({ where: { id: a.id }, data: { inicio: new Date('2020-01-01T00:00:00Z'), fim: new Date('2020-02-01T00:00:00Z') } });
    await prisma.anuncio.delete({ where: { id: a.id } });
    await assert.rejects(prisma.anuncio.updateMany({ data: { naoDirigidoACriancas: false } }), /Anuncio_nao_dirigido_a_criancas/);
    await assert.rejects(prisma.anuncio.updateMany({ data: { anuncianteDocumento: '123' } }), /Anuncio_documento/);
  });

  test('GET /publico/app: dados da plataforma e versão dos documentos', async () => {
    const r = await api('GET', '/publico/app');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.documentos.versao, DOCUMENTOS_APP.versao);
    assert.equal(r.corpo.contato.email, 'titular@teste.test');
    assert.equal(r.corpo.plataforma.nome, 'Delivery Abatiá');
  });

  test('aceite: cliente novo precisa aceitar; versão antiga = 409; aceite grava versão, data e histórico', async () => {
    let me = await api('GET', '/cliente/me', { token: tkCliente });
    assert.equal(me.corpo.cliente.precisaAceite, true);
    assert.equal(me.corpo.cliente.termosVersao, null);
    assert.equal(me.corpo.cliente.marketing, false, 'marketing nasce desligado');

    const velha = await api('POST', '/cliente/aceite', { token: tkCliente, corpo: { versao: '2026-01-01' } });
    assert.equal(velha.status, 409);
    assert.equal(velha.corpo.erro.codigo, 'VERSAO_DESATUALIZADA');

    const ok = await api('POST', '/cliente/aceite', { token: tkCliente, corpo: { versao: DOCUMENTOS_APP.versao } });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.cliente.precisaAceite, false);
    await api('POST', '/cliente/aceite', { token: tkCliente, corpo: { versao: DOCUMENTOS_APP.versao } }); // repetido: não grava de novo
    const historico = await prisma.consentimento.findMany({ where: { clienteId: cliente.id } });
    assert.equal(historico.length, 1);
    assert.equal(historico[0].tipo, 'TERMOS');
    assert.equal(historico[0].versao, DOCUMENTOS_APP.versao);
    assert.ok(historico[0].ip);
    const banco = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    assert.equal(banco.termosAceitosEm.toISOString(), agora.toISOString());

    // versão nova publicada: precisa aceitar de novo
    await prisma.cliente.update({ where: { id: cliente.id }, data: { termosVersao: '2026-01-01' } });
    me = await api('GET', '/cliente/me', { token: tkCliente });
    assert.equal(me.corpo.cliente.precisaAceite, true);
    await api('POST', '/cliente/aceite', { token: tkCliente, corpo: { versao: DOCUMENTOS_APP.versao } });
  });

  test('marketing: opcional, liga e desliga (revogável), histórico só quando muda', async () => {
    const liga = await api('PUT', '/cliente/marketing', { token: tkCliente, corpo: { aceito: true } });
    assert.equal(liga.status, 200);
    assert.equal(liga.corpo.cliente.marketing, true);
    await api('PUT', '/cliente/marketing', { token: tkCliente, corpo: { aceito: true } });
    const desliga = await api('PUT', '/cliente/marketing', { token: tkCliente, corpo: { aceito: false } });
    assert.equal(desliga.corpo.cliente.marketing, false);
    assert.equal((await api('PUT', '/cliente/marketing', { token: tkCliente, corpo: {} })).status, 400);
    const tipos = (await prisma.consentimento.findMany({ where: { clienteId: cliente.id, tipo: { not: 'TERMOS' } }, orderBy: { id: 'asc' } })).map((c) => c.tipo);
    assert.deepEqual(tipos, ['MARKETING_CONCEDIDO', 'MARKETING_REVOGADO']);
    assert.equal((await api('PUT', '/cliente/marketing', { corpo: { aceito: true } })).status, 401);
  });

  test('excluir a conta apaga os consentimentos junto (CASCADE)', async () => {
    const c2 = await prisma.cliente.create({ data: { googleId: 'g-apagar', nome: 'Bia', telefone: '43999991111' } });
    await prisma.consentimento.create({ data: { clienteId: c2.id, tipo: 'MARKETING_CONCEDIDO', ip: '1.2.3.4' } });
    await prisma.cliente.delete({ where: { id: c2.id } });
    assert.equal(await prisma.consentimento.count({ where: { clienteId: c2.id } }), 0);
  });
});
