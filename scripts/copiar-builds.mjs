/**
 * Copia os builds do site e da retaguarda para dentro da API, que os serve
 * em / e /admin (`api/src/lib/estaticos.js`). Roda no `npm run build` da raiz.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copias = [
  ['site/dist', 'api/public/site'],
  ['retaguarda/dist', 'api/public/admin'],
];

for (const [de, para] of copias) {
  const origem = path.join(raiz, de);
  const destino = path.join(raiz, para);
  if (!fs.existsSync(path.join(origem, 'index.html'))) {
    console.error(`Build não encontrado: ${de}/index.html (rode o build do workspace antes).`);
    process.exit(1);
  }
  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origem, destino, { recursive: true });
  console.log(`${de} → ${para}`);
}
