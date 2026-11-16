import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarConfig, validarApiUrl } from '../src/main/config.js';
import { criarArmazemRefresh } from '../src/main/armazemRefresh.js';
import { criarHandlers, executar, validarMinutos } from '../src/main/ipc.js';

const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-teste-'));

describe('config (userData/config.json)', () => {
  test('validarApiUrl normaliza e recusa o que não é http(s)', () => {
    assert.equal(validarApiUrl(' https://api.exemplo.com/ '), 'https://api.exemplo.com');
    assert.equal(validarApiUrl('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(validarApiUrl('https://exemplo.com/api//'), 'https://exemplo.com/api');
    for (const ruim of ['', 'exemplo.com', 'ftp://x.com', 'javascript:alert(1)', 'https://x.com/?a=1', 'https://u:s@x.com']) {
      assert.throws(() => validarApiUrl(ruim), undefined, ruim);
    }
  });

  test('padrão até salvar; salvo persiste; arquivo corrompido cai no padrão', () => {
    const caminho = path.join(pastaTemp(), 'config.json');
    const c1 = criarConfig({ caminho, apiUrlPadrao: null });
    assert.deepEqual(c1.obter(), { apiUrl: null }, 'produção: sem padrão, pede na primeira execução');
    c1.definirApiUrl('https://api.exemplo.com/');
    assert.equal(criarConfig({ caminho, apiUrlPadrao: null }).apiUrl(), 'https://api.exemplo.com');

    fs.writeFileSync(caminho, '{lixo');
    assert.equal(criarConfig({ caminho, apiUrlPadrao: 'http://localhost:3000' }).apiUrl(), 'http://localhost:3000');
  });
});

describe('armazém do refresh (safeStorage)', () => {
  // Cifra de mentira, só para verificar que nada vai em texto puro.
  const cifra = (disponivel = true) => ({
    isAsyncEncryptionAvailable: async () => disponivel,
    encryptStringAsync: async (s) => Buffer.from(`CIFRADO:${Buffer.from(s).toString('base64')}`),
    decryptStringAsync: async (b) => ({
      result: Buffer.from(b.toString().replace('CIFRADO:', ''), 'base64').toString(),
      shouldReEncrypt: false,
    }),
  });

  test('grava cifrado, lê de volta numa instância nova e apaga', async () => {
    const caminho = path.join(pastaTemp(), 'sessao.bin');
    const a = criarArmazemRefresh({ caminho, safeStorage: cifra() });
    await a.guardar('refresh-secreto');
    assert.ok(!fs.readFileSync(caminho).toString().includes('refresh-secreto'), 'nada em texto puro');
    assert.equal(await criarArmazemRefresh({ caminho, safeStorage: cifra() }).ler(), 'refresh-secreto');
    await a.apagar();
    assert.equal(fs.existsSync(caminho), false);
    assert.equal(await criarArmazemRefresh({ caminho, safeStorage: cifra() }).ler(), null);
  });

  test('sem cifragem disponível: só memória, nunca grava no disco', async () => {
    const caminho = path.join(pastaTemp(), 'sessao.bin');
    const a = criarArmazemRefresh({ caminho, safeStorage: cifra(false) });
    await a.guardar('refresh-secreto');
    assert.equal(await a.ler(), 'refresh-secreto');
    assert.equal(fs.existsSync(caminho), false);
  });
});

describe('handlers IPC', () => {
  function montar({ logado = false } = {}) {
    const chamadas = [];
    const api = {
      logado: () => logado,
      requisitar: async (...args) => {
        chamadas.push(args);
        return { ok: true };
      },
    };
    const tempoReal = { ligar() {}, desligar() {}, status: () => 'desligado' };
    const agente = {
      eventos: [],
      ligar() { this.eventos.push('ligar'); },
      desligar() { this.eventos.push('desligar'); },
      reconfigurar() { this.eventos.push('reconfigurar'); },
      status: () => ({ estado: 'ok' }),
    };
    const caminho = path.join(pastaTemp(), 'config.json');
    const cfg = criarConfig({ caminho, apiUrlPadrao: 'http://x' });
    const config = { ...cfg, definirApiUrl: (u) => validarApiUrl(u) };
    const listarImpressoras = async () => ['EPSON TM-T20', 'Microsoft Print to PDF'];
    return { h: criarHandlers({ config, api, tempoReal, agente, listarImpressoras, versao: '0.1.0' }), chamadas, agente, caminho };
  }

  test('finalizar valida id e forma de pagamento antes de chamar a API', async () => {
    const { h, chamadas } = montar();
    for (const [id, forma] of [[0, 'PIX'], [1.5, 'PIX'], [3, ''], [3, 'FIADO']]) {
      const r = await executar(h['pedidos:finalizar'], [id, forma]);
      assert.equal(r.ok, false);
      assert.equal(r.erro.codigo, 'VALIDACAO');
    }
    assert.equal(chamadas.length, 0);
    assert.deepEqual(await executar(h['pedidos:finalizar'], [3, 'PIX']), { ok: true, dados: { ok: true } });
    assert.deepEqual(chamadas[0], ['PATCH', '/equipe/pedidos/3/finalizar', { formaPagamento: 'PIX' }]);
  });

  test('fila pede só site + WhatsApp de hoje', async () => {
    const { h, chamadas } = montar();
    await h['pedidos:fila']();
    assert.deepEqual(chamadas[0], ['GET', '/equipe/pedidos?dataRef=hoje&canal=SITE,WHATSAPP']);
  });

  test('tempo: 1 a 240 inteiro; vazio/null volta ao padrão', async () => {
    assert.equal(validarMinutos(null), null);
    assert.equal(validarMinutos(''), null);
    assert.equal(validarMinutos(45), 45);
    for (const ruim of [0, 241, 12.5, NaN, '30']) assert.throws(() => validarMinutos(ruim));
    const { h, chamadas } = montar();
    await h['tempo:definir'](null);
    assert.deepEqual(chamadas[0], ['PUT', '/equipe/config/tempo-estimado', { minutos: null }]);
  });

  test('pedido do WhatsApp: só os campos aceitos vão para a API (sem preço injetado)', async () => {
    const { h, chamadas } = montar();
    await h['pedidos:criar']({
      clienteId: 7,
      enderecoId: 9,
      formaPagamento: 'DINHEIRO',
      trocoParaCentavos: 5000,
      chaveIdempotencia: 'c-1',
      totalCentavos: 1,
      canal: 'SITE',
      itens: [{ produtoId: 3, quantidade: 2, observacao: 'sem cebola', precoCentavos: 1 }, { produtoId: 4, quantidade: 1, observacao: '  ' }],
    });
    assert.deepEqual(chamadas[0], [
      'POST',
      '/equipe/pedidos',
      {
        clienteId: 7,
        enderecoId: 9,
        formaPagamento: 'DINHEIRO',
        trocoParaCentavos: 5000,
        chaveIdempotencia: 'c-1',
        itens: [
          { produtoId: 3, quantidade: 2, observacao: 'sem cebola' },
          { produtoId: 4, quantidade: 1, observacao: null },
        ],
      },
    ]);
    for (const ruim of [null, { clienteId: 0, enderecoId: 1, itens: [], formaPagamento: 'PIX' }, { clienteId: 1, enderecoId: 1, itens: [], formaPagamento: 'FIADO' }]) {
      assert.equal((await executar(h['pedidos:criar'], [ruim])).ok, false);
    }
  });

  test('comandas: rotas fixas e só os campos aceitos (sem preço injetado)', async () => {
    const { h, chamadas } = montar();
    await h['comandas:listar']();
    await h['comandas:abrir']({ nomeCliente: '  Maria ', mesaRotulo: '', canal: 'SITE' });
    await h['comandas:lancarItem'](5, { produtoId: 2, pesoGramas: 487, quantidade: 9, precoCentavos: 1 });
    await h['comandas:lancarItem'](5, { produtoId: 3, observacao: '  ' });
    await h['comandas:removerItem'](5, 11);
    await h['comandas:fechar'](5, { formaPagamento: 'PIX', imprimirConta: 'sim', status: 'ABERTO' });
    assert.deepEqual(chamadas, [
      ['GET', '/equipe/comandas'],
      ['POST', '/equipe/comandas', { nomeCliente: 'Maria', mesaRotulo: null }],
      ['POST', '/equipe/comandas/5/itens', { produtoId: 2, pesoGramas: 487 }],
      ['POST', '/equipe/comandas/5/itens', { produtoId: 3, quantidade: 1 }],
      ['DELETE', '/equipe/comandas/5/itens/11'],
      ['POST', '/equipe/comandas/5/fechar', { formaPagamento: 'PIX', imprimirConta: false }],
    ]);
  });

  test('comandas: recusa id, peso, nome e forma inválidos antes de chamar a API', async () => {
    const { h, chamadas } = montar();
    const ruins = [
      ['comandas:abrir', [{ nomeCliente: '   ' }]],
      ['comandas:lancarItem', [0, { produtoId: 1 }]],
      ['comandas:lancarItem', [1, { produtoId: 1, pesoGramas: 0 }]],
      ['comandas:lancarItem', [1, { produtoId: 1, pesoGramas: 5001 }]],
      ['comandas:lancarItem', [1, { produtoId: 1, pesoGramas: 12.5 }]],
      ['comandas:removerItem', [1, 'x']],
      ['comandas:fechar', [1, {}]],
      ['comandas:fechar', [1, { formaPagamento: 'FIADO' }]],
    ];
    for (const [canal, args] of ruins) {
      const r = await executar(h[canal], args);
      assert.equal(r.ok, false, `${canal} ${JSON.stringify(args)}`);
      assert.equal(r.erro.codigo, 'VALIDACAO');
    }
    assert.equal(chamadas.length, 0);
  });

  test('caixa: rotas fixas; fechamento manda só contado e observação (nunca esperado)', async () => {
    const { h, chamadas } = montar();
    await h['caixa:atual']();
    await h['caixa:abrir'](15000);
    await h['caixa:movimento']({ tipo: 'SANGRIA', valorCentavos: 5000, motivo: ' depósito ', usuarioId: 9 });
    await h['caixa:fechar']({ valorContadoCentavos: 14500, observacao: '', esperadoCentavos: 1, diferencaCentavos: 2 });
    assert.deepEqual(chamadas, [
      ['GET', '/equipe/caixa/atual'],
      ['POST', '/equipe/caixa/abrir', { valorInicialCentavos: 15000 }],
      ['POST', '/equipe/caixa/movimentos', { tipo: 'SANGRIA', valorCentavos: 5000, motivo: 'depósito' }],
      ['POST', '/equipe/caixa/fechar', { valorContadoCentavos: 14500, observacao: null }],
    ]);
  });

  test('caixa: recusa valores e tipos inválidos antes de chamar a API', async () => {
    const { h, chamadas } = montar();
    const ruins = [
      ['caixa:abrir', [-1]],
      ['caixa:abrir', [12.5]],
      ['caixa:abrir', [NaN]],
      ['caixa:movimento', [{ tipo: 'RETIRADA', valorCentavos: 100, motivo: 'x' }]],
      ['caixa:movimento', [{ tipo: 'SANGRIA', valorCentavos: 0, motivo: 'x' }]],
      ['caixa:movimento', [{ tipo: 'SANGRIA', valorCentavos: 100, motivo: '  ' }]],
      ['caixa:fechar', [{}]],
      ['caixa:fechar', [{ valorContadoCentavos: 10_000_001 }]],
    ];
    for (const [canal, args] of ruins) {
      const r = await executar(h[canal], args);
      assert.equal(r.ok, false, `${canal} ${JSON.stringify(args)}`);
      assert.equal(r.erro.codigo, 'VALIDACAO');
    }
    assert.equal(chamadas.length, 0);
  });

  test('cancelar valida o id; busca de cliente vai codificada na URL', async () => {
    const { h, chamadas } = montar();
    assert.equal((await executar(h['pedidos:cancelar'], ['1'])).ok, false);
    await h['pedidos:cancelar'](12);
    await h['clientes:buscar'](' (43) 9&x ');
    await h['cardapio:obter'](null);
    await h['cardapio:obter'](2);
    assert.deepEqual(chamadas.map((c) => c.slice(0, 2)), [
      ['PATCH', '/equipe/pedidos/12/cancelar'],
      ['GET', '/equipe/clientes?busca=(43)%209%26x'],
      ['GET', '/equipe/cardapio'],
      ['GET', '/equipe/cardapio?turnoId=2'],
    ]);
  });

  test('cadastro de cliente: endereço só com os campos aceitos e bairro numérico', async () => {
    const { h, chamadas } = montar();
    await h['clientes:criar']({
      nome: 'Ana', telefone: '43999990000', admin: true,
      endereco: { rua: 'R', numero: '1', bairroId: '5', complemento: '', referencia: 'praça', principal: false },
    });
    assert.deepEqual(chamadas[0][2], {
      nome: 'Ana',
      telefone: '43999990000',
      endereco: { rua: 'R', numero: '1', complemento: null, referencia: 'praça', bairroId: 5 },
    });
  });

  test('erro da API leva os detalhes até o renderer', async () => {
    const erro = Object.assign(new Error('Já existe'), { codigo: 'CLIENTE_JA_EXISTE', status: 409, detalhes: { cliente: { id: 1 } } });
    const r = await executar(async () => {
      throw erro;
    }, []);
    assert.deepEqual(r, { ok: false, erro: { mensagem: 'Já existe', codigo: 'CLIENTE_JA_EXISTE', status: 409, detalhes: { cliente: { id: 1 } } } });
  });

  test('não troca de servidor com sessão aberta', async () => {
    const { h } = montar({ logado: true });
    const r = await executar(h['config:definirApiUrl'], ['https://outro.com']);
    assert.equal(r.ok, false);
  });

  test('reimprimir valida o id e chama a rota fixa', async () => {
    const { h, chamadas } = montar();
    assert.equal((await executar(h['pedidos:reimprimir'], ['7'])).ok, false);
    await h['pedidos:reimprimir'](7);
    assert.deepEqual(chamadas, [['POST', '/equipe/pedidos/7/reimprimir']]);
  });

  test('impressora: config com padrões, lista do Windows, salvar reconfigura o agente', async () => {
    const { h, agente, caminho } = montar();
    const r = await h['impressao:config']();
    assert.deepEqual(r.config, { modo: 'desligado', impressora: '', largura: 48, tabela: 'cp860', guilhotina: true });
    assert.deepEqual(r.impressoras, ['EPSON TM-T20', 'Microsoft Print to PDF']);

    const ruins = [
      { modo: 'impressora', impressora: '' },
      { modo: 'arquivo', largura: 40 },
      { modo: 'arquivo', tabela: 'utf8' },
      { modo: 'qualquer' },
      { modo: 'arquivo', guilhotina: 'sim' },
    ];
    for (const ruim of ruins) {
      const x = await executar(h['impressao:definirConfig'], [ruim]);
      assert.equal(x.ok, false, JSON.stringify(ruim));
      assert.equal(x.erro.codigo, 'VALIDACAO');
    }
    assert.deepEqual(agente.eventos, []);

    const salvo = await h['impressao:definirConfig']({ modo: 'impressora', impressora: ' EPSON TM-T20 ', largura: 32, tabela: 'cp850', guilhotina: false });
    assert.deepEqual(salvo, { modo: 'impressora', impressora: 'EPSON TM-T20', largura: 32, tabela: 'cp850', guilhotina: false });
    assert.deepEqual(agente.eventos, ['reconfigurar']);
    // Persistido no config.json, ao lado do apiUrl.
    const json = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    assert.deepEqual(json.impressao, salvo);
    assert.deepEqual(criarConfig({ caminho, apiUrlPadrao: null }).impressao(), salvo);
  });

  test('config.json com impressão corrompida volta aos padrões', () => {
    const caminho = path.join(pastaTemp(), 'config.json');
    fs.writeFileSync(caminho, JSON.stringify({ apiUrl: 'http://x', impressao: { modo: 'impressora', largura: 99 } }));
    assert.deepEqual(criarConfig({ caminho, apiUrlPadrao: null }).impressao(), {
      modo: 'desligado', impressora: '', largura: 48, tabela: 'cp860', guilhotina: true,
    });
  });

  test('login liga o agente; sair desliga', async () => {
    const { h, agente } = montar();
    const api = { entrar: async () => ({ id: 1 }) };
    Object.assign(h, criarHandlers({
      config: {}, api: { ...api, sair: async () => {} }, tempoReal: { ligar() {}, desligar() {} }, agente,
      listarImpressoras: async () => [], versao: 'x',
    }));
    await h['sessao:entrar']('a@b.com', 'senha');
    await h['sessao:sair']();
    assert.deepEqual(agente.eventos, ['ligar', 'desligar']);
  });
});

describe('cardapio:atualizado (retaguarda → PDV)', () => {
  test('o main escuta o evento da API e o preload o libera para a página', async () => {
    const { EVENTOS_EQUIPE } = await import('../src/main/tempoReal.js');
    assert.ok(EVENTOS_EQUIPE.includes('cardapio:atualizado'));
    const preload = fs.readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8');
    const lista = preload.match(/const EVENTOS = \[([\s\S]*?)\];/)[1];
    assert.match(lista, /'cardapio:atualizado'/);
  });
});
