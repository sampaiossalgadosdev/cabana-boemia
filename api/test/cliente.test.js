import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';

/**
 * ID tokens do Google são simulados com uma chave RSA gerada aqui: o
 * verificador real (google-auth-library) recebe a chave pública desta chave
 * no lugar das do Google. Assim a assinatura, o emissor, o audience e a
 * validade são conferidos de verdade, sem rede.
 */
const CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
const KID = 'kid-teste';
const chaveGoogle = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chaveIntrusa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });

function idTokenGoogle(campos = {}, { chave = chaveGoogle, expiresIn = '1h' } = {}) {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-123',
      email: 'Maria@Gmail.com',
      email_verified: true,
      name: 'Maria Silva',
      ...campos,
    },
    chave.privateKey,
    { algorithm: 'RS256', keyid: KID, ...(expiresIn && { expiresIn }) },
  );
}

describe('cliente do site: login Google, perfil e endereços', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let criarVerificadorGoogle;
  let tokenDono;
  let centro;
  let vilaNova;
  let desativado;
  let foraDaArea;

  async function api(metodo, rota, { corpo, token, url = base } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${url}${rota}`, {
      method: metodo,
      headers,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, headers: res.headers, corpo: texto ? JSON.parse(texto) : null };
  }

  const entrar = (credential) => api('POST', '/cliente/auth/google', { corpo: { credential } });

  /** Cliente novo (sub único) já logado. */
  let seq = 0;
  async function novoCliente(campos = {}) {
    seq += 1;
    const r = await entrar(idTokenGoogle({ sub: `google-novo-${seq}`, ...campos }));
    assert.equal(r.status, 200);
    return r.corpo;
  }

  const ouvir = (app) =>
    new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    ({ criarVerificadorGoogle } = await import('../src/lib/google.js'));
    const { criarApp } = await import('../src/app.js');
    const { criarDono } = await import('../src/services/usuario.service.js');

    await criarDono({ nome: 'Dono', email: 'dono@teste.com', senha: 'senha-do-dono' });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    vilaNova = await criarBairro(prisma, { nome: 'Vila Nova', taxaCentavos: 700 });
    desativado = await criarBairro(prisma, { nome: 'Sítio', taxaCentavos: 1500, ativoNaCidade: false });
    foraDaArea = await criarBairro(prisma, { nome: 'Longe', taxaCentavos: 2000, ativo: false });

    const verificarIdTokenGoogle = criarVerificadorGoogle({
      clientId: CLIENT_ID,
      obterCertificados: async () => ({ [KID]: pem(chaveGoogle) }),
    });
    servidor = await ouvir(criarApp({ log: false, verificarIdTokenGoogle }));
    base = `http://127.0.0.1:${servidor.address().port}/api`;

    const login = await api('POST', '/auth/login', {
      corpo: { email: 'dono@teste.com', senha: 'senha-do-dono' },
    });
    tokenDono = login.corpo.accessToken;
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve));
    await prisma?.$disconnect();
  });

  // ───────── Login com Google ─────────

  test('ID token válido cria o cliente (sem telefone) e devolve o JWT de cliente', async () => {
    const r = await entrar(idTokenGoogle());
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual({ ...r.corpo.cliente, id: undefined }, {
      id: undefined,
      nome: 'Maria Silva',
      email: 'maria@gmail.com',
      telefone: null,
      precisaTelefone: true,
      // campos do app (o site ignora): telefone não verificado, nome do Google,
      // termos ainda não aceitos, marketing desligado
      telefoneVerificado: false,
      precisaNome: false,
      termosVersao: null,
      precisaAceite: true,
      marketing: false,
    });
    const payload = jwt.decode(r.corpo.token);
    assert.equal(payload.aud, 'cliente');
    assert.equal(payload.sub, String(r.corpo.cliente.id));
    assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);

    const banco = await prisma.cliente.findUnique({ where: { googleId: 'google-123' } });
    assert.equal(banco.id, r.corpo.cliente.id);
  });

  test('entrar de novo com a mesma conta não duplica o cliente nem sobrescreve o nome editado', async () => {
    const { token, cliente } = (await entrar(idTokenGoogle())).corpo;
    await api('PUT', '/cliente/me', { token, corpo: { nome: 'Maria do Bar', telefone: '43999990000' } });

    const r = await entrar(idTokenGoogle({ email: 'maria.nova@gmail.com' }));
    assert.equal(r.status, 200);
    assert.equal(r.corpo.cliente.id, cliente.id);
    assert.equal(r.corpo.cliente.nome, 'Maria do Bar');
    assert.equal(r.corpo.cliente.email, 'maria.nova@gmail.com');
    assert.equal(r.corpo.cliente.precisaTelefone, false);
    assert.equal(await prisma.cliente.count({ where: { googleId: 'google-123' } }), 1);
  });

  test('email não verificado pelo Google não é gravado', async () => {
    const { cliente } = await novoCliente({ email: 'falso@exemplo.com', email_verified: false });
    assert.equal(cliente.email, null);
  });

  const tokensInvalidos = {
    'texto qualquer': () => 'nao-e-um-jwt',
    'assinado por outra chave': () => idTokenGoogle({}, { chave: chaveIntrusa }),
    'audience de outro app': () => idTokenGoogle({ aud: 'outro-app.apps.googleusercontent.com' }),
    'emissor que não é o Google': () => idTokenGoogle({ iss: 'https://evil.example.com' }),
    expirado: () => {
      const agora = Math.floor(Date.now() / 1000);
      return idTokenGoogle({ iat: agora - 7200, exp: agora - 3600 }, { expiresIn: null });
    },
    'payload alterado depois de assinado': () => {
      const [h, , s] = idTokenGoogle().split('.');
      const p = Buffer.from(JSON.stringify({ sub: 'outra-pessoa', aud: CLIENT_ID })).toString('base64url');
      return `${h}.${p}.${s}`;
    },
  };
  for (const [caso, gerar] of Object.entries(tokensInvalidos)) {
    test(`ID token inválido (${caso}) responde 401 e não cria cliente`, async () => {
      const antes = await prisma.cliente.count();
      const r = await entrar(gerar());
      assert.equal(r.status, 401);
      assert.equal(r.corpo.erro.codigo, 'TOKEN_GOOGLE_INVALIDO');
      assert.equal(await prisma.cliente.count(), antes);
    });
  }

  test('sem credential responde 400', async () => {
    const r = await api('POST', '/cliente/auth/google', { corpo: {} });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'VALIDACAO');
  });

  test('verificador sem GOOGLE_CLIENT_ID recusa (503) em vez de pular a checagem de audience', async () => {
    const verificar = criarVerificadorGoogle({
      clientId: '',
      obterCertificados: async () => ({ [KID]: pem(chaveGoogle) }),
    });
    await assert.rejects(verificar(idTokenGoogle()), { status: 503, codigo: 'GOOGLE_NAO_CONFIGURADO' });
  });

  test('falha ao baixar as chaves do Google responde 503', async () => {
    const verificar = criarVerificadorGoogle({
      clientId: CLIENT_ID,
      obterCertificados: async () => {
        throw new Error('rede fora');
      },
    });
    await assert.rejects(verificar(idTokenGoogle()), { status: 503, codigo: 'GOOGLE_INDISPONIVEL' });
  });

  // ───────── Perfil ─────────

  test('GET /cliente/me sem token ou com token inválido responde 401', async () => {
    assert.equal((await api('GET', '/cliente/me')).status, 401);
    assert.equal((await api('GET', '/cliente/me', { token: 'abc.def.ghi' })).status, 401);
  });

  test('GET /cliente/me devolve o cliente logado', async () => {
    const { token, cliente } = await novoCliente();
    const r = await api('GET', '/cliente/me', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.cliente, cliente);
  });

  test('PUT /cliente/me salva o telefone só com números', async () => {
    const { token } = await novoCliente();
    for (const [entrada, salvo] of [
      ['(43) 99999-0000', '43999990000'],
      ['+55 43 98888-7777', '43988887777'],
      ['043 97777-6666', '43977776666'],
    ]) {
      const r = await api('PUT', '/cliente/me', { token, corpo: { nome: ' Ana ', telefone: entrada } });
      assert.equal(r.status, 200, entrada);
      assert.equal(r.corpo.cliente.telefone, salvo, entrada);
      assert.equal(r.corpo.cliente.nome, 'Ana');
      assert.equal(r.corpo.cliente.precisaTelefone, false);
    }
  });

  test('PUT /cliente/me recusa telefone fora do formato DDD + 9 dígitos', async () => {
    const { token } = await novoCliente();
    for (const telefone of [
      '4399999000', // 10 dígitos
      '(43) 3555-0000', // fixo
      '(43) 89999-0000', // celular sem o 9
      '(20) 99999-0000', // DDD inexistente
      '(43) 99999-00001', // 12 dígitos
      '',
    ]) {
      const r = await api('PUT', '/cliente/me', { token, corpo: { nome: 'Ana', telefone } });
      assert.equal(r.status, 400, telefone);
      assert.equal(r.corpo.erro.detalhes[0].campo, 'telefone', telefone);
    }
    const semNome = await api('PUT', '/cliente/me', { token, corpo: { nome: '  ', telefone: '43999990000' } });
    assert.equal(semNome.status, 400);
    assert.equal((await api('GET', '/cliente/me', { token })).corpo.cliente.telefone, null);
  });

  test('cliente novo sem telefone não consegue criar pedido (TELEFONE_OBRIGATORIO); com telefone passa', async () => {
    // A rota de pedido ainda não existe: monta o mesmo guard que ela vai usar.
    const { autenticarCliente, exigirTelefoneCliente } = await import('../src/middlewares/autenticarCliente.js');
    const { tratarErro } = await import('../src/middlewares/erro.js');
    const app = express();
    app.post('/pedidos', autenticarCliente, exigirTelefoneCliente, (req, res) => res.status(201).json({ ok: true }));
    app.use(tratarErro);
    const s = await ouvir(app);
    const url = `http://127.0.0.1:${s.address().port}`;
    try {
      const { token } = await novoCliente();
      const bloqueado = await api('POST', '/pedidos', { token, url });
      assert.equal(bloqueado.status, 422);
      assert.equal(bloqueado.corpo.erro.codigo, 'TELEFONE_OBRIGATORIO');

      await api('PUT', '/cliente/me', { token, corpo: { nome: 'Ana', telefone: '43999990000' } });
      assert.equal((await api('POST', '/pedidos', { token, url })).status, 201);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });

  // ───────── Isolamento entre JWT de cliente e da equipe ─────────

  test('JWT de cliente não acessa rotas da equipe', async () => {
    const { token } = await novoCliente();
    for (const rota of ['/auth/me', '/usuarios']) {
      const r = await api('GET', rota, { token });
      assert.equal(r.status, 401, rota);
      assert.equal(r.corpo.erro.codigo, 'TOKEN_INVALIDO', rota);
    }
  });

  test('JWT da equipe não acessa rotas do cliente', async () => {
    assert.equal((await api('GET', '/auth/me', { token: tokenDono })).status, 200);
    for (const [metodo, rota] of [
      ['GET', '/cliente/me'],
      ['GET', '/cliente/enderecos'],
    ]) {
      const r = await api(metodo, rota, { token: tokenDono });
      assert.equal(r.status, 401, rota);
      assert.equal(r.corpo.erro.codigo, 'TOKEN_INVALIDO', rota);
    }
  });

  test('audience também separa: token com o segredo da equipe mas sem aud "equipe" é recusado', async () => {
    const dono = await prisma.usuario.findUnique({ where: { email: 'dono@teste.com' } });
    const opcoes = { algorithm: 'HS256', subject: String(dono.id), expiresIn: 60 };
    const semAud = jwt.sign({ papel: 'DONO' }, process.env.JWT_SECRET, opcoes);
    const audCliente = jwt.sign({ papel: 'DONO' }, process.env.JWT_SECRET, { ...opcoes, audience: 'cliente' });
    assert.equal((await api('GET', '/usuarios', { token: semAud })).status, 401);
    assert.equal((await api('GET', '/usuarios', { token: audCliente })).status, 401);

    const clienteSemAud = jwt.sign({}, process.env.JWT_CLIENTE_SECRET, opcoes);
    assert.equal((await api('GET', '/cliente/me', { token: clienteSemAud })).status, 401);
  });

  // ───────── Endereços ─────────

  const endereco = (campos = {}) => ({ rua: 'Rua das Flores', numero: '120', bairroId: centro.id, ...campos });

  test('POST /cliente/enderecos: o primeiro vira principal; marcar outro como principal desmarca o anterior', async () => {
    const { token } = await novoCliente();
    const a = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ complemento: '', referencia: ' Perto da praça ' }) });
    assert.equal(a.status, 201);
    assert.equal(a.corpo.endereco.principal, true);
    assert.equal(a.corpo.endereco.complemento, null);
    assert.equal(a.corpo.endereco.referencia, 'Perto da praça');
    assert.deepEqual(a.corpo.endereco.bairro, { id: centro.id, nome: 'Centro', taxaCentavos: 500, ativo: true });

    const b = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: '7', bairroId: vilaNova.id }) });
    assert.equal(b.corpo.endereco.principal, false);

    const c = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: '9', principal: true }) });
    assert.equal(c.corpo.endereco.principal, true);

    const lista = (await api('GET', '/cliente/enderecos', { token })).corpo.enderecos;
    assert.equal(lista.length, 3);
    assert.equal(lista[0].id, c.corpo.endereco.id, 'principal vem primeiro');
    assert.equal(lista.filter((e) => e.principal).length, 1);
  });

  test('PUT /cliente/enderecos/:id altera os dados e pode tornar principal', async () => {
    const { token } = await novoCliente();
    const a = (await api('POST', '/cliente/enderecos', { token, corpo: endereco() })).corpo.endereco;
    const b = (await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: '2' }) })).corpo.endereco;

    const r = await api('PUT', `/cliente/enderecos/${b.id}`, {
      token,
      corpo: endereco({ rua: 'Av. Brasil', numero: '50', bairroId: vilaNova.id, principal: true }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.endereco.rua, 'Av. Brasil');
    assert.equal(r.corpo.endereco.bairro.nome, 'Vila Nova');
    assert.equal(r.corpo.endereco.principal, true);

    const lista = (await api('GET', '/cliente/enderecos', { token })).corpo.enderecos;
    assert.deepEqual(lista.map((e) => [e.id, e.principal]), [[b.id, true], [a.id, false]]);
  });

  test('DELETE /cliente/enderecos/:id: apagar o principal promove o mais recente', async () => {
    const { token } = await novoCliente();
    const a = (await api('POST', '/cliente/enderecos', { token, corpo: endereco() })).corpo.endereco;
    const b = (await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: '2' }) })).corpo.endereco;

    assert.equal((await api('DELETE', `/cliente/enderecos/${a.id}`, { token })).status, 204);
    const lista = (await api('GET', '/cliente/enderecos', { token })).corpo.enderecos;
    assert.deepEqual(lista.map((e) => [e.id, e.principal]), [[b.id, true]]);
  });

  test('bairro inexistente ou desativado NA CIDADE responde 422 BAIRRO_INVALIDO', async () => {
    const { token } = await novoCliente();
    for (const bairroId of [desativado.id, 999999]) {
      const r = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ bairroId }) });
      assert.equal(r.status, 422, String(bairroId));
      assert.equal(r.corpo.erro.codigo, 'BAIRRO_INVALIDO');
    }
  });

  test('endereço vale para qualquer loja: bairro fora da área da loja é aceito e aparece como "não entregamos"', async () => {
    const { token } = await novoCliente();
    const r = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ bairroId: foraDaArea.id }) });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.deepEqual(r.corpo.endereco.bairro, { id: foraDaArea.id, nome: 'Longe', taxaCentavos: null, ativo: false });
    const lista = (await api('GET', '/cliente/enderecos', { token })).corpo.enderecos;
    assert.equal(lista.find((e) => e.id === r.corpo.endereco.id).bairro.ativo, false);
    // Bairro da área: a taxa da loja, como sempre.
    const centroEnd = await api('POST', '/cliente/enderecos', { token, corpo: endereco() });
    assert.deepEqual(centroEnd.corpo.endereco.bairro, { id: centro.id, nome: 'Centro', taxaCentavos: 500, ativo: true });
  });

  test('endereço sem rua, número ou bairro responde 400', async () => {
    const { token } = await novoCliente();
    for (const corpo of [endereco({ rua: ' ' }), endereco({ numero: undefined }), endereco({ bairroId: '1' })]) {
      assert.equal((await api('POST', '/cliente/enderecos', { token, corpo })).status, 400);
    }
  });

  test('cliente não vê, altera nem apaga endereço de outro cliente (404)', async () => {
    const dono = await novoCliente();
    const outro = await novoCliente();
    const e = (await api('POST', '/cliente/enderecos', { token: dono.token, corpo: endereco() })).corpo.endereco;

    assert.deepEqual((await api('GET', '/cliente/enderecos', { token: outro.token })).corpo.enderecos, []);
    assert.equal((await api('PUT', `/cliente/enderecos/${e.id}`, { token: outro.token, corpo: endereco() })).status, 404);
    assert.equal((await api('DELETE', `/cliente/enderecos/${e.id}`, { token: outro.token })).status, 404);
    assert.equal((await api('GET', '/cliente/enderecos', { token: dono.token })).corpo.enderecos.length, 1);
  });

  test('limite de 10 endereços por cliente', async () => {
    const { token } = await novoCliente();
    for (let i = 0; i < 10; i++) {
      assert.equal((await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: String(i) }) })).status, 201);
    }
    const r = await api('POST', '/cliente/enderecos', { token, corpo: endereco({ numero: '11' }) });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'LIMITE_ENDERECOS');
  });
});
