import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import { semBancoDeTeste, resetarBancoDeTeste, raizApi } from './helpers/banco.js';
import {
  criarVerificadorTelefone,
  criarVerificadorTeste,
  ehProducao,
  lerNumerosDeTeste,
  problemasNoVerificador,
  telefoneE164,
  verificadorDesligado,
} from '../src/lib/verificadorTelefone.js';
import { DOCUMENTOS_APP } from '../src/lib/controlador.js';

/**
 * Login com celular (modo teste): verificador plugável, trava de produção,
 * POST /cliente/auth/telefone/enviar e /entrar, limites, conta existente e
 * a regra "telefone verificado é único". Números fictícios.
 */
const LISTA = '+5543999990001:123456, +5543999990002:654321,+5543999990003:111111,+5543999990004:222222,+5543999990005:333333';

// ───────────── Sem banco: regras puras ─────────────

test('telefoneE164: só celular do Brasil, sempre +55 + DDD + 9 dígitos', () => {
  for (const v of ['(43) 99999-0001', '43999990001', '+55 43 99999-0001', '5543999990001', '043999990001']) {
    assert.equal(telefoneE164(v), '+5543999990001', v);
  }
  // fixo, sem DDD, DDD que não existe, outro país, curto, lixo
  for (const v of ['(43) 3333-1234', '999990001', '(20) 99999-0001', '+1 555 123 4567', '123', '', 'abc', null, 12345]) {
    assert.equal(telefoneE164(v), null, String(v));
  }
});

test('PHONE_TEST_NUMBERS: lê os pares e aponta entradas inválidas', () => {
  const { numeros, problemas } = lerNumerosDeTeste(LISTA);
  assert.deepEqual(problemas, []);
  assert.equal(numeros.size, 5);
  assert.equal(numeros.get('+5543999990002'), '654321');

  assert.match(lerNumerosDeTeste('43999990001:123456').problemas[0], /não é um celular/, 'sem +55');
  assert.match(lerNumerosDeTeste('+5543333312345:123456').problemas[0], /não é um celular/, 'fixo');
  assert.match(lerNumerosDeTeste('+5543999990001:12345').problemas[0], /6 números/);
  assert.match(lerNumerosDeTeste('+5543999990001').problemas[0], /6 números/);
  assert.deepEqual(lerNumerosDeTeste('').numeros.size, 0);
});

test('trava: PHONE_VERIFIER=test é recusado em produção (NODE_ENV ou ambiente do Railway)', () => {
  const teste = { PHONE_VERIFIER: 'test', PHONE_TEST_NUMBERS: LISTA };
  assert.deepEqual(problemasNoVerificador({}), [], 'sem verificador: desligado, sobe');
  assert.deepEqual(problemasNoVerificador(teste), [], 'test em dev: sobe');
  assert.match(problemasNoVerificador({ ...teste, NODE_ENV: 'production' })[0], /só para desenvolvimento/);
  assert.match(problemasNoVerificador({ ...teste, RAILWAY_ENVIRONMENT_NAME: 'production' })[0], /só para desenvolvimento/);
  assert.deepEqual(problemasNoVerificador({ NODE_ENV: 'production' }), [], 'produção sem verificador: sobe (login com celular desligado)');
  // liberação explícita da fase de testes: só "sim" vale
  assert.deepEqual(problemasNoVerificador({ ...teste, NODE_ENV: 'production', PHONE_TEST_EM_PRODUCAO: 'sim' }), []);
  assert.deepEqual(problemasNoVerificador({ ...teste, RAILWAY_ENVIRONMENT_NAME: 'production', PHONE_TEST_EM_PRODUCAO: ' SIM ' }), []);
  for (const v of ['', 'true', '1', 'nao']) {
    assert.equal(problemasNoVerificador({ ...teste, NODE_ENV: 'production', PHONE_TEST_EM_PRODUCAO: v }).length, 1, v);
  }
  assert.equal(criarVerificadorTelefone({ ...teste, NODE_ENV: 'production', PHONE_TEST_EM_PRODUCAO: 'sim' }).nome, 'test');
  assert.match(problemasNoVerificador({ PHONE_VERIFIER: 'firebase' })[0], /não existe/);
  assert.match(problemasNoVerificador({ PHONE_VERIFIER: 'test' })[0], /sem números/);
  assert.equal(ehProducao({ NODE_ENV: 'development' }), false);
  assert.equal(criarVerificadorTelefone({ ...teste, NODE_ENV: 'production' }), verificadorDesligado, 'nunca cai no de teste em produção');
  assert.equal(criarVerificadorTelefone(teste).nome, 'test');
  assert.equal(criarVerificadorTelefone({}).nome, 'desligado');
});

test('verificador de teste: só os números da lista, cada um com o seu código', async () => {
  const v = criarVerificadorTeste(lerNumerosDeTeste(LISTA).numeros);
  await v.enviarCodigo('+5543999990001');
  await assert.rejects(v.enviarCodigo('+5543988887777'), { status: 503, codigo: 'SMS_INDISPONIVEL', message: /SMS ainda não disponível/ });
  assert.equal(await v.conferirCodigo('+5543999990001', '123456'), true);
  assert.equal(await v.conferirCodigo('+5543999990001', '654321'), false, 'código de outro número');
  assert.equal(await v.conferirCodigo('+5543988887777', '123456'), false, 'número fora da lista');
  await assert.rejects(verificadorDesligado.enviarCodigo('+5543999990001'), { codigo: 'SMS_INDISPONIVEL' });
  await assert.rejects(verificadorDesligado.conferirCodigo('+5543999990001', '123456'), { codigo: 'SMS_INDISPONIVEL' });
});

/** Roda o server.js com o ambiente dado; mata após 10 s se não sair sozinho. */
function rodarServidor(envExtra) {
  const env = { ...process.env, PORT: '0', ...envExtra };
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(raizApi, 'src', 'server.js')], { env });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    const timer = setTimeout(() => filho.kill(), 10_000);
    filho.on('exit', (codigo) => {
      clearTimeout(timer);
      resolve({ codigo, saida });
    });
  });
}

test('server.js não sobe em produção com PHONE_VERIFIER=test: sai com código 1 e explica', async () => {
  for (const producao of [{ NODE_ENV: 'production' }, { RAILWAY_ENVIRONMENT_NAME: 'production' }]) {
    const { codigo, saida } = await rodarServidor({ ...producao, PHONE_VERIFIER: 'test', PHONE_TEST_NUMBERS: LISTA });
    assert.equal(codigo, 1, JSON.stringify(producao));
    assert.match(saida, /A API não vai iniciar \(login com celular\)/);
    assert.match(saida, /PHONE_VERIFIER=test é só para desenvolvimento/);
    assert.doesNotMatch(saida, /API ouvindo/);
  }
});

test('server.js sobe em produção com PHONE_VERIFIER=test só com PHONE_TEST_EM_PRODUCAO=sim, e avisa', async () => {
  const { codigo, saida } = await rodarServidorAteOuvir({
    NODE_ENV: 'production',
    PHONE_VERIFIER: 'test',
    PHONE_TEST_NUMBERS: LISTA,
    PHONE_TEST_EM_PRODUCAO: 'sim',
  });
  assert.notEqual(codigo, 1, saida);
  assert.match(saida, /modo TESTE EM PRODUÇÃO/);
  assert.match(saida, /API ouvindo/);
});

/** Roda o server.js até ele dizer que está ouvindo (ou sair) e encerra. */
function rodarServidorAteOuvir(envExtra) {
  const env = { ...process.env, PORT: '0', ...envExtra };
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [path.join(raizApi, 'src', 'server.js')], { env });
    let saida = '';
    let codigo = null;
    const fim = () => {
      clearTimeout(timer);
      filho.kill();
    };
    const ler = (d) => {
      saida += d;
      if (/API ouvindo/.test(saida)) fim();
    };
    filho.stdout.on('data', ler);
    filho.stderr.on('data', ler);
    const timer = setTimeout(fim, 15_000);
    filho.on('exit', (c) => {
      codigo = c;
      resolve({ codigo, saida });
    });
  });
}

// ───────────── Com banco: rotas ─────────────

describe('login com celular: /cliente/auth/telefone/*', { skip: semBancoDeTeste }, () => {
  let prisma;
  const servidores = [];
  let base;

  async function api(metodo, rota, { corpo, token, url = base } = {}) {
    const headers = {};
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${url}${rota}`, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  const enviar = (telefone, url) => api('POST', '/cliente/auth/telefone/enviar', { corpo: { telefone }, url });
  const entrar = (telefone, codigo, extra = {}, url) =>
    api('POST', '/cliente/auth/telefone/entrar', { corpo: { telefone, codigo, refresh: true, ...extra }, url });

  const REENVIO_MS = 400;
  async function subir(opcoes) {
    const { criarApp } = await import('../src/app.js');
    const s = await new Promise((resolve) => {
      const srv = criarApp({ log: false, limiteAuthCliente: 1000, ...opcoes }).listen(0, () => resolve(srv));
    });
    servidores.push(s);
    return `http://127.0.0.1:${s.address().port}/api`;
  }

  before(async () => {
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    base = await subir({
      verificadorTelefone: criarVerificadorTeste(lerNumerosDeTeste(LISTA).numeros),
      // limite por IP alto aqui: ele tem o próprio teste, numa instância separada
      limitesTelefone: { reenvioMs: REENVIO_MS, enviosPorIp: 1000 },
    });
  });

  after(async () => {
    await Promise.all(servidores.map((s) => new Promise((r) => s.close(r))));
    await prisma?.$disconnect();
  });

  test('número de teste + código certo: entra, conta nova com o telefone verificado e sem nome', async () => {
    assert.deepEqual((await enviar('(43) 99999-0001')).corpo, { enviado: true, telefone: '+5543999990001', reenviarEmSegundos: 60 });

    const r = await entrar('(43) 99999-0001', '123456');
    assert.equal(r.status, 200);
    assert.ok(r.corpo.token);
    assert.ok(r.corpo.refreshToken, 'o app pede o refresh e recebe');
    assert.equal(r.corpo.cliente.telefone, '43999990001', 'banco guarda só os 11 dígitos, como sempre');
    assert.equal(r.corpo.cliente.telefoneVerificado, true);
    assert.equal(r.corpo.cliente.precisaNome, true);
    assert.equal(r.corpo.cliente.precisaTelefone, false);
    assert.equal(r.corpo.cliente.precisaAceite, true, 'sem aceite no login: o app pede depois');

    const banco = await prisma.cliente.findUnique({ where: { id: r.corpo.cliente.id } });
    assert.equal(banco.telefoneVerificado, true);
    assert.ok(banco.telefoneVerificadoEm instanceof Date);
    assert.equal(await prisma.registroAcesso.count({ where: { clienteId: banco.id, evento: 'LOGIN' } }), 1);

    // mesma sessão do login atual: /me funciona e o refresh gira
    assert.equal((await api('GET', '/cliente/me', { token: r.corpo.token })).corpo.cliente.id, banco.id);
    const ren = await api('POST', '/cliente/auth/renovar', { corpo: { refreshToken: r.corpo.refreshToken } });
    assert.equal(ren.status, 200);
    assert.notEqual(ren.corpo.refreshToken, r.corpo.refreshToken);
    assert.equal((await api('POST', '/cliente/auth/renovar', { corpo: { refreshToken: r.corpo.refreshToken } })).corpo.erro.codigo, 'REFRESH_REUTILIZADO');
  });

  test('sair e entrar de novo com o mesmo número: a mesma conta', async () => {
    const primeiro = await entrar('43999990001', '123456');
    assert.equal((await api('POST', '/cliente/auth/sair', { corpo: { refreshToken: primeiro.corpo.refreshToken } })).status, 204);
    const segundo = await entrar('+55 43 99999-0001', '123456');
    assert.equal(segundo.corpo.cliente.id, primeiro.corpo.cliente.id);
    assert.equal(await prisma.cliente.count({ where: { telefone: '43999990001' } }), 1);
  });

  test('aceite no login vale igual ao do Google: grava a versão e o histórico', async () => {
    const r = await entrar('43999990003', '111111', { aceite: DOCUMENTOS_APP.versao });
    assert.equal(r.corpo.cliente.precisaAceite, false);
    assert.equal(r.corpo.cliente.termosVersao, DOCUMENTOS_APP.versao);
    assert.equal(await prisma.consentimento.count({ where: { clienteId: r.corpo.cliente.id, tipo: 'TERMOS' } }), 1);
    // versão antiga marcada na tela = ignorada (o app pede o aceite de novo)
    const velho = await entrar('43999990004', '222222', { aceite: '2000-01-01' });
    assert.equal(velho.corpo.cliente.precisaAceite, true);
  });

  test('sem refresh (como o site): só { token, cliente }', async () => {
    const r = await api('POST', '/cliente/auth/telefone/entrar', { corpo: { telefone: '43999990001', codigo: '123456' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.refreshToken, undefined);
  });

  test('código errado ou mal digitado: recusa sem criar conta', async () => {
    const r = await entrar('43999990005', '000000');
    assert.equal(r.status, 401);
    assert.equal(r.corpo.erro.codigo, 'CODIGO_INVALIDO');
    assert.match(r.corpo.erro.mensagem, /Código errado/);
    assert.equal((await entrar('43999990005', '12345')).status, 400, 'menos de 6 números');
    assert.equal((await entrar('43999990005', 'abcdef')).status, 400);
    assert.equal((await entrar('43999990002', '123456')).corpo.erro.codigo, 'CODIGO_INVALIDO', 'código de outro número');
    assert.equal(await prisma.cliente.count({ where: { telefone: { in: ['43999990005', '43999990002'] } } }), 0);
  });

  test('número fora da lista: erro claro de verificação indisponível; formato inválido: 400', async () => {
    const fora = await enviar('(43) 98888-7777');
    assert.equal(fora.status, 503);
    assert.equal(fora.corpo.erro.codigo, 'SMS_INDISPONIVEL');
    assert.match(fora.corpo.erro.mensagem, /verificação por SMS ainda não disponível/i);
    // falha não gasta o limite do número: repetir na hora dá o mesmo erro, não "aguarde"
    assert.equal((await enviar('(43) 98888-7777')).corpo.erro.codigo, 'SMS_INDISPONIVEL');
    assert.equal((await entrar('43988887777', '123456')).corpo.erro.codigo, 'CODIGO_INVALIDO');

    for (const t of ['(43) 3333-1234', '+1 555 123 4567', '999990001', 'abc']) {
      const r = await enviar(t);
      assert.equal(r.status, 400, t);
      assert.equal(r.corpo.erro.codigo, 'TELEFONE_INVALIDO', t);
    }
    assert.equal((await api('POST', '/cliente/auth/telefone/enviar', { corpo: {} })).status, 400);
    assert.equal((await entrar('(43) 3333-1234', '123456')).corpo.erro.codigo, 'TELEFONE_INVALIDO');
  });

  test('limites de reenvio: 1 código a cada janela de reenvio e no máximo 3 por hora', async () => {
    const tel = '43999990002';
    assert.equal((await enviar(tel)).status, 200);
    const cedo = await enviar('(43) 99999-0002'); // mesmo número em outro formato
    assert.equal(cedo.status, 429);
    assert.equal(cedo.corpo.erro.codigo, 'AGUARDE_REENVIO');
    assert.ok(cedo.corpo.erro.detalhes.segundos >= 1);

    await esperar(REENVIO_MS + 100);
    const seg = await enviar(tel);
    assert.equal(seg.status, 200, '2º depois da janela: ' + JSON.stringify(seg.corpo));
    await esperar(REENVIO_MS + 100);
    assert.equal((await enviar(tel)).status, 200, '3º depois da janela');
    await esperar(REENVIO_MS + 100);
    const quarto = await enviar(tel);
    assert.equal(quarto.status, 429);
    assert.equal(quarto.corpo.erro.codigo, 'MUITOS_ENVIOS');
    assert.ok(quarto.corpo.erro.detalhes.segundos > 60, 'só daqui a quase uma hora');

    // outro número não é afetado
    assert.equal((await enviar('43999990003')).status, 200);
  });

  test('limite por IP: pedidos de código de números diferentes a partir da mesma rede', async () => {
    const url = await subir({
      verificadorTelefone: criarVerificadorTeste(lerNumerosDeTeste(LISTA).numeros),
      limitesTelefone: { enviosPorIp: 2 },
    });
    assert.equal((await enviar('43999990001', url)).status, 200);
    assert.equal((await enviar('43999990002', url)).status, 200);
    const r = await enviar('43999990003', url);
    assert.equal(r.status, 429);
    assert.equal(r.corpo.erro.codigo, 'MUITAS_TENTATIVAS');
  });

  test('5 códigos errados no mesmo número: bloqueia, mesmo com o código certo depois', async () => {
    const url = await subir({ verificadorTelefone: criarVerificadorTeste(lerNumerosDeTeste(LISTA).numeros) });
    for (let i = 0; i < 5; i += 1) assert.equal((await entrar('43999990004', '999999', {}, url)).status, 401);
    const r = await entrar('43999990004', '222222', {}, url);
    assert.equal(r.status, 429);
    assert.equal(r.corpo.erro.codigo, 'MUITAS_TENTATIVAS');
    assert.equal((await entrar('43999990003', '111111', {}, url)).status, 200, 'outro número segue');
  });

  test('telefone já existente (cadastro do PDV): entra na mesma conta, que passa a verificada', async () => {
    const pdv = await prisma.cliente.create({ data: { nome: 'Carlos do Balcão', telefone: '43999990005' } });
    // outro cadastro com o mesmo telefone, mais novo (ex.: site), não verificado
    const site = await prisma.cliente.create({ data: { nome: 'Carlos Google', googleId: 'g-carlos', telefone: '43999990005' } });

    const r = await entrar('43999990005', '333333');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.cliente.id, pdv.id, 'a mais antiga com o telefone');
    assert.equal(r.corpo.cliente.nome, 'Carlos do Balcão');
    assert.equal(r.corpo.cliente.precisaNome, false);
    assert.equal(r.corpo.cliente.telefoneVerificado, true);
    assert.equal((await prisma.cliente.findUnique({ where: { id: site.id } })).telefoneVerificado, false);

    // de novo: a verificada, sempre a mesma
    assert.equal((await entrar('43999990005', '333333')).corpo.cliente.id, pdv.id);
  });

  test('telefone verificado é único no banco; não verificado pode repetir', async () => {
    await assert.rejects(
      prisma.cliente.create({
        data: { nome: 'Intruso', telefone: '43999990005', telefoneVerificado: true, telefoneVerificadoEm: new Date() },
      }),
      { code: 'P2002' },
    );
    await prisma.cliente.create({ data: { nome: 'Outro do PDV', telefone: '43999990005' } });
    // CHECK: verificado sem data (ou sem telefone) não entra
    await assert.rejects(prisma.cliente.create({ data: { nome: 'X', telefone: '43911112222', telefoneVerificado: true } }));
  });

  test('dois logins do mesmo número novo ao mesmo tempo: uma conta só', async () => {
    const url = await subir({ verificadorTelefone: criarVerificadorTeste(lerNumerosDeTeste('+5543999998888:444444').numeros) });
    const rs = await Promise.all([1, 2, 3].map(() => entrar('43999998888', '444444', {}, url)));
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    assert.equal(new Set(rs.map((r) => r.corpo.cliente.id)).size, 1);
    assert.equal(await prisma.cliente.count({ where: { telefone: '43999998888' } }), 1);
  });

  test('conta sem nome não pede; trocar o telefone no Perfil desfaz a verificação', async () => {
    const r = await entrar('43999990004', '222222');
    const token = r.corpo.token;
    const pedido = await api('POST', '/cliente/pedidos', { token, corpo: {} });
    assert.equal(pedido.status, 422);
    assert.equal(pedido.corpo.erro.codigo, 'NOME_OBRIGATORIO');

    const mesmo = await api('PUT', '/cliente/me', { token, corpo: { nome: 'Bia', telefone: '(43) 99999-0004' } });
    assert.equal(mesmo.corpo.cliente.telefoneVerificado, true, 'só o nome mudou');
    assert.equal(mesmo.corpo.cliente.precisaNome, false);

    const outro = await api('PUT', '/cliente/me', { token, corpo: { nome: 'Bia', telefone: '(43) 97777-6666' } });
    assert.equal(outro.corpo.cliente.telefoneVerificado, false);
    const banco = await prisma.cliente.findUnique({ where: { id: r.corpo.cliente.id } });
    assert.equal(banco.telefoneVerificadoEm, null);
  });

  test('verificador desligado (PHONE_VERIFIER vazio): enviar e entrar respondem indisponível', async () => {
    const url = await subir({ verificadorTelefone: verificadorDesligado });
    assert.equal((await enviar('43999990001', url)).corpo.erro.codigo, 'SMS_INDISPONIVEL');
    const r = await entrar('43999990001', '123456', {}, url);
    assert.equal(r.status, 503);
    assert.equal(r.corpo.erro.codigo, 'SMS_INDISPONIVEL');
  });
});
