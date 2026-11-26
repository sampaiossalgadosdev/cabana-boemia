import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarConfig, validarApiUrl } from '../src/main/config.js';
import { criarTempoReal } from '../src/main/tempoReal.js';
import { criarArmazemRefresh } from '../src/main/armazemRefresh.js';
import { chaveNfceParaApi, criarHandlers, executar, linkMapaValido, validarMinutos } from '../src/main/ipc.js';
import { criarEstadoLoja } from '../src/main/loja.js';

const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-teste-'));

describe('config (userData/config.json)', () => {
  test('validarApiUrl normaliza e recusa o que não é http(s)', () => {
    assert.equal(validarApiUrl(' https://api.exemplo.com/ '), 'https://api.exemplo.com');
    assert.equal(validarApiUrl('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(validarApiUrl('https://exemplo.com/api//'), 'https://exemplo.com', 'o /api é do PDV, não da pessoa');
    assert.equal(validarApiUrl('https://exemplo.com/sub/API'), 'https://exemplo.com/sub');
    for (const ruim of ['', 'exemplo.com', 'ftp://x.com', 'javascript:alert(1)', 'https://x.com/?a=1', 'https://u:s@x.com']) {
      assert.throws(() => validarApiUrl(ruim), undefined, ruim);
    }
  });

  test('padrão até salvar; salvo persiste; arquivo corrompido cai no padrão', () => {
    const caminho = path.join(pastaTemp(), 'config.json');
    const c1 = criarConfig({ caminho, apiUrlPadrao: null });
    assert.deepEqual(c1.obter(), { apiUrl: null, apiUrlSugerido: null, impressaoConfigurada: false }, 'produção: sem padrão, pede na primeira execução');
    assert.equal(c1.apiUrl(), null);
    c1.definirApiUrl('https://api.exemplo.com/');
    const c2 = criarConfig({ caminho, apiUrlPadrao: null });
    assert.deepEqual(c2.obter(), { apiUrl: 'https://api.exemplo.com', apiUrlSugerido: null, impressaoConfigurada: false }, 'a tela mostra o endereço digitado');
    c2.definirImpressao({ modo: 'desligado' });
    assert.equal(criarConfig({ caminho, apiUrlPadrao: null }).obter().impressaoConfigurada, true, '"não imprime" também conta como configurado');
    assert.equal(c2.apiUrl(), 'https://api.exemplo.com/api', 'as rotas ficam sob /api');

    fs.writeFileSync(caminho, '{lixo');
    assert.equal(criarConfig({ caminho, apiUrlPadrao: 'http://localhost:3000' }).apiUrl(), 'http://localhost:3000/api');
  });

  test('sugestão de produção: só preenche a tela, não vira servidor sem salvar', () => {
    const caminho = path.join(pastaTemp(), 'config.json');
    const c = criarConfig({ caminho, apiUrlPadrao: null, apiUrlSugerido: 'https://api.taakidelivery.com.br' });
    assert.deepEqual(c.obter(), { apiUrl: null, apiUrlSugerido: 'https://api.taakidelivery.com.br', impressaoConfigurada: false });
    assert.equal(c.apiUrl(), null, 'a primeira tela continua aparecendo');
    c.definirApiUrl('https://outro.exemplo.com');
    assert.equal(c.apiUrl(), 'https://outro.exemplo.com/api', 'editável: vale o que foi salvo');
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
  function montar({ logado = false, consultarCep } = {}) {
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
    const loja = criarEstadoLoja({ servidor: () => 'http://x', fetch: async () => new Response('', { status: 404 }) });
    return { h: criarHandlers({ config, api, tempoReal, agente, listarImpressoras, versao: '0.1.0', consultarCep, loja }), chamadas, agente, caminho, loja };
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

  test('fila e painel pedem todos os canais (sem lista de canais: um canal novo nunca some)', async () => {
    const { h, chamadas } = montar();
    await h['pedidos:fila']();
    assert.deepEqual(chamadas[0], ['GET', '/equipe/pedidos?dataRef=hoje']);
    await h['pedidos:listar']('hoje');
    assert.deepEqual(chamadas[1], ['GET', '/equipe/pedidos?dataRef=hoje&status=todos']);
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
        // Delivery comum: sem encomenda, sem desconto, taxa do bairro (null), paga na entrega.
        encomenda: false,
        agendadoPara: null,
        retirarNoBalcao: false,
        descontoCentavos: 0,
        taxaEntregaCentavos: null,
        observacao: null,
        pagoAgora: false,
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

  test('pago online: aceitar e finalizar sem forma (Etapa 5), com o id conferido', async () => {
    const { h, chamadas } = montar();
    assert.equal((await executar(h['pedidos:aceitar'], ['1'])).ok, false);
    assert.equal((await executar(h['pedidos:finalizarOnline'], [0])).ok, false);
    await h['pedidos:aceitar'](7);
    await h['pedidos:finalizarOnline'](7);
    assert.deepEqual(chamadas.map((c) => c.slice(0, 3)), [
      ['PATCH', '/equipe/pedidos/7/aceitar'],
      ['PATCH', '/equipe/pedidos/7/finalizar', {}],
    ]);
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
      email: null,
      observacao: null,
      endereco: { rua: 'R', numero: '1', complemento: null, referencia: 'praça', bairroId: 5, cep: null, cidade: null, estado: null },
    });
  });

  test('cadastro sem endereço (retirada no balcão), edição de cliente e de endereço', async () => {
    const { h, chamadas } = montar();
    await h['clientes:criar']({ nome: 'Dai', telefone: '43999990000', email: 'd@x.com', observacao: 'vip', endereco: null });
    await h['clientes:atualizar'](3, { nome: 'Dai', telefone: '43999990000', email: '', observacao: '', googleId: 'x' });
    await h['clientes:atualizarEndereco'](3, 9, { rua: 'R', numero: '1', bairroId: 2, cep: '86460-000', cidade: 'Abatiá', estado: 'Paraná' });
    assert.deepEqual(chamadas.map((c) => c.slice(0, 2)), [
      ['POST', '/equipe/clientes'],
      ['PUT', '/equipe/clientes/3'],
      ['PUT', '/equipe/clientes/3/enderecos/9'],
    ]);
    assert.equal(chamadas[0][2].endereco, null);
    assert.equal(chamadas[0][2].email, 'd@x.com');
    assert.deepEqual(chamadas[1][2], { nome: 'Dai', telefone: '43999990000', email: null, observacao: null });
    assert.equal(chamadas[2][2].cep, '86460-000');
    assert.equal((await executar(h['clientes:atualizarEndereco'], [3, 0, {}])).ok, false);
  });

  test('painel: listar por dia, status e horário só com valores aceitos', async () => {
    const { h, chamadas } = montar();
    await h['pedidos:listar']('hoje');
    await h['pedidos:listar']('2026-11-14');
    await h['pedidos:status'](5, 'EM_PREPARO');
    await h['pedidos:agendamento'](5, '2026-11-14T22:30:00-03:00');
    for (const [canal, args] of [
      ['pedidos:listar', ['ontem']],
      ['pedidos:status', [5, 'FINALIZADO']],
      ['pedidos:status', [0, 'ABERTO']],
      ['pedidos:agendamento', [5, 'amanhã']],
    ]) {
      assert.equal((await executar(h[canal], args)).ok, false, `${canal} ${JSON.stringify(args)}`);
    }
    assert.deepEqual(chamadas, [
      ['GET', '/equipe/pedidos?dataRef=hoje&status=todos'],
      ['GET', '/equipe/pedidos?dataRef=2026-11-14&status=todos'],
      ['PATCH', '/equipe/pedidos/5/status', { status: 'EM_PREPARO' }],
      ['PATCH', '/equipe/pedidos/5/agendamento', { agendadoPara: '2026-11-15T01:30:00.000Z' }],
    ]);
  });

  test('pedido da equipe: encomenda, retirada, desconto, taxa e pago agora; nada de preço', async () => {
    const { h, chamadas } = montar();
    await h['pedidos:criar']({
      clienteId: 1, enderecoId: 4, itens: [{ produtoId: 2, quantidade: 1, precoCentavos: 1 }], formaPagamento: 'PIX',
      encomenda: true, agendadoPara: '2026-11-14T22:30:00-03:00', retirarNoBalcao: true, taxaEntregaCentavos: 500,
      descontoCentavos: 200, observacao: 'bolo', pagoAgora: true, totalCentavos: 1,
    });
    assert.deepEqual(chamadas[0][2], {
      clienteId: 1,
      enderecoId: null,
      itens: [{ produtoId: 2, quantidade: 1, observacao: null }],
      formaPagamento: 'PIX',
      trocoParaCentavos: null,
      chaveIdempotencia: undefined,
      encomenda: true,
      agendadoPara: '2026-11-15T01:30:00.000Z',
      retirarNoBalcao: true,
      descontoCentavos: 200,
      taxaEntregaCentavos: null,
      observacao: 'bolo',
      pagoAgora: true,
    });
    // Delivery: retirada ignorada (só encomenda), taxa digitada vai; endereço obrigatório.
    await h['pedidos:criar']({ clienteId: 1, enderecoId: 4, itens: [], formaPagamento: 'PIX', retirarNoBalcao: true, taxaEntregaCentavos: 700 });
    assert.equal(chamadas[1][2].retirarNoBalcao, false);
    assert.equal(chamadas[1][2].taxaEntregaCentavos, 700);
    assert.equal(chamadas[1][2].agendadoPara, null);
    assert.equal((await executar(h['pedidos:criar'], [{ clienteId: 1, itens: [], formaPagamento: 'PIX' }])).ok, false);
    assert.equal((await executar(h['pedidos:criar'], [{ clienteId: 1, enderecoId: 4, itens: [], formaPagamento: 'PIX', encomenda: true }])).ok, false);
  });

  test('CEP: consulta injetada; só dígitos chegam ao ViaCEP; erros viram mensagem', async () => {
    const { criarConsultaCep } = await import('../src/main/cep.js');
    const urls = [];
    const consultar = criarConsultaCep({
      fetch: async (url) => {
        urls.push(url);
        if (url.includes('00000000')) return { ok: true, json: async () => ({ erro: 'true' }) };
        if (url.includes('11111111')) throw new Error('sem rede');
        return { ok: true, json: async () => ({ logradouro: 'Rua X', bairro: 'Centro', localidade: 'Abatiá', uf: 'PR' }) };
      },
    });
    assert.deepEqual(await consultar('86.460-000'), { cep: '86460000', rua: 'Rua X', bairro: 'Centro', cidade: 'Abatiá', estado: 'Paraná' });
    assert.deepEqual(urls, ['https://viacep.com.br/ws/86460000/json/']);
    await assert.rejects(consultar('123'), (e) => e.codigo === 'VALIDACAO');
    await assert.rejects(consultar('00000-000'), (e) => e.codigo === 'CEP_NAO_ENCONTRADO');
    await assert.rejects(consultar('11111-111'), (e) => e.codigo === 'CEP_INDISPONIVEL');

    const { h } = montar({ consultarCep: async (cep) => ({ cep }) });
    assert.deepEqual(await h['cep:consultar']('86460000'), { cep: '86460000' });
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
    assert.deepEqual(r.config, { modo: 'desligado', impressora: '', largura: 48, tabela: 'cp860', guilhotina: true, qrMapa: true });
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
    assert.deepEqual(salvo, { modo: 'impressora', impressora: 'EPSON TM-T20', largura: 32, tabela: 'cp850', guilhotina: false, qrMapa: true });
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
      modo: 'desligado', impressora: '', largura: 48, tabela: 'cp860', guilhotina: true, qrMapa: true,
    });
  });

  /** Handlers com uma API falsa: login como `papel`, /equipe/loja devolve a loja do X-Loja (ou a do cadastro). */
  function montarLogin(papel, { lojaLembrada = null } = {}) {
    const { agente } = montar();
    const caminho = path.join(pastaTemp(), 'config.json');
    const config = criarConfig({ caminho, apiUrlPadrao: 'http://x' });
    if (lojaLembrada) config.definirLojaAdmin(lojaLembrada);
    const loja = criarEstadoLoja({
      servidor: () => 'http://x',
      fetch: async (url) => {
        assert.equal(url, 'http://x/api/publico/imagens/7');
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      },
    });
    const pedidas = [];
    const api = {
      entrar: async () => ({ id: 1, nome: 'Ana', papel }),
      sair: async () => {},
      requisitar: async (metodo, rota) => {
        pedidas.push([metodo, rota, loja.informada()]);
        if (rota === '/equipe/loja') {
          if (papel === 'ADMIN' && loja.informada() === 'sumiu') throw Object.assign(new Error('Loja não encontrada'), { status: 404 });
          const slug = loja.informada() ?? 'cabana-boemia';
          return { loja: { id: 1, slug, nome: slug === 'cabana-boemia' ? 'Cabana Boemia' : 'Lanchonete do Zé', logoUrl: '/api/publico/imagens/7', corPrimaria: '#1D4ED8', corTexto: '#FFFFFF' } };
        }
        if (rota === '/plataforma/lojas') return { lojas: [{ id: 2, slug: 'lanchonete-do-ze', nome: 'Lanchonete do Zé', ativa: true, corPrimaria: '#1D4ED8', pedidos: 3 }] };
        return {};
      },
    };
    const h = criarHandlers({ config, api, tempoReal: { ligar() {}, desligar() {} }, agente, listarImpressoras: async () => [], versao: 'x', loja });
    return { h, agente, loja, config, pedidas };
  }

  test('login (atendente) entra na loja do cadastro: identidade com a logo em data:, liga o agente; sair desliga', async () => {
    const { h, agente, loja, pedidas } = montarLogin('ATENDENTE');
    const u = await h['sessao:entrar']('a@b.com', 'senha');
    assert.equal(u.loja.slug, 'cabana-boemia');
    assert.equal(u.loja.logoDataUrl, 'data:image/png;base64,iVBORw==');
    assert.equal(loja.informada(), null, 'atendente não manda X-Loja');
    assert.deepEqual(pedidas[0], ['GET', '/equipe/loja', null]);
    await h['sessao:sair']();
    assert.deepEqual(agente.eventos, ['desligar', 'ligar', 'desligar']);
    assert.equal(loja.identidade(), null);
    await assert.rejects(h['lojas:listar'](), /administrador/);
  });

  test('ADMIN sem loja escolhe depois do login; a escolha vai no X-Loja e fica guardada', async () => {
    const { h, agente, loja, config, pedidas } = montarLogin('ADMIN');
    const u = await h['sessao:entrar']('a@b.com', 'senha');
    assert.equal(u.loja, null);
    assert.deepEqual(agente.eventos, ['desligar'], 'sem loja: nada ligado');
    assert.deepEqual(await h['lojas:listar'](), [{ slug: 'lanchonete-do-ze', nome: 'Lanchonete do Zé', ativa: true, corPrimaria: '#1D4ED8' }]);
    await assert.rejects(h['loja:escolher']('Não Vale'), /Loja inválida/);
    const id = await h['loja:escolher']('lanchonete-do-ze');
    assert.equal(id.nome, 'Lanchonete do Zé');
    assert.equal(loja.informada(), 'lanchonete-do-ze');
    assert.deepEqual(pedidas.at(-1), ['GET', '/equipe/loja', 'lanchonete-do-ze']);
    assert.equal(config.lojaAdmin(), 'lanchonete-do-ze');
    assert.equal(agente.eventos.at(-1), 'ligar');
    // Voltar à escolha desliga tudo.
    assert.equal(await h['loja:escolher'](null), null);
    assert.equal(loja.informada(), null);
    assert.equal(agente.eventos.at(-1), 'desligar');
  });

  test('ADMIN volta na loja lembrada; loja que sumiu = escolhe de novo', async () => {
    const lembrada = montarLogin('ADMIN', { lojaLembrada: 'lanchonete-do-ze' });
    assert.equal((await lembrada.h['sessao:entrar']('a@b.com', 'senha')).loja.slug, 'lanchonete-do-ze');
    const sumiu = montarLogin('ADMIN', { lojaLembrada: 'sumiu' });
    assert.equal((await sumiu.h['sessao:entrar']('a@b.com', 'senha')).loja, null);
    assert.equal(sumiu.config.lojaAdmin(), null);
  });

  test('NFC-e: 44 números (espaços e pontos saem); vazio apaga; bairros da própria loja', async () => {
    const chave = '41261112345678000190650010000000011123456780';
    assert.deepEqual(chaveNfceParaApi(chave.replace(/(\d{4})/g, '$1 ')), { chaveNfce: chave });
    assert.deepEqual(chaveNfceParaApi(''), { chaveNfce: null });
    assert.deepEqual(chaveNfceParaApi(null), { chaveNfce: null });
    assert.throws(() => chaveNfceParaApi('123'), /44 números/);
    const { h, chamadas } = montar();
    await h['pedidos:nfce'](5, chave);
    assert.deepEqual(chamadas.at(-1), ['PATCH', '/equipe/pedidos/5/nfce', { chaveNfce: chave }]);
    await h['bairros:listar']();
    assert.deepEqual(chamadas.at(-1), ['GET', '/equipe/bairros']);
  });

  test('id do agente de impressão: gerado uma vez e guardado', () => {
    const caminho = path.join(pastaTemp(), 'config.json');
    const id = criarConfig({ caminho, apiUrlPadrao: null }).idAgente();
    assert.match(id, /^pdv-[0-9a-f-]{36}$/);
    assert.equal(criarConfig({ caminho, apiUrlPadrao: null }).idAgente(), id);
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

describe('tempo real: endereço do socket', () => {
  test('conecta na origem do servidor com path /api/socket.io (não usa /api como namespace)', () => {
    const chamadas = [];
    const socketFalso = { on() {}, connect() {}, disconnect() {}, removeAllListeners() {}, close() {} };
    const io = (url, opcoes) => {
      chamadas.push({ url, path: opcoes.path });
      return socketFalso;
    };
    const t = criarTempoReal({
      io,
      apiUrl: () => 'https://cabana.up.railway.app/api',
      accessToken: async () => 't',
      renovar: async () => 't',
      aoStatus() {},
      aoEvento() {},
    });
    t.ligar();
    assert.deepEqual(chamadas, [{ url: 'https://cabana.up.railway.app', path: '/api/socket.io' }]);
  });
});

describe('Abrir no mapa (IPC)', () => {
  const bom = 'https://www.google.com/maps/search/?api=1&query=-23.3049,-50.3133';

  test('só o link do Google Maps com o pino; qualquer outro é recusado', () => {
    assert.equal(linkMapaValido(bom), bom);
    assert.equal(linkMapaValido('https://www.google.com/maps/search/?api=1&query=-23.123456,-50.1'), 'https://www.google.com/maps/search/?api=1&query=-23.123456,-50.1');
    for (const ruim of [
      'http://www.google.com/maps/search/?api=1&query=-23.3,-50.3',
      'https://evil.com/maps/search/?api=1&query=-23.3,-50.3',
      `${bom}&x=1`,
      'file:///C:/Windows/system32/calc.exe',
      'https://www.google.com/maps/search/?api=1&query=rua',
      null,
      42,
    ]) {
      assert.throws(() => linkMapaValido(ruim), /Link do mapa inválido/, String(ruim));
    }
  });

  test('o handler abre fora (navegador) só o link validado', async () => {
    const abertos = [];
    const h = criarHandlers({ config: {}, api: {}, tempoReal: {}, agente: {}, listarImpressoras: async () => [], versao: 'x', loja: {}, abrirExterno: async (u) => abertos.push(u) });
    assert.equal(await h['mapa:abrir'](bom), true);
    await assert.rejects(h['mapa:abrir']('https://evil.com'), /inválido/);
    assert.deepEqual(abertos, [bom]);
  });
});
