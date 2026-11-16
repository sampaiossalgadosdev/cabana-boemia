import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatarDataHora,
  formatarWhatsapp,
  comSinal,
  descreverHorario,
  horariosParaApi,
  errosPorCampo,
  paraBusca,
  moverNaOrdem,
} from '../src/lib/formatar.js';

test('formatarDataHora mostra o horário de Brasília', () => {
  assert.equal(formatarDataHora('2026-11-15T23:30:00Z'), '15/11/26 20:30');
});

test('formatarWhatsapp', () => {
  assert.equal(formatarWhatsapp('5543999990000'), '(43) 99999-0000');
  assert.equal(formatarWhatsapp('554335551234'), '(43) 3555-1234');
  assert.equal(formatarWhatsapp(''), '');
});

test('comSinal', () => {
  assert.equal(comSinal(5), '+5');
  assert.equal(comSinal(-3), '−3');
  assert.equal(comSinal(0), '0');
});

test('descreverHorario: meia-noite e virada do dia', () => {
  assert.equal(descreverHorario({ inicio: '11:00', fim: '14:00' }), '11:00 às 14:00');
  assert.equal(descreverHorario({ inicio: '19:00', fim: '00:00' }), '19:00 até meia-noite');
  assert.equal(descreverHorario({ inicio: '22:00', fim: '02:00' }), '22:00 até 02:00 do dia seguinte');
});

test('horariosParaApi ordena e recusa linha incompleta ou com início = fim', () => {
  assert.deepEqual(
    horariosParaApi([
      { diaSemana: 5, inicio: '19:00', fim: '00:00', chave: 'a' },
      { diaSemana: 1, inicio: '11:00', fim: '14:00', chave: 'b' },
    ]),
    {
      horarios: [
        { diaSemana: 1, inicio: '11:00', fim: '14:00' },
        { diaSemana: 5, inicio: '19:00', fim: '00:00' },
      ],
    },
  );
  assert.match(horariosParaApi([{ diaSemana: 2, inicio: '', fim: '14:00' }]).erro, /Terça/);
  assert.match(horariosParaApi([{ diaSemana: 0, inicio: '10:00', fim: '10:00' }]).erro, /iguais/);
});

test('errosPorCampo: só VALIDACAO, primeiro erro de cada campo', () => {
  const err = {
    codigo: 'VALIDACAO',
    detalhes: [
      { campo: 'nome', mensagem: 'Informe o nome' },
      { campo: 'insumos.0.quantidade', mensagem: 'Q' },
      { campo: 'nome', mensagem: 'outro' },
    ],
  };
  assert.deepEqual(errosPorCampo(err), { nome: 'Informe o nome', insumos: 'Q' });
  assert.deepEqual(errosPorCampo({ codigo: 'NOME_EM_USO' }), {});
});

test('paraBusca tira acento e caixa', () => {
  assert.equal(paraBusca('  Açaí GRANDE '), 'acai grande');
});

test('moverNaOrdem: troca vizinhos, renumera de 10 em 10 e devolve só o que mudou', () => {
  const lista = [
    { id: 1, ordem: 10 },
    { id: 2, ordem: 20 },
    { id: 3, ordem: 30 },
  ];
  assert.deepEqual(moverNaOrdem(lista, 3, -1), [
    { id: 3, ordem: 20 },
    { id: 2, ordem: 30 },
  ]);
  assert.deepEqual(moverNaOrdem(lista, 1, -1), []);
  assert.deepEqual(moverNaOrdem(lista, 3, +1), []);
  // Ordens repetidas (seed com 0) viram distintas.
  assert.deepEqual(
    moverNaOrdem(
      [
        { id: 1, ordem: 0 },
        { id: 2, ordem: 0 },
      ],
      2,
      -1,
    ),
    [
      { id: 2, ordem: 10 },
      { id: 1, ordem: 20 },
    ],
  );
});

test('relatório: dia por extenso, somar dias (virada de mês), hora em Brasília', async () => {
  const { formatarDia, somarDias, formatarHora, descreverExpediente } = await import('../src/lib/formatar.js');
  assert.equal(formatarDia('2026-11-13'), 'sexta, 13/11/2026');
  assert.equal(somarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(somarDias('2026-01-01', -1), '2025-12-31');
  assert.equal(formatarHora('2026-11-14T03:30:00Z'), '00:30');
  assert.equal(descreverExpediente('2026-11-13T07:00:00Z', '2026-11-14T07:00:00Z'), 'sex 13/11 04:00 até sáb 14/11 04:00');
});

test('relatório: largura das barras e diferença do caixa', async () => {
  const { larguraBarra, descreverDiferenca, formatarPeso } = await import('../src/lib/formatar.js');
  assert.equal(larguraBarra(4617, 4617), 100);
  assert.equal(larguraBarra(2700, 4617), 58.5);
  assert.equal(larguraBarra(1, 100000), 1, 'valor pequeno ainda aparece');
  assert.equal(larguraBarra(0, 4617), 0);
  assert.equal(larguraBarra(0, 0), 0);
  assert.deepEqual(descreverDiferenca(-67), { tipo: 'faltou', centavos: 67 });
  assert.deepEqual(descreverDiferenca(150), { tipo: 'sobrou', centavos: 150 });
  assert.deepEqual(descreverDiferenca(0), { tipo: 'bateu', centavos: 0 });
  assert.equal(descreverDiferenca(null), null);
  assert.equal(formatarPeso(487), '0,487 kg');
});
