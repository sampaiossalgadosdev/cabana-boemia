/**
 * Plugin do Vite (só no build): grava dist/sw.js a partir do modelo pwa/sw.js,
 * com a lista de arquivos estáticos do build para pré-carregar e uma versão
 * tirada do conteúdo do build. Qualquer mudança no site muda o sw.js, o
 * navegador instala a versão nova e ela apaga o cache antigo.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODELO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sw.js');

/** O que entra no pré-carregamento (o mesmo critério do `estrategia` do sw.js). */
export const PRE_CARREGAR = /^\/((assets|icones|splash|confirmacao)\/.+|offline\.html)$/;

/** Lista os arquivos de `dir` como caminhos de URL ("/assets/x.js"), em ordem. */
export function listarArquivos(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((item) => {
      const completo = path.join(dir, item.name);
      if (item.isDirectory()) return listarArquivos(completo, base);
      return ['/' + path.relative(base, completo).split(path.sep).join('/')];
    })
    .sort();
}

/** Preenche o modelo do service worker. */
export function montarSw(modelo, { versao, arquivos }) {
  const marcaArquivos = /\/\*ARQUIVOS\*\/\[\]\/\*FIM\*\//;
  if (!modelo.includes("'__VERSAO__'") || !marcaArquivos.test(modelo)) {
    throw new Error('Modelo do service worker sem as marcas de versão/arquivos.');
  }
  return modelo
    .replace("'__VERSAO__'", JSON.stringify(versao))
    .replace(marcaArquivos, JSON.stringify(arquivos));
}

/** Versão + lista a partir de um build pronto (`dist`, ainda sem o sw.js). */
export function swDoBuild(dist, modelo = fs.readFileSync(MODELO, 'utf8')) {
  const todos = listarArquivos(dist).filter((f) => f !== '/sw.js' && !f.endsWith('.map'));
  const hash = crypto.createHash('sha256');
  for (const arquivo of todos) {
    hash.update(arquivo);
    hash.update(fs.readFileSync(path.join(dist, arquivo)));
  }
  hash.update(modelo);
  const versao = hash.digest('hex').slice(0, 12);
  return montarSw(modelo, { versao, arquivos: todos.filter((f) => PRE_CARREGAR.test(f)) });
}

export function pluginSw() {
  let dist;
  return {
    name: 'cabana-service-worker',
    apply: 'build',
    configResolved(config) {
      dist = path.resolve(config.root, config.build.outDir);
    },
    // writeBundle: tudo (bundle + public/) já está no disco.
    writeBundle() {
      fs.writeFileSync(path.join(dist, 'sw.js'), swDoBuild(dist));
    },
  };
}
