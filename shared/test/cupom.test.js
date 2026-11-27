import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cupomParaTexto,
  formatarDataHora,
  formatarDinheiro,
  limparTexto,
  montarCupom,
  quebrar,
} from '../src/cupom.js';
import { cancelamentoWhatsapp, contaSalao, fechamentoCaixa, pedidoSite, relatorioDia } from './fixtures/trabalhos.js';

// Snapshot em texto puro (legível no diff). Para regravar depois de mudar o
// layout de propósito: node --test --test-update-snapshots test/cupom.test.js
const comoTexto = [(v) => v];

describe('cupom.js', () => {
  for (const colunas of [48, 32]) {
    for (const [nome, trabalho] of [
      ['PEDIDO (site, dinheiro com troco)', pedidoSite],
      ['CANCELAMENTO (WhatsApp)', cancelamentoWhatsapp],
      ['CONTA (salão, por kg)', contaSalao],
      ['FECHAMENTO (caixa)', fechamentoCaixa],
      ['RELATORIO_DIA (sexta, virada 04:00)', relatorioDia],
    ]) {
      test(`snapshot ${nome} em ${colunas} colunas`, (t) => {
        const linhas = montarCupom(trabalho, { colunas, restaurante: 'Cabana Boemia' });
        for (const l of linhas) {
          assert.equal(l.texto.length, l.grande ? colunas / 2 : colunas, `largura exata: "${l.texto}"`);
        }
        t.assert.snapshot(cupomParaTexto(linhas, colunas), { serializers: comoTexto });
      });
    }
  }

  test('ordem do CLAUDE.md: restaurante, número/origem, cliente, itens, taxa/total, pagamento/troco, data', () => {
    const texto = cupomParaTexto(montarCupom(pedidoSite, { colunas: 48 }), 48);
    const posicoes = [
      'CABANA BOEMIA',
      'PEDIDO #12',
      'Site - Delivery',
      'Cliente: Maria',
      'Tel: (43) 99999-0000',
      'End: Rua Coronel',
      'X-Bacon',
      'Taxa de entrega',
      'TOTAL',
      'Pagamento',
      'Troco para',
      '14/11/2026 20:15',
    ].map((trecho) => {
      const i = texto.indexOf(trecho);
      assert.ok(i >= 0, `falta "${trecho}"`);
      return i;
    });
    assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b));
  });

  test('observação sai em negrito, em linha própria', () => {
    const linhas = montarCupom(pedidoSite, { colunas: 48 });
    const obs = linhas.filter((l) => l.texto.includes('OBS:'));
    assert.equal(obs.length, 1);
    assert.equal(obs[0].negrito, true);
    assert.match(obs[0].texto, /^ {3}OBS: sem cebola, "bem passado"\s*$/, 'aspas trocadas e emoji removido');
    const item = linhas.find((l) => l.texto.includes('X-Bacon'));
    assert.ok(!item.negrito, 'o item em si não é negrito');
  });

  test('observação longa quebra mantendo o negrito em todas as linhas', () => {
    const trabalho = structuredClone(pedidoSite);
    trabalho.pedido.itens[0].observacao = 'sem cebola, sem tomate, maionese à parte e pão bem tostadinho por favor';
    const linhas = montarCupom(trabalho, { colunas: 32 });
    const i = linhas.findIndex((l) => l.texto.includes('OBS:'));
    const bloco = linhas.slice(i, i + 3);
    assert.ok(bloco.every((l) => l.negrito), 'todas as linhas da observação em negrito');
    assert.ok(bloco.slice(1).every((l) => l.texto.startsWith(' '.repeat(8))), 'continuação alinhada após "OBS: "');
  });

  test('CANCELAMENTO: "PEDIDO CANCELADO" grande e em negrito, sem pagamento', () => {
    for (const colunas of [48, 32]) {
      const linhas = montarCupom(cancelamentoWhatsapp, { colunas });
      const titulo = linhas.find((l) => l.texto.trim() === 'PEDIDO CANCELADO');
      assert.ok(titulo?.grande && titulo.negrito, `título grande em ${colunas}`);
      assert.ok(linhas.some((l) => l.grande && l.texto.trim() === 'CANCELADO'), 'rodapé grande');
      assert.ok(!linhas.some((l) => l.texto.startsWith('Pagamento')));
      assert.ok(linhas.some((l) => l.texto.includes('Cancelado em 14/11/2026 20:40')));
    }
  });

  test('CONTA: nome da comanda, mesa, peso e forma de pagamento; sem telefone nem taxa', () => {
    const texto = cupomParaTexto(montarCupom(contaSalao, { colunas: 48 }), 48);
    assert.match(texto, /Salão - Mesa 4/);
    assert.match(texto, /Cliente: Carlos/);
    assert.match(texto, /0,455 kg Prato por kg +R\$ 27,25/);
    assert.match(texto, /R\$ 59,90\/kg/);
    assert.match(texto, /Pagamento +Débito/);
    assert.match(texto, /4x Refrigerante Lata +R\$ 20,00/, 'toques separados agrupados na conta');
    assert.match(texto, /R\$ 5,00 cada/);
    assert.match(texto, /1x Refrigerante Lata +R\$ 5,00\n.*OBS: bem gelado/, 'com observação fica em linha própria');
    assert.match(texto, /TOTAL +R\$ 63,95/);
    assert.doesNotMatch(texto, /Tel:|Taxa de entrega|Troco/);
    assert.match(texto, /Não é documento fiscal/);
  });

  test('FECHAMENTO: abertura, movimentos, totais por forma e contado; nunca esperado nem diferença', () => {
    const texto = cupomParaTexto(montarCupom(fechamentoCaixa, { colunas: 48 }), 48);
    assert.match(texto, /FECHAMENTO DE CAIXA/);
    assert.match(texto, /Abertura +15\/11\/2026 10:58/);
    assert.match(texto, /Fechado por +Bia/);
    assert.match(texto, /Fundo de troco +R\$ 100,00/);
    assert.match(texto, /12:10 Troco do banco +R\$ 20,00/);
    assert.match(texto, /16:45 Depósito +R\$ 50,00/);
    assert.ok(texto.indexOf('Dinheiro (3)') < texto.indexOf('Pix (1)'), 'formas na ordem fixa');
    assert.match(texto, /Total vendido \(4\) +R\$ 121,27/);
    assert.match(texto, /DINHEIRO CONTADO +R\$ 145,00/);
    assert.match(texto, /Obs: Faltou uma moeda/);
    assert.doesNotMatch(texto, /[Ee]sperado|[Dd]iferen|PEDIDO #/);
    assert.doesNotMatch(texto, /145,37|-R\$/, 'nem o valor esperado/diferença por extenso');
  });

  test('pagamento sem troco: só a forma', () => {
    const trabalho = structuredClone(pedidoSite);
    Object.assign(trabalho.pedido, { formaPagamento: 'PIX', trocoParaCentavos: null });
    const texto = cupomParaTexto(montarCupom(trabalho, { colunas: 48 }), 48);
    assert.match(texto, /Pagamento +Pix/);
    assert.doesNotMatch(texto, /Troco/);
  });

  test('entrega com taxa 0 (frete grátis) sai "Grátis", não R$ 0,00; total sem taxa', () => {
    const trabalho = structuredClone(pedidoSite);
    Object.assign(trabalho.pedido, { taxaEntregaCentavos: 0, totalCentavos: 6700, trocoParaCentavos: null });
    for (const colunas of [48, 32]) {
      const linhas = montarCupom(trabalho, { colunas });
      for (const l of linhas) assert.equal(l.texto.length, l.grande ? colunas / 2 : colunas);
      const texto = cupomParaTexto(linhas, colunas);
      assert.match(texto, /Taxa de entrega +Grátis/);
      assert.doesNotMatch(texto, /Taxa de entrega +R\$/);
      assert.match(texto, /TOTAL +R\$ 67,00/);
    }
  });

  test('encomenda retirada no balcão, com desconto, observação do pedido e já paga', () => {
    const trabalho = structuredClone(pedidoSite);
    Object.assign(trabalho.pedido, {
      canal: 'WHATSAPP',
      encomenda: true,
      agendadoPara: '2026-11-14T23:30:00.000Z', // 20:30 em São Paulo
      retirarNoBalcao: true,
      enderecoTexto: null,
      bairroNome: null,
      taxaEntregaCentavos: 0,
      descontoCentavos: 700,
      totalCentavos: 6000,
      formaPagamento: 'PIX',
      trocoParaCentavos: null,
      pagoEm: '2026-11-14T22:00:00.000Z',
      observacao: 'Bolo com vela de 30 anos',
      tempoEstimadoMin: null,
    });
    for (const colunas of [48, 32]) {
      const linhas = montarCupom(trabalho, { colunas });
      for (const l of linhas) assert.equal(l.texto.length, l.grande ? colunas / 2 : colunas);
      const texto = cupomParaTexto(linhas, colunas);
      assert.match(texto, /WhatsApp - Encomenda/);
      assert.match(texto, /PARA 14\/11\/2026 20:30/);
      assert.match(texto, /RETIRAR NO BALCÃO/);
      assert.match(texto, /OBS DO PEDIDO: Bolo/);
      assert.match(texto, /Desconto +-R\$ 7,00/);
      assert.doesNotMatch(texto, /Taxa de entrega/);
      assert.match(texto, /Pix - JÁ PAGO/);
      assert.doesNotMatch(texto, /Troco|Previsão/);
      assert.ok(linhas.some((l) => l.negrito && l.texto.includes('RETIRAR NO BALC')));
    }
    // Cancelamento não repete a observação do pedido.
    const cancel = cupomParaTexto(montarCupom({ ...trabalho, tipo: 'CANCELAMENTO' }, { colunas: 48 }), 48);
    assert.doesNotMatch(cancel, /OBS DO PEDIDO/);
  });

  test('relatório do dia mostra descontos só quando houver', () => {
    const com = cupomParaTexto(montarCupom({ ...relatorioDia, relatorio: { ...relatorioDia.relatorio, descontoCentavos: 1250 } }), 48);
    assert.match(com, /Descontos +-R\$ 12,50/);
    assert.doesNotMatch(cupomParaTexto(montarCupom(relatorioDia), 48), /Descontos/);
  });

  test('largura e tipo inválidos são recusados', () => {
    assert.throws(() => montarCupom(pedidoSite, { colunas: 40 }), /Largura inválida/);
    assert.throws(() => montarCupom({ ...pedidoSite, tipo: 'OUTRO' }), /Tipo de cupom inválido/);
  });

  test('auxiliares: dinheiro, data local, limpeza e quebra', () => {
    assert.equal(formatarDinheiro(123456), 'R$ 1.234,56');
    assert.equal(formatarDinheiro(5), 'R$ 0,05');
    assert.equal(formatarDinheiro(-2800), '-R$ 28,00');
    assert.equal(formatarDataHora('2026-11-15T02:59:00.000Z'), '14/11/2026 23:59', 'dia local de São Paulo');
    assert.equal(limparTexto(' a\n\tb – c… “d” 😀 '), 'a b - c... "d"');
    assert.deepEqual(quebrar('abc defgh ij', 5), ['abc', 'defgh', 'ij']);
    assert.deepEqual(quebrar('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  });
});

describe('cupom.js: mapa da entrega', () => {
  const link = 'https://www.google.com/maps/search/?api=1&query=-23.3101,-50.3052';
  const comMapa = { ...pedidoSite, pedido: { ...pedidoSite.pedido, linkMapa: link, distanciaMetros: 3249, distanciaEstimada: false } };

  test('pedido com pino: distância, QR (largura exata) e o link escrito; no texto o QR some', () => {
    for (const colunas of [48, 32]) {
      const linhas = montarCupom(comMapa, { colunas });
      const qr = linhas.filter((l) => l.qr);
      assert.deepEqual(qr.map((l) => l.qr), [link]);
      assert.equal(qr[0].texto.length, colunas);
      const texto = cupomParaTexto(linhas, colunas);
      assert.match(texto, /Distância: 3,2 km/);
      assert.match(texto, /Mapa da entrega/);
      assert.ok(texto.replace(/\s+/g, '').includes(link), 'o link vem escrito (quebrado na largura)');
    }
  });

  test('distância estimada aparece marcada; sem pino nem distância o cupom fica como antes', () => {
    const estimada = { ...comMapa, pedido: { ...comMapa.pedido, distanciaEstimada: true } };
    assert.match(cupomParaTexto(montarCupom(estimada, { colunas: 48 }), 48), /Distância: ~3,2 km \(estimada\)/);
    assert.equal(cupomParaTexto(montarCupom(pedidoSite, { colunas: 48 }), 48).includes('Mapa'), false);
  });

  test('QR desligado na impressora: sem QR nem link, a distância continua; cancelamento não leva mapa', () => {
    const sem = cupomParaTexto(montarCupom(comMapa, { colunas: 48, qrMapa: false }), 48);
    assert.ok(montarCupom(comMapa, { colunas: 48, qrMapa: false }).every((l) => !l.qr));
    assert.equal(sem.includes(link), false);
    assert.match(sem, /Distância: 3,2 km/);
    const cancel = { ...cancelamentoWhatsapp, pedido: { ...cancelamentoWhatsapp.pedido, linkMapa: link, distanciaMetros: 3249 } };
    const t = cupomParaTexto(montarCupom(cancel, { colunas: 48 }), 48);
    assert.equal(t.includes('Mapa') || t.includes('Distância'), false);
  });
});

describe('pagamento online (Etapa 5)', () => {
  const pedidoOnline = {
    ...pedidoSite,
    pedido: {
      ...pedidoSite.pedido,
      canal: 'APP',
      formaPagamento: 'PIX',
      trocoParaCentavos: null,
      pagamentoOnline: { meio: 'PIX', situacao: 'PAGO', aprovadoEm: null, valorEstornadoCentavos: 0 },
    },
  };

  test('pedido pago online: "Pix - PAGO ONLINE", "NÃO COBRAR NA ENTREGA" e sem troco', () => {
    const texto = cupomParaTexto(montarCupom(pedidoOnline, { colunas: 48 }), 48);
    assert.match(texto, /Pix - PAGO ONLINE/);
    assert.match(texto, /NÃO COBRAR NA ENTREGA/);
    assert.doesNotMatch(texto, /troco/i);
    assert.doesNotMatch(cupomParaTexto(montarCupom(pedidoSite, { colunas: 48 }), 48), /PAGO ONLINE/);
  });

  test('cartão pelo app: o tipo real no cupom ("Cartão de débito - PAGO ONLINE"); sem tipo = "Cartão"', () => {
    const cartao = (tipo) => ({
      ...pedidoOnline,
      pedido: { ...pedidoOnline.pedido, formaPagamento: 'DEBITO', pagamentoOnline: { ...pedidoOnline.pedido.pagamentoOnline, meio: 'CARTAO_ONLINE', tipo } },
    });
    assert.match(cupomParaTexto(montarCupom(cartao('DEBITO'), { colunas: 48 }), 48), /Cartão de débito - PAGO ONLINE/);
    assert.match(cupomParaTexto(montarCupom(cartao('PRE_PAGO'), { colunas: 48 }), 48), /Cartão pré-pago - PAGO ONLINE/);
    assert.match(cupomParaTexto(montarCupom(cartao(null), { colunas: 48 }), 48), /Cartão - PAGO ONLINE/);
  });

  test('resumo do dia: o cartão pelo app por tipo quando há mais de um (ou não é crédito)', () => {
    const relatorio = {
      ...relatorioDia.relatorio,
      pagoOnline: [
        { meio: 'PIX', quantidade: 0, totalCentavos: 0 },
        { meio: 'CARTAO_ONLINE', quantidade: 3, totalCentavos: 9000, porTipo: [{ tipo: 'CREDITO', quantidade: 2, totalCentavos: 6000 }, { tipo: 'DEBITO', quantidade: 1, totalCentavos: 3000 }] },
      ],
    };
    const texto = cupomParaTexto(montarCupom({ ...relatorioDia, relatorio }, { colunas: 48 }), 48);
    assert.match(texto, /Cartão online \(3\)\s+R\$ 90,00/);
    assert.match(texto, /Cartão de crédito \(2\)\s+R\$ 60,00/);
    assert.match(texto, /Cartão de débito \(1\)\s+R\$ 30,00/);
    const soCredito = { ...relatorio, pagoOnline: [relatorio.pagoOnline[0], { ...relatorio.pagoOnline[1], porTipo: [{ tipo: 'CREDITO', quantidade: 3, totalCentavos: 9000 }] }] };
    assert.doesNotMatch(cupomParaTexto(montarCupom({ ...relatorioDia, relatorio: soCredito }, { colunas: 48 }), 48), /Cartão de crédito/);
  });

  test('resumo do dia: "Pago na entrega", pago online à parte e estornos de entregues', () => {
    const relatorio = {
      ...relatorioDia.relatorio,
      pagoOnline: [
        { meio: 'PIX', quantidade: 2, totalCentavos: 5000 },
        { meio: 'CARTAO_ONLINE', quantidade: 0, totalCentavos: 0 },
      ],
      estornosDeFinalizados: { quantidade: 1, totalCentavos: 700 },
    };
    const texto = cupomParaTexto(montarCupom({ ...relatorioDia, relatorio }, { colunas: 48 }), 48);
    assert.match(texto, /Pago na entrega/);
    assert.match(texto, /Pago online \(fora do caixa\)/);
    assert.match(texto, /Pix online \(2\)\s+R\$ 50,00/);
    assert.doesNotMatch(texto, /Cartão online/);
    assert.match(texto, /Estornos de entregues \(1\)\s+R\$ 7,00/);
    // Sem online no dia: como antes.
    assert.match(cupomParaTexto(montarCupom(relatorioDia, { colunas: 48 }), 48), /Por forma de pagamento/);
  });
});
