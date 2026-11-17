import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A migration produto_imagem_url põe as fotos provisórias por NOME do produto.
// Nome digitado errado = produto sem foto em produção, sem erro nenhum.
test('fotos provisórias da migration apontam para produtos que existem no cardápio do seed', () => {
  const sql = fs.readFileSync(path.join(raiz, 'prisma/migrations/20261117150000_produto_imagem_url/migration.sql'), 'utf8');
  const pares = [...sql.matchAll(/\('([^']+)', '([0-9a-f]+-[0-9a-f]+)'\)/g)].map((m) => m[1]);
  assert.ok(pares.length >= 20, `achou ${pares.length} fotos`);

  const cardapio = JSON.parse(fs.readFileSync(path.join(raiz, 'prisma/cardapio-cabana-boemia.json'), 'utf8'));
  const nomes = new Set(cardapio.categorias.flatMap((c) => c.produtos.map((p) => p.nome)));
  for (const nome of pares) assert.ok(nomes.has(nome), `"${nome}" não existe no cardápio`);
  assert.equal(new Set(pares).size, pares.length, 'produto repetido na lista');
});
