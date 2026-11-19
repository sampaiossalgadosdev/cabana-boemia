# (Arquivo sem acentos no codigo: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
# Ícone e splash PROVISÓRIOS do app "Delivery Abatiá" (só texto nas cores da
# marca), até chegar a arte definitiva. Rodar no Windows e versionar os PNGs:
#   powershell -ExecutionPolicy Bypass -File app/scripts/gerar-imagens-provisorias.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$saida = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force $saida | Out-Null

$vermelho = [System.Drawing.ColorTranslator]::FromHtml('#C8102E')
$creme = [System.Drawing.ColorTranslator]::FromHtml('#FBF3E8')
$dourado = [System.Drawing.ColorTranslator]::FromHtml('#C9A646')

function Desenhar($arquivo, $largura, $altura, $fundo, $corTexto, $corLinha, $escala) {
  $bmp = New-Object System.Drawing.Bitmap $largura, $altura, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($fundo)
  $formato = New-Object System.Drawing.StringFormat
  $formato.Alignment = 'Center'
  $formato.LineAlignment = 'Center'
  $base = [Math]::Min($largura, $altura)
  $f1 = New-Object System.Drawing.Font 'Segoe UI', ([float]($base * 0.17 * $escala)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $f2 = New-Object System.Drawing.Font 'Segoe UI', ([float]($base * 0.13 * $escala)), ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
  $pincel = New-Object System.Drawing.SolidBrush $corTexto
  $cx = $largura / 2; $cy = $altura / 2
  $g.DrawString('Delivery', $f1, $pincel, (New-Object System.Drawing.RectangleF 0, ($cy - $base * 0.25 * $escala), $largura, ($base * 0.25 * $escala)), $formato)
  $g.DrawString(('Abati' + [char]0x00E1), $f2, $pincel, (New-Object System.Drawing.RectangleF 0, ($cy + $base * 0.03 * $escala), $largura, ($base * 0.2 * $escala)), $formato)
  $caneta = New-Object System.Drawing.Pen $corLinha, ([float]($base * 0.012 * $escala))
  $meia = $base * 0.18 * $escala
  $g.DrawLine($caneta, [float]($cx - $meia), [float]($cy + $base * 0.015 * $escala), [float]($cx + $meia), [float]($cy + $base * 0.015 * $escala))
  $g.Dispose()
  $bmp.Save((Join-Path $saida $arquivo), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$transparente = [System.Drawing.Color]::Transparent
$branco = [System.Drawing.Color]::White
# Ícone (iOS/geral): quadrado cheio.
Desenhar 'icone.png' 1024 1024 $vermelho $creme $dourado 1.25
# Android adaptativo: fundo vermelho vem do app.config; frente transparente,
# texto dentro do círculo de ~66% que o launcher recorta.
Desenhar 'icone-android-frente.png' 1024 1024 $transparente $creme $dourado 1.05
Desenhar 'icone-android-monocromatico.png' 1024 1024 $transparente $branco $branco 1.05
# Splash: só o texto (fundo vermelho vem do plugin expo-splash-screen).
Desenhar 'splash.png' 1024 1024 $transparente $creme $dourado 1.3
Write-Output "Imagens em $saida"
