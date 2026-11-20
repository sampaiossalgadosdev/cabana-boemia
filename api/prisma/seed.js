/**
 * Seed idempotente de UMA loja e do cardápio dela, a partir de um JSON
 * (padrão: cardapio-cabana-boemia.json, a Cabana Boemia). Outra loja:
 * `npm run seed -w api -- --cardapio prisma/cardapios/<arquivo>.json`.
 *
 * O bloco "loja" do JSON diz qual loja (slug) e, só na criação, a cor e a
 * logo PADRÃO (arquivo relativo ao JSON). "pratoPorKg": true acrescenta o
 * "Prato por kg" (padrão: só na Cabana). "areaEntrega" acrescenta bairros
 * (na lista da cidade, se faltarem) à área da loja, com a taxa, só se ainda
 * não estiverem nela.
 *
 * Política (ver CLAUDE.md › Seed): cria o que falta e NUNCA sobrescreve o que o
 * dono pode editar (preço, ativo, disponivelHoje, descrição, estoque, horários,
 * configuração, cor e logo da loja, taxas). Em registro existente só atualiza a
 * estrutura (categoria/ordem) e acrescenta vínculos ProdutoTurno/ProdutoInsumo
 * que faltarem. Tudo por loja: os nomes são únicos dentro da loja (upsert por
 * [lojaId, nome]).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
export const CAMINHO_JSON = path.join(PASTA, 'cardapio-cabana-boemia.json');
const TIPOS_LOGO = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LOGO_BYTES = 500 * 1024;

const DIAS = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

/**
 * Mesmo slug de src/services/loja.service.js (SLUG_LOJA_PADRAO): a migration
 * multi_loja já cria a loja. Vale para JSON sem bloco "loja".
 */
export const LOJA_CABANA = {
  slug: 'cabana-boemia',
  corPrimaria: '#C8102E',
  corFundo: '#FBF3E8',
};

const PRATO_POR_KG = {
  nome: 'Prato por kg',
  descricao: '',
  categoria: 'Pratos',
  turnos: ['Almoço'],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function semAcento(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function diaSemana(dia) {
  const n = DIAS[semAcento(dia)];
  if (n === undefined) throw new Error(`Dia da semana desconhecido no JSON: "${dia}"`);
  return n;
}

export async function lerCardapio(caminho = CAMINHO_JSON) {
  return JSON.parse(await readFile(caminho, 'utf8'));
}

/** Arquivo da logo (relativo ao JSON) → { mime, dados }; só PNG/JPEG/WebP até 500 KB. */
async function lerLogo(arquivo, pastaJson) {
  const caminho = path.resolve(pastaJson, arquivo);
  const mime = TIPOS_LOGO[path.extname(caminho).toLowerCase()];
  if (!mime) throw new Error(`Logo "${arquivo}": use PNG, JPEG ou WebP`);
  const dados = await readFile(caminho);
  if (dados.length === 0 || dados.length > MAX_LOGO_BYTES) throw new Error(`Logo "${arquivo}": vazia ou com mais de 500 KB`);
  return { mime, dados };
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ cardapio?: any, caminho?: string, log?: (msg: string) => void }} [opcoes]
 *   `caminho`: o JSON (padrão: o da Cabana); `cardapio`: o JSON já lido (a logo é relativa a `caminho`)
 * @returns {Promise<string[]>} avisos emitidos
 */
export async function seed(prisma, { cardapio, caminho = CAMINHO_JSON, log = console.log } = {}) {
  cardapio ??= await lerCardapio(caminho);
  const dadosLoja = { ...LOJA_CABANA, ...(cardapio.loja ?? {}) };
  if (!SLUG.test(dadosLoja.slug ?? '')) throw new Error(`Slug da loja inválido no JSON: "${dadosLoja.slug}"`);
  const logo = dadosLoja.logo ? await lerLogo(dadosLoja.logo, path.dirname(caminho)) : null;
  const pratoPorKg = cardapio.pratoPorKg ?? dadosLoja.slug === LOJA_CABANA.slug;
  const avisos = [];
  const avisar = (msg) => {
    avisos.push(msg);
    log(`⚠️  ${msg}`);
  };

  await prisma.$transaction(
    async (tx) => {
      // ── Loja (a da Cabana a migration multi_loja já cria; aqui só se faltar). ──
      // A cor e a logo do JSON são o PADRÃO da loja; nada do que já existe é sobrescrito.
      const cor = dadosLoja.corPrimaria ?? null;
      let loja = await tx.loja.upsert({
        where: { slug: dadosLoja.slug },
        create: {
          slug: dadosLoja.slug,
          nome: cardapio.restaurante.nome,
          corPrimaria: cor,
          corPrimariaPadrao: cor,
          corFundo: dadosLoja.corFundo ?? null,
          descricao: dadosLoja.descricao ?? null,
          ...(dadosLoja.ordem != null && { ordem: dadosLoja.ordem }),
        },
        update: {},
      });
      const lojaId = loja.id;
      if (loja.corPrimariaPadrao == null && cor) {
        loja = await tx.loja.update({
          where: { id: lojaId },
          data: { corPrimariaPadrao: cor, ...(loja.corPrimaria == null && { corPrimaria: cor }) },
        });
      }
      if (logo && loja.logoUrlPadrao == null) {
        const img = await tx.imagemLoja.create({ data: { lojaId, ...logo }, select: { id: true } });
        const url = `/api/publico/imagens/${img.id}`;
        loja = await tx.loja.update({
          where: { id: lojaId },
          data: { logoUrlPadrao: url, ...(loja.logoUrl == null && { logoUrl: url }) },
        });
      }
      if (!loja.whatsapp) {
        avisar(`WhatsApp da loja vazio (${loja.nome}): defina na retaguarda (Configurações; usado no link wa.me).`);
      }

      // ── Turnos e horários ──
      const turnoId = new Map();
      for (const t of cardapio.turnos) {
        const turno = await tx.turno.upsert({
          where: { lojaId_nome: { lojaId, nome: t.nome } },
          create: { lojaId, nome: t.nome },
          update: {},
        });
        turnoId.set(t.nome, turno.id);

        const existentes = await tx.horarioTurno.count({ where: { turnoId: turno.id } });
        if (existentes === 0 && t.horarios.length > 0) {
          await tx.horarioTurno.createMany({
            data: t.horarios.map((h) => {
              if (!HHMM.test(h.inicio) || !HHMM.test(h.fim)) {
                throw new Error(`Horário inválido em ${t.nome}/${h.dia}: ${h.inicio}-${h.fim}`);
              }
              return { turnoId: turno.id, diaSemana: diaSemana(h.dia), inicio: h.inicio, fim: h.fim };
            }),
          });
        } else if (existentes === 0) {
          avisar(`Turno "${t.nome}" sem horários: nunca ficará ativo até o dono cadastrar.`);
        }
      }

      // ── Insumos ──
      const insumoId = new Map();
      for (const i of cardapio.insumos ?? []) {
        const insumo = await tx.insumo.upsert({
          where: { lojaId_nome: { lojaId, nome: i.nome } },
          create: { lojaId, nome: i.nome, estoque: i.estoque_inicial ?? 0, estoqueMinimo: 0 },
          update: {},
        });
        insumoId.set(i.nome, insumo.id);
      }

      // ── Área de entrega (bairros da cidade + taxa): só acrescenta o que falta ──
      for (const a of cardapio.areaEntrega ?? []) {
        const bairro = await tx.bairro.upsert({ where: { nome: a.bairro }, create: { nome: a.bairro }, update: {} });
        await tx.areaEntrega.upsert({
          where: { lojaId_bairroId: { lojaId, bairroId: bairro.id } },
          create: { lojaId, bairroId: bairro.id, taxaCentavos: a.taxa_centavos ?? 0 },
          update: {},
        });
      }

      // ── Categorias e produtos (JSON + Prato por kg, na Cabana) ──
      const categorias = [...cardapio.categorias];
      if (pratoPorKg) {
        categorias.push({
          nome: PRATO_POR_KG.categoria,
          turnos: PRATO_POR_KG.turnos,
          produtos: [
            {
              nome: PRATO_POR_KG.nome,
              descricao: PRATO_POR_KG.descricao,
              preco_centavos: null,
              tipoPreco: 'POR_KG',
              vendidoNoSite: false,
              insumos: [],
            },
          ],
        });
      }

      for (const [ordemCat, c] of categorias.entries()) {
        const categoria = await tx.categoria.upsert({
          where: { lojaId_nome: { lojaId, nome: c.nome } },
          create: { lojaId, nome: c.nome, ordem: ordemCat },
          update: { ordem: ordemCat },
        });

        const idsTurnos = c.turnos.map((nome) => {
          const id = turnoId.get(nome);
          if (!id) throw new Error(`Categoria "${c.nome}" referencia turno inexistente "${nome}"`);
          return id;
        });
        const controlaEstoque = c.controla_estoque === true;

        for (const [ordemProd, p] of c.produtos.entries()) {
          const semPreco = p.preco_centavos == null;
          const produto = await tx.produto.upsert({
            where: { lojaId_nome: { lojaId, nome: p.nome } },
            create: {
              lojaId,
              nome: p.nome,
              descricao: p.descricao ?? '',
              categoriaId: categoria.id,
              tipoPreco: p.tipoPreco ?? 'UNIDADE',
              precoCentavos: semPreco ? 0 : p.preco_centavos,
              ativo: !semPreco,
              // Nasce disponível; não reseta sozinho: o dono desliga o que acabou e religa quando quiser.
              disponivelHoje: true,
              vendidoNoSite: p.vendidoNoSite ?? true,
              controlaEstoque,
              estoque: controlaEstoque ? (p.estoque_inicial ?? 0) : null,
              ordem: ordemProd,
            },
            update: { categoriaId: categoria.id, ordem: ordemProd },
          });

          if (produto.precoCentavos === 0) {
            avisar(`Produto "${produto.nome}" sem preço: precoCentavos=0 e ativo=false até o dono definir.`);
          }

          await tx.produtoTurno.createMany({
            data: idsTurnos.map((id) => ({ produtoId: produto.id, turnoId: id })),
            skipDuplicates: true,
          });

          const insumos = (p.insumos ?? []).map((pi) => {
            const id = insumoId.get(pi.insumo);
            if (!id) throw new Error(`Produto "${p.nome}" referencia insumo inexistente "${pi.insumo}"`);
            return { produtoId: produto.id, insumoId: id, quantidade: pi.qtd };
          });
          if (insumos.length) {
            await tx.produtoInsumo.createMany({ data: insumos, skipDuplicates: true });
          }
        }
      }
    },
    { timeout: 30_000 },
  );

  return avisos;
}

/** Contagem por tabela, usada no fim do seed e nos testes. */
export async function contarTabelas(prisma) {
  const [
    loja,
    turno,
    horarioTurno,
    insumo,
    categoria,
    produto,
    produtoTurno,
    produtoInsumo,
  ] = await Promise.all([
    prisma.loja.count(),
    prisma.turno.count(),
    prisma.horarioTurno.count(),
    prisma.insumo.count(),
    prisma.categoria.count(),
    prisma.produto.count(),
    prisma.produtoTurno.count(),
    prisma.produtoInsumo.count(),
  ]);
  return {
    loja,
    turno,
    horarioTurno,
    insumo,
    categoria,
    produto,
    produtoTurno,
    produtoInsumo,
  };
}

// Execução direta: `npm run seed` ou `prisma db seed` (a Cabana);
// outra loja: `npm run seed -w api -- --cardapio prisma/cardapios/loja-teste.json`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { cardapio: { type: 'string' } } });
  const prisma = new PrismaClient();
  try {
    const avisos = await seed(prisma, { caminho: values.cardapio ? path.resolve(values.cardapio) : CAMINHO_JSON });
    console.log('\nSeed concluído. Registros por tabela:');
    console.table(await contarTabelas(prisma));
    console.log(`${avisos.length} aviso(s).`);
  } catch (err) {
    console.error('Seed falhou:', err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
