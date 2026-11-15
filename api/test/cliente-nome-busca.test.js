import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { paraBusca } from '../src/lib/texto.js';
import { semBancoDeTeste, resetarBancoDeTeste, raizApi } from './helpers/banco.js';

const NOMES = [
  'João da Silva',
  '  MARÍA   Ñuñez ',
  'Conceição Araújo',
  'Zé Mané',
  'Ângela Müller',
  'Inês Côrtes',
  'Ana Lúcia',
  'Pedro',
];

describe('paraBusca (sem banco)', () => {
  test('tira acento, passa para minúsculo e normaliza os espaços', () => {
    assert.equal(paraBusca('João da Silva'), 'joao da silva');
    assert.equal(paraBusca('  MARÍA   Ñuñez '), 'maria nunez');
    assert.equal(paraBusca('Conceição Araújo'), 'conceicao araujo');
    assert.equal(paraBusca('Ângela Müller'), 'angela muller');
    assert.equal(paraBusca('joao'), 'joao');
    assert.equal(paraBusca(null), '');
  });
});

describe('Cliente.nomeBusca: preenchido em toda gravação e usado na busca do PDV', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let token;
  let centro;

  async function api(metodo, rota, corpo) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { authorization: `Bearer ${token}`, ...(corpo && { 'content-type': 'application/json' }) },
      body: corpo && JSON.stringify(corpo),
    });
    return { status: res.status, corpo: await res.json() };
  }

  const nomeBuscaDe = async (id) => (await prisma.cliente.findUnique({ where: { id } })).nomeBusca;

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    centro = await prisma.bairro.create({ data: { nome: 'Centro', taxaCentavos: 500 } });

    servidor = http.createServer(criarApp({ log: false }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ana@teste.com', senha: 'senha-da-ana' }),
    });
    token = (await login.json()).accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  test('site: login Google cria com nomeBusca; editar o nome no perfil atualiza', async () => {
    const { entrarComGoogle, atualizarPerfil } = await import('../src/services/cliente.service.js');
    const { cliente } = await entrarComGoogle({ googleId: 'g-1', email: 'j@x.com', nome: 'João Gonçalves' });
    assert.equal(await nomeBuscaDe(cliente.id), 'joao goncalves');

    await atualizarPerfil(cliente.id, { nome: 'Joãozinho Gonçalves', telefone: '43999990001' });
    assert.equal(await nomeBuscaDe(cliente.id), 'joaozinho goncalves');

    // Login de novo só atualiza o email: o nome editado (e o nomeBusca) ficam.
    await entrarComGoogle({ googleId: 'g-1', email: 'novo@x.com', nome: 'Outro Nome' });
    assert.equal(await nomeBuscaDe(cliente.id), 'joaozinho goncalves');
  });

  test('PDV: cadastro rápido grava nomeBusca', async () => {
    const r = await api('POST', '/equipe/clientes', {
      nome: 'Conceição Araújo',
      telefone: '43999990002',
      endereco: { rua: 'Rua A', numero: '1', bairroId: centro.id },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(await nomeBuscaDe(r.corpo.cliente.id), 'conceicao araujo');
  });

  test('busca do PDV: "joao" acha "João", sem acento e sem diferenciar maiúsculas', async () => {
    await api('POST', '/equipe/clientes', {
      nome: 'JOÃO PEDRO',
      telefone: '43999990003',
      endereco: { rua: 'Rua B', numero: '2', bairroId: centro.id },
    });
    const nomes = async (busca) =>
      (await api('GET', `/equipe/clientes?busca=${encodeURIComponent(busca)}`)).corpo.clientes.map((c) => c.nome);

    assert.deepEqual(await nomes('joao'), ['JOÃO PEDRO', 'Joãozinho Gonçalves']);
    assert.deepEqual(await nomes('João'), ['JOÃO PEDRO', 'Joãozinho Gonçalves']);
    assert.deepEqual(await nomes('JOAO P'), ['JOÃO PEDRO']);
    assert.deepEqual(await nomes('conceicao'), ['Conceição Araújo']);
    assert.deepEqual(await nomes('araujo'), ['Conceição Araújo']);
    assert.deepEqual(await nomes('gonçalves'), ['Joãozinho Gonçalves']);
    assert.deepEqual(await nomes('  joao   pedro '), ['JOÃO PEDRO']);
  });

  test('qualquer gravação pelo client Prisma preenche (create, update, upsert, updateMany, createMany, transação)', async () => {
    const c = await prisma.cliente.create({ data: { nome: 'Ângela Müller' } });
    assert.equal(c.nomeBusca, 'angela muller');
    assert.equal((await prisma.cliente.update({ where: { id: c.id }, data: { nome: { set: 'Inês Côrtes' } } })).nomeBusca, 'ines cortes');
    assert.equal(
      (await prisma.cliente.update({ where: { id: c.id }, data: { telefone: '43999990004' } })).nomeBusca,
      'ines cortes',
      'sem mudar o nome, nomeBusca fica',
    );

    const u = await prisma.cliente.upsert({ where: { googleId: 'g-2' }, create: { googleId: 'g-2', nome: 'Zé Mané' }, update: {} });
    assert.equal(u.nomeBusca, 'ze mane');
    await prisma.cliente.upsert({ where: { googleId: 'g-2' }, create: { googleId: 'g-2', nome: 'x' }, update: { nome: 'Zé Ruela' } });
    assert.equal(await nomeBuscaDe(u.id), 'ze ruela');

    await prisma.cliente.updateMany({ where: { id: u.id }, data: { nome: 'José Ruela' } });
    assert.equal(await nomeBuscaDe(u.id), 'jose ruela');

    await prisma.cliente.createMany({ data: [{ nome: 'Ana Lúcia' }, { nome: 'Lúcia Ana' }] });
    const criados = await prisma.cliente.findMany({ where: { nome: { in: ['Ana Lúcia', 'Lúcia Ana'] } }, orderBy: { id: 'asc' } });
    assert.deepEqual(criados.map((x) => x.nomeBusca), ['ana lucia', 'lucia ana']);

    const t = await prisma.$transaction((tx) => tx.cliente.create({ data: { nome: 'Tânia' } }));
    assert.equal(t.nomeBusca, 'tania');
  });

  test('banco: inserir sem nomeBusca falha (coluna obrigatória, sem default)', async () => {
    await assert.rejects(prisma.$executeRaw`INSERT INTO "Cliente" ("nome", "atualizadoEm") VALUES ('Sem Busca', now())`);
  });

  test('migration: o UPDATE que preenche os clientes antigos dá o mesmo resultado que paraBusca', async () => {
    const sql = fs.readFileSync(
      path.join(raizApi, 'prisma', 'migrations', '20261116000000_cliente_nome_busca', 'migration.sql'),
      'utf8',
    );
    const update = sql.match(/UPDATE "Cliente"[^;]+;/)?.[0];
    assert.ok(update, 'UPDATE não encontrado na migration');

    // Simula clientes de antes da migration (nomeBusca vazio).
    const ids = [];
    for (const nome of NOMES) {
      const [{ id }] = await prisma.$queryRaw`
        INSERT INTO "Cliente" ("nome", "nomeBusca", "atualizadoEm") VALUES (${nome}, '', now()) RETURNING id`;
      ids.push(id);
    }
    await prisma.$executeRawUnsafe(update);

    const linhas = await prisma.cliente.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    for (const l of linhas) assert.equal(l.nomeBusca, paraBusca(l.nome), l.nome);
  });
});
