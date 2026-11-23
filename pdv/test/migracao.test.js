import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARCA_IMPORTACAO, PASTA_DE_DADOS, PASTA_DO_PDV_ANTIGO, importarDoPdvAntigo } from '../src/main/migracao.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-migracao-'));

function pdvAntigo({ sessao = true, localState = true, config = { apiUrl: 'https://cabana.managerpix.com.br', impressao: { modo: 'impressora', impressora: 'EPSON TM-T20', largura: 48, tabela: 'cp860', guilhotina: true }, idAgente: 'pdv-abc' } } = {}) {
  const dir = path.join(pasta(), PASTA_DO_PDV_ANTIGO);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  if (sessao) fs.writeFileSync(path.join(dir, 'sessao.bin'), Buffer.from('v10cifrado'));
  if (localState) fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'RFBBUEk=' } }));
  // Lixo do Chromium que não deve vir junto.
  fs.mkdirSync(path.join(dir, 'Cache'));
  return dir;
}

describe('importar a configuração do programa antigo ("Cabana Boemia PDV")', () => {
  test('pasta nova vazia: copia config, sessão e Local State; deixa a marca; não copia cache', () => {
    const antiga = pdvAntigo();
    const nova = path.join(pasta(), 'PDV do Abatiá');
    const r = importarDoPdvAntigo({ dadosNovos: nova, dadosAntigos: antiga, agora: () => new Date('2026-11-20T10:00:00Z') });
    assert.deepEqual(r, { importou: true, arquivos: ['config.json', 'sessao.bin', 'Local State'] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(nova, 'config.json'), 'utf8')).impressao.impressora, 'EPSON TM-T20');
    assert.equal(fs.readFileSync(path.join(nova, 'sessao.bin'), 'utf8'), 'v10cifrado');
    assert.ok(fs.existsSync(path.join(nova, 'Local State')));
    assert.ok(!fs.existsSync(path.join(nova, 'Cache')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(nova, MARCA_IMPORTACAO), 'utf8')).em, '2026-11-20T10:00:00.000Z');
    // A pasta antiga fica como estava (o programa antigo é desinstalado à mão).
    assert.ok(fs.existsSync(path.join(antiga, 'sessao.bin')));
  });

  test('PDV novo já configurado: não importa de novo (nunca sobrescreve)', () => {
    const antiga = pdvAntigo();
    const nova = pasta();
    fs.writeFileSync(path.join(nova, 'config.json'), '{"apiUrl":"https://outro.servidor"}');
    assert.deepEqual(importarDoPdvAntigo({ dadosNovos: nova, dadosAntigos: antiga }), { importou: false, motivo: 'ja-configurado' });
    assert.match(fs.readFileSync(path.join(nova, 'config.json'), 'utf8'), /outro\.servidor/);
  });

  test('computador sem o programa antigo (loja nova): nada a importar', () => {
    assert.deepEqual(importarDoPdvAntigo({ dadosNovos: pasta(), dadosAntigos: path.join(pasta(), 'nao-existe') }), { importou: false, motivo: 'sem-pdv-antigo' });
  });

  test('sem login salvo no antigo: importa só a configuração (pede o login)', () => {
    const antiga = pdvAntigo({ sessao: false, localState: false });
    const nova = path.join(pasta(), 'novo');
    assert.deepEqual(importarDoPdvAntigo({ dadosNovos: nova, dadosAntigos: antiga }).arquivos, ['config.json']);
  });

  test('"Local State" que já existe na pasta nova não é trocado (a chave dela continua)', () => {
    const antiga = pdvAntigo();
    const nova = pasta();
    fs.writeFileSync(path.join(nova, 'Local State'), '{"proprio":true}');
    const r = importarDoPdvAntigo({ dadosNovos: nova, dadosAntigos: antiga });
    assert.deepEqual(r.arquivos, ['config.json', 'sessao.bin']);
    assert.equal(fs.readFileSync(path.join(nova, 'Local State'), 'utf8'), '{"proprio":true}');
  });

  test('config antiga corrompida: não importa nada (o PDV abre como num computador novo)', () => {
    const antiga = pdvAntigo({ config: '{quebrado' });
    const nova = path.join(pasta(), 'novo');
    const r = importarDoPdvAntigo({ dadosNovos: nova, dadosAntigos: antiga });
    assert.equal(r.importou, false);
    assert.equal(r.motivo, 'erro');
    assert.ok(!fs.existsSync(path.join(nova, 'config.json')));
  });

  test('pasta de dados fixa em "PDV do Abatiá", definida antes de qualquer uso do userData', () => {
    assert.equal(PASTA_DE_DADOS, 'PDV do Abatiá');
    const main = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
    const fixa = main.indexOf("app.setPath('userData', path.join(app.getPath('appData'), PASTA_DE_DADOS))");
    assert.ok(fixa > 0, 'o main fixa o userData');
    assert.ok(fixa < main.indexOf("getPath('userData')"), 'antes da importação');
    assert.ok(fixa < main.indexOf('requestSingleInstanceLock'), 'antes da instância única');
    // O nome exibido mudou; a pasta, não.
    const pacote = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pacote.productName, 'Táqui PDV');
  });

  test('instalador: tira o "abrir com o Windows" do antigo ao instalar e o do novo ao desinstalar', () => {
    const nsh = fs.readFileSync(new URL('../recursos/installer.nsh', import.meta.url), 'utf8');
    const instalar = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend'));
    const desinstalar = nsh.slice(nsh.indexOf('!macro customUnInstall'));
    assert.match(instalar, /"CabanaBoemiaPDV"/);
    assert.match(desinstalar, /"PDVdoAbatia"/);
    const main = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
    assert.match(main, /NOME_INICIO = 'PDVdoAbatia'/);
    assert.match(main, /openAtLogin: false, name: NOME_INICIO_ANTIGO/);
  });
});
