/**
 * Ícone do "PDV do Abatiá" (instalador, atalho, barra de tarefas): o PDV é um
 * só para todas as lojas, então o ícone é da plataforma, não de uma loja.
 * Quadrado de cantos arredondados no vermelho do Delivery Abatiá, "PDV" em
 * creme e "Abatiá" em dourado (as cores do ícone provisório do app).
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

// O PowerShell 5.1 lê o script sem BOM como ANSI: o "á" vai como [char]0x00E1.
const ps = `
Add-Type -AssemblyName System.Drawing
$lado = ${LADO}
$bmp = New-Object System.Drawing.Bitmap $lado, $lado
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'HighQuality'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear([System.Drawing.Color]::Transparent)
$vermelho = [System.Drawing.ColorTranslator]::FromHtml('#C8102E')
$creme = [System.Drawing.ColorTranslator]::FromHtml('#FBF3E8')
$dourado = [System.Drawing.ColorTranslator]::FromHtml('#C9A646')
$raio = 96
$m = 8
$caminho = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $raio * 2
$caminho.AddArc($m, $m, $d, $d, 180, 90)
$caminho.AddArc($lado - $m - $d, $m, $d, $d, 270, 90)
$caminho.AddArc($lado - $m - $d, $lado - $m - $d, $d, $d, 0, 90)
$caminho.AddArc($m, $lado - $m - $d, $d, $d, 90, 90)
$caminho.CloseFigure()
$g.FillPath((New-Object System.Drawing.SolidBrush $vermelho), $caminho)
$centro = New-Object System.Drawing.StringFormat
$centro.Alignment = 'Center'
$centro.LineAlignment = 'Center'
$fonteGrande = New-Object System.Drawing.Font('Segoe UI', 150, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fontePequena = New-Object System.Drawing.Font('Segoe UI', 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('PDV', $fonteGrande, (New-Object System.Drawing.SolidBrush $creme), (New-Object System.Drawing.RectangleF 0, 70, $lado, 220), $centro)
$g.FillRectangle((New-Object System.Drawing.SolidBrush $dourado), 136, 300, 240, 8)
$abatia = 'Abati' + [char]0x00E1
$g.DrawString($abatia, $fontePequena, (New-Object System.Drawing.SolidBrush $creme), (New-Object System.Drawing.RectangleF 0, 318, $lado, 110), $centro)
$bmp.Save($env:SAIDA, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;

execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  env: { ...process.env, SAIDA: saida },
  stdio: 'inherit',
});
console.log(`Ícone gerado: ${path.relative(pdv, saida)} (${LADO}×${LADO})`);
