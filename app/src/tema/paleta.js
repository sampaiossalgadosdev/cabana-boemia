/**
 * Paleta do Taaki Delivery (do logo) e as cores do tema padrão do app. Sem
 * React Native aqui: o contraste é conferido em test/tema-taaki.test.js com a
 * mesma regra do shared (texto 4,5:1; ícone/borda 3:1).
 */
export const marcaTaaki = Object.freeze({
  marinho: '#0A1428',
  laranja: '#F26B1D',
  laranjaClaro: '#FD9502',
  branco: '#FFFFFF',
  // Destaque vermelho: pouco (só alerta e erro).
  destaque: '#E02502',
  // Laranja escurecido: texto/link laranja sobre fundo claro (5,5:1 no branco;
  // o laranja puro dá só 3:1, bom para ícone e borda, não para texto).
  laranjaTexto: '#B4470A',
  // Destaque escurecido para texto de erro (≥ 4,5:1 também no fundo do alerta).
  erro: '#C21F02',
});

export const coresTaaki = Object.freeze({
  fundo: '#F5F7FA',
  superficie: marcaTaaki.branco,
  texto: marcaTaaki.marinho,
  textoSuave: '#4B5568',
  // Texto sobre o cabeçalho (marinho).
  textoInverso: marcaTaaki.branco,
  borda: '#DCE2EA',
  preco: marcaTaaki.laranjaTexto,
  // Botão principal laranja com texto marinho (6:1; branco daria 3:1). Apertado: laranja claro.
  acao: marcaTaaki.laranja,
  acaoPressionada: marcaTaaki.laranjaClaro,
  textoAcao: marcaTaaki.marinho,
  // Texto e links na cor de ação sobre fundo claro.
  acaoTexto: marcaTaaki.laranjaTexto,
  destaque: marcaTaaki.laranjaClaro,
  cabecalho: marcaTaaki.marinho,
  desabilitado: '#D5DBE3',
  textoDesabilitado: '#5F6B7A',
  avisoFundo: '#FFF1E6',
  aviso: marcaTaaki.destaque,
  erro: marcaTaaki.erro,
  sucesso: '#2E7D4F',
  sombra: marcaTaaki.marinho,
  placeholder: '#E9EDF2',
  // Etiqueta "Patrocinado" sobre a imagem do anúncio (legível sobre qualquer foto).
  sobreImagemFundo: 'rgba(10,20,40,0.8)',
  sobreImagemTexto: marcaTaaki.branco,
});
