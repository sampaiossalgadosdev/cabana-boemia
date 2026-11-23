# (Arquivo sem acentos no codigo: o PowerShell 5.1 le .ps1 sem BOM como ANSI.)
# Icone, icone adaptativo do Android, splash e imagens da ficha das lojas do
# app "Taaki Delivery". Rodar no Windows e versionar os PNGs:
#   powershell -ExecutionPolicy Bypass -File app/scripts/gerar-imagens.ps1
#
# PROVISORIO ate o logo definitivo: paleta do logo novo (azul-marinho #0A1428,
# laranja #F26B1D, laranja claro #FD9502, branco). O splash e o destaque do Play
# usam o logo em app/assets/brand/logo-taaki.png (ou .jpg), recortado no circulo
# (o fundo preto dos cantos fica de fora). Os icones sao desenhados (pino laranja
# + "Taaki" em branco): o logo inteiro fica ilegivel no tamanho de um icone.
#
# ARTE FINAL: se app/assets/marca/ tiver os arquivos abaixo, eles sao copiados
# como estao (nada e desenhado):
#   icone.png                       1024x1024, sem transparencia (iOS e geral)
#   icone-android-frente.png        1024x1024, transparente, simbolo dentro do circulo central de 66%
#   icone-android-monocromatico.png 1024x1024, transparente, uma cor so (Android 13+)
#   splash.png                      1024x1024, transparente (fundo vem do app.config)
#   icone-play-512.png              512x512 (ficha do Google Play)
#   destaque-play-1024x500.png      1024x500 (imagem de destaque do Google Play)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$assets = Join-Path $PSScriptRoot '..\assets'
$marca = Join-Path $assets 'marca'
$loja = Join-Path $assets 'loja'
New-Item -ItemType Directory -Force $loja | Out-Null

$marinho = [System.Drawing.ColorTranslator]::FromHtml('#0A1428')
$laranja = [System.Drawing.ColorTranslator]::FromHtml('#F26B1D')
$laranjaClaro = [System.Drawing.ColorTranslator]::FromHtml('#FD9502')
$branco = [System.Drawing.Color]::White
$transparente = [System.Drawing.Color]::Transparent
$MARCA_TEXTO = 'Taaki'

$logo = $null
foreach ($n in @('logo-taaki.png', 'logo-taaki.jpg')) {
  $p = Join-Path $assets "brand\$n"
  if (-not $logo -and (Test-Path $p)) { $logo = (Resolve-Path $p).Path }
}

function Novo($largura, $altura, $fundo) {
  $bmp = New-Object System.Drawing.Bitmap $largura, $altura, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($fundo)
  return @($bmp, $g)
}

# Pino de localizacao (cx, topo do circulo = cy - r); furo no meio.
function Pino($g, $cx, $cy, $r, $cor, $corFuro, $recortar = $false) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc([float]($cx - $r), [float]($cy - $r), [float]($r * 2), [float]($r * 2), 150, 240)
  $p.AddLine([float]($cx + $r * 0.866), [float]($cy + $r * 0.5), [float]$cx, [float]($cy + $r * 1.9))
  $p.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $cor), $p)
  $fr = $r * 0.42
  if ($recortar) {
    $g.CompositingMode = 'SourceCopy'
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 0, 0, 0))), [float]($cx - $fr), [float]($cy - $fr), [float]($fr * 2), [float]($fr * 2))
    $g.CompositingMode = 'SourceOver'
  } else {
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $corFuro), [float]($cx - $fr), [float]($cy - $fr), [float]($fr * 2), [float]($fr * 2))
  }
}

# Texto que cabe na largura: diminui a fonte ate caber. Devolve a largura usada.
function Texto($g, $texto, $tamanho, $estilo, $cor, $x, $y, $largura, $altura, $alinhar) {
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = $alinhar
  $fmt.LineAlignment = 'Center'
  do {
    $f = New-Object System.Drawing.Font 'Segoe UI', ([float]$tamanho), $estilo, ([System.Drawing.GraphicsUnit]::Pixel)
    $medida = $g.MeasureString($texto, $f)
    $tamanho = $tamanho - 2
  } while ($medida.Width -gt $largura -and $tamanho -gt 8)
  $g.DrawString($texto, $f, (New-Object System.Drawing.SolidBrush $cor), (New-Object System.Drawing.RectangleF $x, $y, $largura, $altura), $fmt)
  return $medida.Width
}

$negrito = [System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic

# Simbolo do icone: pino laranja + "Taaki" em branco, centrado em (cx, cy),
# dentro de um quadrado de lado t.
function Simbolo($g, $cx, $cy, $t, $corPino, $corFuro, $corTexto, $recortar = $false) {
  Pino $g $cx ($cy - $t * 0.20) ($t * 0.17) $corPino $corFuro $recortar
  Texto $g $MARCA_TEXTO ($t * 0.36) $negrito $corTexto ($cx - $t / 2) ($cy + $t * 0.06) $t ($t * 0.40) 'Center' | Out-Null
}

# Logo recortado no circulo (o fundo preto do JPEG fica de fora).
function Logo($g, $x, $y, $lado) {
  $img = [System.Drawing.Image]::FromFile($logo)
  $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
  $clip.AddEllipse([float]($x + $lado * 0.004), [float]($y + $lado * 0.004), [float]($lado * 0.992), [float]($lado * 0.992))
  $g.SetClip($clip)
  $g.DrawImage($img, [float]$x, [float]$y, [float]$lado, [float]$lado)
  $g.ResetClip()
  $img.Dispose()
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
  $b, $g = Novo 1024 1024 $marinho
  Simbolo $g 512 512 760 $laranja $marinho $branco
  Salvar $b $g $arq
}
# Android adaptativo: o fundo #0A1428 vem do app.config; o simbolo fica bem
# dentro do circulo central de 66% (o launcher recorta circulo, gota, quadrado...).
Gerar 'icone-android-frente.png' (Join-Path $assets 'icone-android-frente.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $transparente
  Simbolo $g 512 512 500 $laranja $marinho $branco
  Salvar $b $g $arq
}
Gerar 'icone-android-monocromatico.png' (Join-Path $assets 'icone-android-monocromatico.png') {
  param($arq)
  $b, $g = Novo 1024 1024 $transparente
  Simbolo $g 512 512 500 $branco $branco $branco $true
  Salvar $b $g $arq
}
# Splash: o logo (fundo #0A1428 vem do plugin expo-splash-screen).
Gerar 'splash.png' (Join-Path $assets 'splash.png') {
  param($arq)
  if (-not $logo) { throw 'Falta app/assets/brand/logo-taaki.png (ou .jpg) para o splash.' }
  $b, $g = Novo 1024 1024 $transparente
  Logo $g 0 0 1024
  Salvar $b $g $arq
}
# Ficha do Google Play: icone 512 e imagem de destaque 1024x500.
Gerar 'icone-play-512.png' (Join-Path $loja 'icone-play-512.png') {
  param($arq)
  $b, $g = Novo 512 512 $marinho
  Simbolo $g 256 256 380 $laranja $marinho $branco
  Salvar $b $g $arq
}
Gerar 'destaque-play-1024x500.png' (Join-Path $loja 'destaque-play-1024x500.png') {
  param($arq)
  $b, $g = Novo 1024 500 $marinho
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $laranja), 0, 484, 1024, 16)
  if ($logo) { Logo $g 50 40 404 } else { Simbolo $g 250 240 380 $laranja $marinho $branco }
  Texto $g $MARCA_TEXTO 120 $negrito $branco 490 90 500 140 'Near' | Out-Null
  Texto $g 'Delivery' 72 $negrito $laranja 494 220 500 100 'Near' | Out-Null
  Texto $g ('Comida, bebida e mais de Abati' + [char]0x00E1 + ' e regi' + [char]0x00E3 + 'o') 30 ([System.Drawing.FontStyle]::Regular) $laranjaClaro 498 330 500 60 'Near' | Out-Null
  Salvar $b $g $arq
}
Write-Output "Imagens em $assets"
