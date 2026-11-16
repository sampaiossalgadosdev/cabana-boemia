/**
 * Ícone do instalador/atalho a partir da logo única (shared/assets).
 * A logo é larga (811×344) e o ícone precisa ser quadrado: centraliza a logo
 * num quadrado creme de 512 px (o electron-builder gera o .ico a partir dele).
 * Usa o System.Drawing do Windows (o instalador só é gerado no Windows).
 * Saída: recursos/icon.png (gerado, fora do git).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pdv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = path.resolve(pdv, '..', 'shared', 'assets', 'logo-cabana-boemia.jpg');
const saida = path.join(pdv, 'recursos', 'icon.png');
const LADO = 512;
const CREME = '#FBF3E8';

if (process.platform !== 'win32') {
  console.error('O ícone é gerado no Windows (System.Drawing).');
  process.exit(1);
}
if (!fs.existsSync(logo)) {
  console.error(`Logo não encontrada: ${logo}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(saida), { recursive: true });

const ps = `
Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile($env:LOGO)
$lado = ${LADO}
$bmp = New-Object System.Drawing.Bitmap $lado, $lado
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'
$g.Clear([System.Drawing.ColorTranslator]::FromHtml('${CREME}'))
$margem = [int]($lado * 0.04)
$largura = $lado - 2 * $margem
$altura = [int]($largura * $logo.Height / $logo.Width)
$g.DrawImage($logo, $margem, [int](($lado - $altura) / 2), $largura, $altura)
$bmp.Save($env:SAIDA, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $logo.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  env: { ...process.env, LOGO: logo, SAIDA: saida },
  stdio: 'inherit',
});
console.log(`Ícone gerado: ${path.relative(pdv, saida)} (${LADO}×${LADO})`);
