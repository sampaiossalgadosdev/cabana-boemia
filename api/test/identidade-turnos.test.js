import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { semBancoDeTeste, resetarBancoDeTeste } from './helpers/banco.js';
import { tipoDaImagem } from '../src/services/identidade.service.js';

const local = (iso) => new Date(`${iso}-03:00`);
const SEGUNDA_06H30 = local('2026-11-16T06:30');
// PNG 1×1 válido.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('tipo da imagem pelos bytes', () => {
  test('PNG, JPEG e WebP passam; SVG e texto não', () => {
    assert.equal(tipoDaImagem(PNG), 'image/png');
    assert.equal(tipoDaImagem(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
    assert.equal(tipoDaImagem(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
    assert.equal(tipoDaImagem(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    assert.equal(tipoDaImagem(Buffer.from('oi')), null);
  });
});

describe('turnos pela retaguarda e identidade visual da loja', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  const agora = SEGUNDA_06H30;
  const tk = {};
  let ze;

  async function api(metodo, rota, { corpo, token, cabecalhos = {}, bruto } = {}) {
    const headers = { ...(token && { authorization: `Bearer ${token}` }), ...cabecalhos };
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers,
      body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
    });
    const tipo = res.headers.get('content-type') ?? '';
    if (!tipo.includes('json')) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    const texto = await res.text();
    return { status: res.status, headers: res.headers, corpo: texto ? JSON.parse(texto) : null };
  }
  const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;
  const enviarLogo = (rota, token, bytes, tipo = 'image/png') =>
    api('PUT', rota, { token, bruto: bytes, cabecalhos: { 'content-type': tipo } });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const usuarios = await import('../src/services/usuario.service.js');
    await usuarios.criarDono({ nome: 'Dono Cabana', email: 'dono@cabana.test', senha: 'senha-do-dono' });
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@cabana.test', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@teste.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@teste.test');
    servidor = http.createServer(criarApp({ log: false, relogio: () => agora }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tk.cabana = await login('dono@cabana.test', 'senha-do-dono');
    tk.ana = await login('ana@cabana.test', 'senha-da-ana');
    tk.admin = await login('admin@teste.test', 'senha-do-admin');
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Plataforma: cor e logo padrão ─────────

  test('ADMIN cria a loja com a cor padrão; cor ilegível = 400; a loja começa no padrão', async () => {
    const clara = await api('POST', '/plataforma/lojas', { token: tk.admin, corpo: { slug: 'amarela', nome: 'Amarela', corPrimaria: '#FFFF00' } });
    assert.equal(clara.status, 400);
    assert.match(JSON.stringify(clara.corpo.erro), /clara demais/);

    const r = await api('POST', '/plataforma/lojas', {
      token: tk.admin,
      corpo: { slug: 'lanchonete-do-ze', nome: 'Lanchonete do Zé', corPrimaria: '#1d4ed8', turnos: ['Noite'] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    ze = r.corpo.loja;
    assert.equal(ze.corPrimaria, '#1D4ED8');
    assert.equal(ze.corPrimariaPadrao, '#1D4ED8');
    assert.equal(ze.logoUrlPadrao, null);
    await api('POST', `/plataforma/lojas/${ze.id}/dono`, { token: tk.admin, corpo: { nome: 'Zé', email: 'ze@ze.test', senha: 'senha-do-ze' } });
    tk.ze = await login('ze@ze.test', 'senha-do-ze');
  });

  test('ADMIN envia a logo padrão: a loja sem personalização acompanha; a imagem é servida com cache longo', async () => {
    const r = await enviarLogo(`/plataforma/lojas/${ze.id}/logo-padrao`, tk.admin, PNG);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.match(r.corpo.loja.logoUrlPadrao, /^\/api\/publico\/imagens\/\d+$/);
    assert.equal(r.corpo.loja.logoUrl, r.corpo.loja.logoUrlPadrao);

    const img = await fetch(`${new URL(base).origin}${r.corpo.loja.logoUrl}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await enviarLogo(`/plataforma/lojas/${ze.id}/logo-padrao`, tk.ze, PNG)).status, 403, 'dono não mexe no padrão');
  });

  test('login e /auth/me trazem a identidade da loja; ADMIN não tem loja', async () => {
    const me = await api('GET', '/auth/me', { token: tk.ze });
    assert.equal(me.corpo.usuario.loja.slug, 'lanchonete-do-ze');
    assert.equal(me.corpo.usuario.loja.corPrimaria, '#1D4ED8');
    assert.equal(me.corpo.usuario.loja.corTexto, '#FFFFFF');
    assert.match(me.corpo.usuario.loja.logoUrl, /^\/api\/publico\/imagens\//);
    assert.equal((await api('GET', '/auth/me', { token: tk.admin })).corpo.usuario.loja, null);
    const vitrine = (await api('GET', '/publico/lojas')).corpo.lojas.find((l) => l.slug === 'lanchonete-do-ze');
    assert.equal(vitrine.corPrimaria, '#1D4ED8');
    assert.equal(vitrine.corTexto, '#FFFFFF');
  });

  // ───────── Perfil da loja (DONO) ─────────

  test('perfil: dono troca a cor (ilegível = 422 COR_ILEGIVEL), a logo (só PNG/JPEG/WebP, até 500 KB) e volta ao padrão', async () => {
    const perfil = await api('GET', '/retaguarda/perfil', { token: tk.ze });
    assert.equal(perfil.corpo.perfil.noPadrao, true);
    const padraoAntes = perfil.corpo.perfil.logoUrlPadrao;

    const ilegivel = await api('PUT', '/retaguarda/perfil/cor', { token: tk.ze, corpo: { corPrimaria: '#7A7A7A' } });
    assert.equal(ilegivel.status, 422);
    assert.equal(ilegivel.corpo.erro.codigo, 'COR_ILEGIVEL');
    assert.equal((await api('PUT', '/retaguarda/perfil/cor', { token: tk.ze, corpo: { corPrimaria: 'azul' } })).status, 422);

    const cor = await api('PUT', '/retaguarda/perfil/cor', { token: tk.ze, corpo: { corPrimaria: '#3b82f6' } });
    assert.equal(cor.status, 200);
    assert.equal(cor.corpo.perfil.corPrimaria, '#3B82F6');
    assert.equal(cor.corpo.perfil.corTexto, '#111111', 'cor clara: texto escuro por cima');
    assert.equal(cor.corpo.perfil.noPadrao, false);

    assert.equal((await enviarLogo('/retaguarda/perfil/logo', tk.ze, Buffer.from('<svg></svg>'), 'image/svg+xml')).status, 415);
    const grande = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]);
    assert.equal((await enviarLogo('/retaguarda/perfil/logo', tk.ze, grande)).status, 413);
    const logo = await enviarLogo('/retaguarda/perfil/logo', tk.ze, PNG);
    assert.equal(logo.status, 200, JSON.stringify(logo.corpo));
    assert.notEqual(logo.corpo.perfil.logoUrl, padraoAntes);

    // ADMIN troca o padrão depois da personalização: a loja fica com a do dono.
    const novoPadrao = await enviarLogo(`/plataforma/lojas/${ze.id}/logo-padrao`, tk.admin, PNG);
    assert.equal(novoPadrao.corpo.loja.logoUrl, logo.corpo.perfil.logoUrl);
    // A padrão antiga não é usada por ninguém: apagada.
    assert.equal((await fetch(`${new URL(base).origin}${padraoAntes}`)).status, 404);

    const volta = await api('POST', '/retaguarda/perfil/padrao', { token: tk.ze });
    assert.equal(volta.status, 200);
    assert.equal(volta.corpo.perfil.corPrimaria, '#1D4ED8');
    assert.equal(volta.corpo.perfil.logoUrl, novoPadrao.corpo.loja.logoUrlPadrao);
    assert.equal(volta.corpo.perfil.noPadrao, true);
    assert.equal((await fetch(`${new URL(base).origin}${logo.corpo.perfil.logoUrl}`)).status, 404, 'logo do dono apagada');
    assert.equal(await prisma.imagemLoja.count({ where: { lojaId: ze.id } }), 1);
  });

  test('perfil: ADMIN muda a cor padrão e a loja no padrão acompanha; atendente = 403; cada loja vê só a sua', async () => {
    const r = await api('PATCH', `/plataforma/lojas/${ze.id}`, { token: tk.admin, corpo: { corPrimariaPadrao: '#14532D' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.loja.corPrimaria, '#14532D');
    assert.equal((await api('PATCH', `/plataforma/lojas/${ze.id}`, { token: tk.admin, corpo: { corPrimariaPadrao: '#FBF3E8' } })).status, 400);

    assert.equal((await api('GET', '/retaguarda/perfil', { token: tk.ana })).status, 403);
    assert.equal((await api('PUT', '/retaguarda/perfil/cor', { token: tk.ana, corpo: { corPrimaria: '#1E3A5F' } })).status, 403);
    const cabana = (await api('GET', '/retaguarda/perfil', { token: tk.cabana })).corpo.perfil;
    assert.equal(cabana.slug, 'cabana-boemia');
    assert.equal(cabana.corPrimaria, '#C8102E');
    assert.equal(cabana.corPrimariaPadrao, '#C8102E');
    const admZe = (await api('GET', '/retaguarda/perfil', { token: tk.admin, cabecalhos: { 'x-loja': 'lanchonete-do-ze' } })).corpo.perfil;
    assert.equal(admZe.slug, 'lanchonete-do-ze');
    assert.equal((await api('GET', '/equipe/loja', { token: tk.ana })).corpo.loja.nome, 'Cabana Boemia');
  });

  // ───────── Turnos: criar, renomear, desativar ─────────

  test('turnos: dono cria (nome repetido = 409), renomeia e desativa; desativado não abre a loja', async () => {
    const criado = await api('POST', '/retaguarda/turnos', { token: tk.ze, corpo: { nome: 'Café da manhã' } });
    assert.equal(criado.status, 201, JSON.stringify(criado.corpo));
    const turno = criado.corpo.turno;
    assert.deepEqual(turno.horarios, []);
    assert.equal(turno.ativo, true);
    assert.equal((await api('POST', '/retaguarda/turnos', { token: tk.ze, corpo: { nome: 'Café da manhã' } })).corpo.erro.codigo, 'NOME_EM_USO');
    assert.equal((await api('POST', '/retaguarda/turnos', { token: tk.ze, corpo: { nome: '  ' } })).status, 400);
    // Mesmo nome em outra loja pode.
    assert.equal((await api('POST', '/retaguarda/turnos', { token: tk.cabana, corpo: { nome: 'Café da manhã' } })).status, 201);

    await api('PUT', `/retaguarda/turnos/${turno.id}/horarios`, { token: tk.ze, corpo: { horarios: [{ diaSemana: 1, inicio: '06:00', fim: '10:00' }] } });
    assert.equal((await api('GET', '/publico/lojas')).corpo.lojas.find((l) => l.slug === 'lanchonete-do-ze').aberta, true);

    const renomeado = await api('PATCH', `/retaguarda/turnos/${turno.id}`, { token: tk.ze, corpo: { nome: 'Manhã' } });
    assert.equal(renomeado.corpo.turno.nome, 'Manhã');
    const desligado = await api('PATCH', `/retaguarda/turnos/${turno.id}`, { token: tk.ze, corpo: { ativo: false } });
    assert.equal(desligado.corpo.turno.ativo, false);
    assert.equal(desligado.corpo.turno.horarios.length, 1, 'horários guardados');
    assert.equal((await api('GET', '/publico/lojas')).corpo.lojas.find((l) => l.slug === 'lanchonete-do-ze').aberta, false);
    assert.equal((await api('PATCH', `/retaguarda/turnos/${turno.id}`, { token: tk.ze, corpo: {} })).status, 400);
    // De outra loja = 404.
    assert.equal((await api('PATCH', `/retaguarda/turnos/${turno.id}`, { token: tk.cabana, corpo: { ativo: true } })).status, 404);
  });

  test('turnos: reativar um turno que cruza outro ativo = 422 HORARIO_SOBREPOSTO', async () => {
    const turnos = (await api('GET', '/retaguarda/turnos', { token: tk.ze })).corpo.turnos;
    const manha = turnos.find((t) => t.nome === 'Manhã');
    const noite = turnos.find((t) => t.nome === 'Noite');
    // Com a Manhã desligada, a Noite pode ocupar o mesmo horário.
    const ok = await api('PUT', `/retaguarda/turnos/${noite.id}/horarios`, { token: tk.ze, corpo: { horarios: [{ diaSemana: 1, inicio: '08:00', fim: '12:00' }] } });
    assert.equal(ok.status, 200);
    const cruza = await api('PATCH', `/retaguarda/turnos/${manha.id}`, { token: tk.ze, corpo: { ativo: true } });
    assert.equal(cruza.status, 422);
    assert.equal(cruza.corpo.erro.codigo, 'HORARIO_SOBREPOSTO');
    await api('PUT', `/retaguarda/turnos/${noite.id}/horarios`, { token: tk.ze, corpo: { horarios: [{ diaSemana: 1, inicio: '18:00', fim: '23:00' }] } });
    const religado = await api('PATCH', `/retaguarda/turnos/${manha.id}`, { token: tk.ze, corpo: { ativo: true } });
    assert.equal(religado.status, 200);
    assert.equal(religado.corpo.turno.ativo, true);
  });
});
