/**
 * Gera a logo da loja de teste (prisma/cardapios/loja-teste-logo.png): um
 * selo verde com um "T" branco, PNG com transparência, sem biblioteca nativa
 * (zlib do Node). Rodar só se quiser refazer a imagem:
 *   node api/scripts/gerar-logo-teste.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const LARGURA = 480;
const ALTURA = 200;
const VERDE = [30, 123, 60];
const BRANCO = [255, 255, 255];

const px = new Uint8Array(LARGURA * ALTURA * 4); // RGBA, transparente

function pintar(x, y, [r, g, b], a = 255) {
  const i = (y * LARGURA + x) * 4;
  px.set([r, g, b, a], i);
}

// Selo: retângulo de cantos redondos (raio 40) com borda branca de 8 px.
const RAIO = 40;
const dentro = (x, y, margem) => {
  const x0 = margem;
  const y0 = margem;
  const x1 = LARGURA - 1 - margem;
  const y1 = ALTURA - 1 - margem;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const r = RAIO - margem / 2;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
for (let y = 0; y < ALTURA; y++) {
  for (let x = 0; x < LARGURA; x++) {
    if (dentro(x, y, 0)) pintar(x, y, BRANCO);
    if (dentro(x, y, 8)) pintar(x, y, VERDE);
  }
}

// "T" estilizado e uma linha embaixo (sem fonte: só retângulos).
const retangulo = (x0, y0, w, h, cor) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pintar(x, y, cor);
};
retangulo(170, 40, 140, 26, BRANCO); // barra do T
retangulo(227, 66, 26, 84, BRANCO); // haste do T
retangulo(110, 160, 260, 8, BRANCO); // linha

// PNG: assinatura + IHDR + IDAT (filtro 0 por linha) + IEND.
function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(corpo) >>> 0);
  return Buffer.concat([tamanho, corpo, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(LARGURA, 0);
ihdr.writeUInt32BE(ALTURA, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
const linhas = Buffer.alloc(ALTURA * (LARGURA * 4 + 1));
for (let y = 0; y < ALTURA; y++) {
  linhas[y * (LARGURA * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * LARGURA * 4, LARGURA * 4).copy(linhas, y * (LARGURA * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  bloco('IHDR', ihdr),
  bloco('IDAT', zlib.deflateSync(linhas, { level: 9 })),
  bloco('IEND', Buffer.alloc(0)),
]);

const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '../prisma/cardapios/loja-teste-logo.png');
writeFileSync(destino, png);
console.log(`${destino} (${png.length} bytes)`);
