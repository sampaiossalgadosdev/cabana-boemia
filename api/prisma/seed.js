/**
 * Seed idempotente da loja Cabana Boemia e do cardápio dela, a partir de
 * cardapio-cabana-boemia.json.
 *
 * Política (ver CLAUDE.md › Seed): cria o que falta e NUNCA sobrescreve o que o
 * dono pode editar (preço, ativo, disponivelHoje, descrição, estoque, horários,
 * configuração da loja). Em registro existente só atualiza a estrutura
 * (categoria/ordem) e acrescenta vínculos ProdutoTurno/ProdutoInsumo que faltarem.
 * Tudo por loja: os nomes são únicos dentro da loja (upsert por [lojaId, nome]).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const CAMINHO_JSON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'cardapio-cabana-boemia.json',
);

const DIAS = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

/** Mesmo slug de src/services/loja.service.js (SLUG_LOJA_PADRAO): a migration multi_loja já cria a loja. */
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

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ cardapio?: any, log?: (msg: string) => void }} [opcoes]
 * @returns {Promise<string[]>} avisos emitidos
 */
export async function seed(prisma, { cardapio, log = console.log } = {}) {
  cardapio ??= await lerCardapio();
  const avisos = [];
  const avisar = (msg) => {
    avisos.push(msg);
    log(`⚠️  ${msg}`);
  };

  await prisma.$transaction(
    async (tx) => {
      // ── Loja (a migration multi_loja já cria; aqui só se faltar) ──
      const loja = await tx.loja.upsert({
        where: { slug: LOJA_CABANA.slug },
        create: { ...LOJA_CABANA, nome: cardapio.restaurante.nome },
        update: {},
      });
      const lojaId = loja.id;
      if (!loja.whatsapp) {
        avisar('WhatsApp da loja vazio: defina na retaguarda (Configurações; usado no link wa.me).');
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
      for (const i of cardapio.insumos) {
        const insumo = await tx.insumo.upsert({
          where: { lojaId_nome: { lojaId, nome: i.nome } },
          create: { lojaId, nome: i.nome, estoque: i.estoque_inicial ?? 0, estoqueMinimo: 0 },
          update: {},
        });
        insumoId.set(i.nome, insumo.id);
      }

      // ── Categorias e produtos (JSON + Prato por kg) ──
      const categorias = [
        ...cardapio.categorias,
        {
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
        },
      ];

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

// Execução direta: `npm run seed` ou `prisma db seed`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  try {
    const avisos = await seed(prisma);
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
