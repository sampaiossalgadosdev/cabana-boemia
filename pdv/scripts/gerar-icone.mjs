/**
 * Ícone do "Taaki PDV" (instalador, atalho, barra de tarefas e janela): o PDV é
 * um só para todas as lojas, então o ícone é da plataforma, não de uma loja.
 * PROVISÓRIO até o logo definitivo, na paleta do logo novo (a mesma das imagens
 * do app): quadrado de cantos arredondados azul-marinho #0A1428, pino laranja
 * #F26B1D, "Taaki" em branco e "PDV" em laranja claro #FD9502.
 * Usa o System.Drawing do Windows (o instalador só é gerado no Windows).
 * Saída: recursos/icon.png, 512×512 (gerado, fora do git; o electron-builder faz o .ico).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pdv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(pdv, 'recursos', 'icon.png');
const LADO = 512;

if (process.platform !== 'win32') {
  console.error('O ícone é gerado no Windows (System.Drawing).');
  process.exit(1);
}
fs.mkdirSync(path.dirname(saida), { recursive: true });

const ps = `
Add-Type -AssemblyName System.Drawing
$lado = ${LADO}
$bmp = New-Object System.Drawing.Bitmap $lado, $lado
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$marinho = [System.Drawing.ColorTranslator]::FromHtml('#0A1428')
$laranja = [System.Drawing.ColorTranslator]::FromHtml('#F26B1D')
$laranjaClaro = [System.Drawing.ColorTranslator]::FromHtml('#FD9502')
$branco = [System.Drawing.Color]::White
$raio = 96
$m = 8
$caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $raio * 2
$caminho.AddArc($m, $m, $d, $d, 180, 90)
$caminho.AddArc($lado - $m - $d, $m, $d, $d, 270, 90)
$caminho.AddArc($lado - $m - $d, $lado - $m - $d, $d, $d, 0, 90)
$caminho.AddArc($m, $lado - $m - $d, $d, $d, 90, 90)
$caminho.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $marinho), $caminho)
# pino
$cx = 256; $cy = 130; $r = 62
$pino = New-Object System.Drawing.Drawing2D.GraphicsPath
$pino.AddArc([float]($cx - $r), [float]($cy - $r), [float]($r * 2), [float]($r * 2), 150, 240)
$pino.AddLine([float]($cx + $r * 0.866), [float]($cy + $r * 0.5), [float]$cx, [float]($cy + $r * 1.9))
$pino.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $laranja), $pino)
$fr = $r * 0.42
$g.FillEllipse((New-Object System.Drawing.SolidBrush $marinho), [float]($cx - $fr), [float]($cy - $fr), [float]($fr * 2), [float]($fr * 2))
$centro = New-Object System.Drawing.StringFormat
$centro.Alignment = 'Center'
$centro.LineAlignment = 'Center'
$estilo = [System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic
$fonteMarca = New-Object System.Drawing.Font('Segoe UI', 132, $estilo, [System.Drawing.GraphicsUnit]::Pixel)
$fontePdv = New-Object System.Drawing.Font('Segoe UI', 84, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('Taaki', $fonteMarca, (New-Object System.Drawing.SolidBrush $branco), (New-Object System.Drawing.RectangleF 0, 238, $lado, 150), $centro)
$g.DrawString('PDV', $fontePdv, (New-Object System.Drawing.SolidBrush $laranjaClaro), (New-Object System.Drawing.RectangleF 0, 372, $lado, 100), $centro)
$bmp.Save($env:SAIDA, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  env: { ...process.env, SAIDA: saida },
  stdio: 'inherit',
});
console.log(`Ícone gerado: ${path.relative(pdv, saida)} (${LADO}×${LADO})`);
