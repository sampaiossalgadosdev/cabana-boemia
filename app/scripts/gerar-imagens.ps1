# (Arquivo sem acentos no codigo: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
# Icone, icone adaptativo do Android, splash e imagens da ficha das lojas do
# app "Delivery Abatia". Rodar no Windows e versionar os PNGs:
#   powershell -ExecutionPolicy Bypass -File app/scripts/gerar-imagens.ps1
#
# ARTE FINAL: se app/assets/marca/ tiver os arquivos abaixo, eles sao copiados
# como estao (nada e desenhado):
#   icone.png                       1024x1024, sem transparencia (iOS e geral)
#   icone-android-frente.png        1024x1024, transparente, simbolo dentro do circulo central de 66%
#   icone-android-monocromatico.png 1024x1024, transparente, uma cor so (Android 13+)
#   splash.png                      1024x1024, transparente (fundo vem do app.config)
#   icone-play-512.png              512x512 (ficha do Google Play)
#   destaque-play-1024x500.png      1024x500 (imagem de destaque do Google Play)
# Faltou algum: esse e desenhado (PROVISORIO: sacola creme sobre vermelho).
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$assets = Join-Path $PSScriptRoot '..\assets'
$marca = Join-Path $assets 'marca'
$loja = Join-Path $assets 'loja'
New-Item -ItemType Directory -Force $loja | Out-Null

$vermelho = [System.Drawing.ColorTranslator]::FromHtml('#C8102E')
$vermelhoEscuro = [System.Drawing.ColorTranslator]::FromHtml('#9E0B22')
$creme = [System.Drawing.ColorTranslator]::FromHtml('#FBF3E8')
$dourado = [System.Drawing.ColorTranslator]::FromHtml('#C9A646')
$branco = [System.Drawing.Color]::White
$transparente = [System.Drawing.Color]::Transparent
$nomeAbatia = 'Abati' + [char]0x00E1

function Novo($largura, $altura, $fundo) {
  $bmp = New-Object System.Drawing.Bitmap $largura, $altura, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($fundo)
  return @($bmp, $g)
}

function RetanguloRedondo($x, $y, $l, $a, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $l - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $l - $d, $y + $a - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $a - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Sacola de entrega com alca e um pino de localizacao (o "delivery da cidade").
# (cx, cy) = centro; t = altura total do simbolo em pixels.
# $recortar: o pino vira um buraco transparente (icone monocromatico).
function Sacola($g, $cx, $cy, $t, $corSacola, $corPino, $corFuro, $recortar = $false) {
  # Sacola de compras (corpo mais alto que largo, mais largo embaixo, alca fina e
  # estreita): nao pode lembrar um cadeado.
  $a = $t * 0.74
  $lTopo = $t * 0.58; $lBase = $t * 0.68
  $y = $cy - $t / 2 + $t * 0.26
  $x = $cx - $lBase / 2; $l = $lBase
  # alca: arco estreito saindo de dentro da boca da sacola
  $caneta = New-Object System.Drawing.Pen $corSacola, ([float]($t * 0.045))
  $g.DrawArc($caneta, [float]($cx - $t * 0.14), [float]($cy - $t / 2), [float]($t * 0.28), [float]($t * 0.40), 180, 180)
  $g.DrawLine($caneta, [float]($cx - $t * 0.14), [float]($cy - $t / 2 + $t * 0.20), [float]($cx - $t * 0.14), [float]($y + $t * 0.02))
  $g.DrawLine($caneta, [float]($cx + $t * 0.14), [float]($cy - $t / 2 + $t * 0.20), [float]($cx + $t * 0.14), [float]($y + $t * 0.02))
  # corpo (trapezio com cantos de baixo arredondados)
  $r = $t * 0.06
  $corpo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $corpo.AddLine([float]($cx - $lTopo / 2), [float]$y, [float]($cx + $lTopo / 2), [float]$y)
  $corpo.AddLine([float]($cx + $lTopo / 2), [float]$y, [float]($cx + $lBase / 2), [float]($y + $a - $r))
  $corpo.AddArc([float]($cx + $lBase / 2 - 2 * $r), [float]($y + $a - 2 * $r), [float](2 * $r), [float](2 * $r), 0, 90)
  $corpo.AddArc([float]($cx - $lBase / 2), [float]($y + $a - 2 * $r), [float](2 * $r), [float](2 * $r), 90, 90)
  $corpo.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $corSacola), $corpo)
  # pino
  $pr = $t * 0.17
  $px = $cx; $py = $y + $a * 0.40
  $pino = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pino.AddArc([float]($px - $pr), [float]($py - $pr), [float]($pr * 2), [float]($pr * 2), 150, 240)
  $pino.AddLine([float]($px + $pr * 0.866), [float]($py + $pr * 0.5), [float]$px, [float]($py + $pr * 1.9))
  $pino.CloseFigure()
  if ($recortar) {
    $g.CompositingMode = 'SourceCopy'
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 0, 0, 0))), $pino)
    $g.CompositingMode = 'SourceOver'
    return
  }
  $g.FillPath((New-Object System.Drawing.SolidBrush $corPino), $pino)
  $fr = $pr * 0.42
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $corFuro), [float]($px - $fr), [float]($py - $fr), [float]($fr * 2), [float]($fr * 2))
}

function Texto($g, $texto, $tamanho, $estilo, $cor, $x, $y, $largura, $altura, $alinhar) {
  $f = New-Object System.Drawing.Font 'Segoe UI', ([float]$tamanho), $estilo, ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = $alinhar
  $fmt.LineAlignment = 'Center'
  $g.DrawString($texto, $f, (New-Object System.Drawing.SolidBrush $cor), (New-Object System.Drawing.RectangleF $x, $y, $largura, $altura), $fmt)
}

function Salvar($bmp, $g, $arquivo) {
  $g.Dispose()
  $bmp.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Gerar($nome, $destino, $desenhar) {
  $arte = Join-Path $marca $nome
  if (Test-Path $arte) {
    Copy-Item $arte $destino -Force
    Write-Output "arte final: $nome"
  } else {
    & $desenhar $destino
    Write-Output "PROVISORIO: $nome"
  }
}

# Icone geral/iOS: quadrado cheio (a App Store recusa transparencia).
Gerar 'icone.png' (Join-Path $assets 'icone.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $vermelho
  Sacola $g 512 500 600 $creme $dourado $vermelho
  Salvar $b $g $arq
}
# Android adaptativo: o fundo vermelho vem do app.config; o simbolo fica dentro
# do circulo central de 66% (o launcher recorta circulo, gota, quadrado...).
Gerar 'icone-android-frente.png' (Join-Path $assets 'icone-android-frente.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $transparente
  Sacola $g 512 500 430 $creme $dourado $vermelho
  Salvar $b $g $arq
}
Gerar 'icone-android-monocromatico.png' (Join-Path $assets 'icone-android-monocromatico.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $transparente
  Sacola $g 512 500 430 $branco $branco $branco $true
  Salvar $b $g $arq
}
# Splash: simbolo + nome (fundo vermelho vem do plugin expo-splash-screen).
Gerar 'splash.png' (Join-Path $assets 'splash.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $transparente
  Sacola $g 512 380 440 $creme $dourado $vermelho
  Texto $g 'Delivery' 128 ([System.Drawing.FontStyle]::Bold) $creme 0 640 1024 150 'Center'
  Texto $g $nomeAbatia 96 ([System.Drawing.FontStyle]::Regular) $dourado 0 780 1024 120 'Center'
  Salvar $b $g $arq
}
# Ficha do Google Play: icone 512 e imagem de destaque 1024x500.
Gerar 'icone-play-512.png' (Join-Path $loja 'icone-play-512.png') {
  param($arq)
  $b, $g = Novo 512 512 $vermelho
  Sacola $g 256 250 300 $creme $dourado $vermelho
  Salvar $b $g $arq
}
Gerar 'destaque-play-1024x500.png' (Join-Path $loja 'destaque-play-1024x500.png') {
  param($arq)
  $b, $g = Novo 1024 500 $vermelho
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $vermelhoEscuro), 0, 440, 1024, 60)
  Sacola $g 250 235 300 $creme $dourado $vermelho
  Texto $g 'Delivery' 104 ([System.Drawing.FontStyle]::Bold) $creme 430 120 580 130 'Near'
  Texto $g $nomeAbatia 80 ([System.Drawing.FontStyle]::Regular) $dourado 434 235 580 110 'Near'
  Texto $g ('As lojas da cidade num app s' + [char]0x00F3) 34 ([System.Drawing.FontStyle]::Regular) $creme 438 340 580 60 'Near'
  Salvar $b $g $arq
}
Write-Output "Imagens em $assets"
