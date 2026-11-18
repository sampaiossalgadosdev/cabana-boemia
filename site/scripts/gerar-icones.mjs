/**
 * Ícones do PWA a partir da logo única (shared/assets), no `dev` e no `build`
 * do site. Usa o recorte transparente (só o laço) sobre um quadrado creme
 * sólido, com a logo centralizada. JavaScript puro (pngjs), sem binário
 * nativo: o build do Railway roda em Linux.
 * Saída: site/public/icones/ (gerado, fora do git).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOGO = path.resolve(site, '..', 'shared', 'assets', 'logo-cabana-boemia-recorte.png');
export const DESTINO = path.join(site, 'public', 'icones');
export const CREME = [0xfb, 0xf3, 0xe8];

/**
 * `largura` = fração do lado ocupada pela logo. A maskable fica menor: o
 * Android recorta tudo fora do círculo de 80% do lado (zona segura); a logo
 * (≈3:1) com 75% do lado tem a diagonal dentro desse círculo.
 * O iOS arredonda os cantos do apple-touch-icon, então ele também tem folga.
 */
export const ICONES = [
  { arquivo: 'icone-192.png', lado: 192, largura: 0.84 },
  { arquivo: 'icone-512.png', lado: 512, largura: 0.84 },
  { arquivo: 'icone-maskable-512.png', lado: 512, largura: 0.72 },
  { arquivo: 'apple-touch-icon.png', lado: 180, largura: 0.8 },
];

/** Recorta as bordas totalmente transparentes. */
function aparar(png) {
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('Logo totalmente transparente.');
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Faixas da origem que cobrem cada pixel do destino, com o peso de cada uma (média por área). */
function cobertura(tamOrigem, tamDestino) {
  const escala = tamOrigem / tamDestino;
  return Array.from({ length: tamDestino }, (_, d) => {
    const ini = d * escala;
    const fim = (d + 1) * escala;
    const faixas = [];
    for (let s = Math.floor(ini); s < Math.ceil(fim); s++) {
      const peso = Math.min(fim, s + 1) - Math.max(ini, s);
      if (peso > 0) faixas.push([s, peso]);
    }
    return faixas;
  });
}

/** Desenha a logo reduzida e centralizada num quadrado creme sólido. */
export function desenharIcone(logo, caixa, lado, largura) {
  const w = Math.round(lado * largura);
  const h = Math.max(1, Math.round((w * caixa.h) / caixa.w));
  const ox = Math.round((lado - w) / 2);
  const oy = Math.round((lado - h) / 2);
  const png = new PNG({ width: lado, height: lado, colorType: 2 });
  for (let i = 0; i < lado * lado; i++) {
    png.data[i * 4] = CREME[0];
    png.data[i * 4 + 1] = CREME[1];
    png.data[i * 4 + 2] = CREME[2];
    png.data[i * 4 + 3] = 255;
  }
  const colunas = cobertura(caixa.w, w);
  const linhas = cobertura(caixa.h, h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      // Média com alfa pré-multiplicado (bordas sem halo escuro).
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (const [sy, py] of linhas[dy]) {
        for (const [sx, px] of colunas[dx]) {
          const p = ((caixa.y0 + sy) * logo.width + caixa.x0 + sx) * 4;
          const peso = py * px;
          const alfa = (logo.data[p + 3] / 255) * peso;
          r += logo.data[p] * alfa;
          g += logo.data[p + 1] * alfa;
          b += logo.data[p + 2] * alfa;
          a += alfa;
          total += peso;
        }
      }
      const cobertura = a / total;
      const q = ((oy + dy) * lado + ox + dx) * 4;
      png.data[q] = Math.round(r / total + (1 - cobertura) * CREME[0]);
      png.data[q + 1] = Math.round(g / total + (1 - cobertura) * CREME[1]);
      png.data[q + 2] = Math.round(b / total + (1 - cobertura) * CREME[2]);
    }
  }
  // Sem canal alfa: fundo sólido (o iOS pinta de preto o que for transparente).
  return PNG.sync.write(png, { colorType: 2 });
}

/** Gera todos os ícones em `destino`. @returns {string[]} caminhos gravados */
export function gerarIcones({ logo = LOGO, destino = DESTINO } = {}) {
  if (!fs.existsSync(logo)) throw new Error(`Logo não encontrada: ${logo}`);
  const png = PNG.sync.read(fs.readFileSync(logo));
  const caixa = aparar(png);
  fs.mkdirSync(destino, { recursive: true });
  return ICONES.map(({ arquivo, lado, largura }) => {
    const saida = path.join(destino, arquivo);
    fs.writeFileSync(saida, desenharIcone(png, caixa, lado, largura));
    return saida;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const arquivo of gerarIcones()) console.log(`ícone: ${path.relative(site, arquivo)}`);
  } catch (erro) {
    console.error(erro.message);
    process.exit(1);
  }
}
