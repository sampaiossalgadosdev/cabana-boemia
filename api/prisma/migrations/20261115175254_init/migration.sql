-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('DONO', 'ATENDENTE');

-- CreateEnum
CREATE TYPE "TipoPreco" AS ENUM ('UNIDADE', 'POR_KG');

-- CreateEnum
CREATE TYPE "CanalPedido" AS ENUM ('SITE', 'WHATSAPP', 'SALAO');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('ABERTO', 'CONFIRMADO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DINHEIRO', 'DEBITO', 'CREDITO');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('VENDA', 'ESTORNO', 'ENTRADA', 'AJUSTE');

-- CreateEnum
CREATE TYPE "TipoTrabalhoImpressao" AS ENUM ('PEDIDO', 'CANCELAMENTO', 'CONTA');

-- CreateEnum
CREATE TYPE "StatusTrabalhoImpressao" AS ENUM ('PENDENTE', 'IMPRESSO', 'FALHOU');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" SERIAL NOT NULL,
    "googleId" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endereco" (
    "id" SERIAL NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "rua" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "complemento" TEXT,
    "referencia" TEXT,
    "bairroId" INTEGER NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Endereco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bairro" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "taxaCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Bairro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "categoriaId" INTEGER NOT NULL,
    "tipoPreco" "TipoPreco" NOT NULL DEFAULT 'UNIDADE',
    "precoCentavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "disponivelHoje" BOOLEAN NOT NULL DEFAULT false,
    "vendidoNoSite" BOOLEAN NOT NULL DEFAULT true,
    "controlaEstoque" BOOLEAN NOT NULL DEFAULT false,
    "estoque" INTEGER,
    "estoqueMinimo" INTEGER,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioTurno" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "inicio" VARCHAR(5) NOT NULL,
    "fim" VARCHAR(5) NOT NULL,

    CONSTRAINT "HorarioTurno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoTurno" (
    "produtoId" INTEGER NOT NULL,
    "turnoId" INTEGER NOT NULL,

    CONSTRAINT "ProdutoTurno_pkey" PRIMARY KEY ("produtoId","turnoId")
);

-- CreateTable
CREATE TABLE "Insumo" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "estoque" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProdutoInsumo" (
    "produtoId" INTEGER NOT NULL,
    "insumoId" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "ProdutoInsumo_pkey" PRIMARY KEY ("produtoId","insumoId")
);

-- CreateTable
CREATE TABLE "MovimentacaoEstoque" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "produtoId" INTEGER,
    "insumoId" INTEGER,
    "quantidade" INTEGER NOT NULL,
    "itemPedidoId" INTEGER,
    "usuarioId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" SERIAL NOT NULL,
    "numeroDia" INTEGER NOT NULL,
    "dataRef" DATE NOT NULL,
    "canal" "CanalPedido" NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'ABERTO',
    "clienteId" INTEGER,
    "nomeCliente" TEXT NOT NULL,
    "telefone" TEXT,
    "enderecoTexto" TEXT,
    "bairroNome" TEXT,
    "taxaEntregaCentavos" INTEGER NOT NULL DEFAULT 0,
    "subtotalCentavos" INTEGER NOT NULL DEFAULT 0,
    "totalCentavos" INTEGER NOT NULL DEFAULT 0,
    "formaPagamento" "FormaPagamento",
    "trocoParaCentavos" INTEGER,
    "mesaRotulo" TEXT,
    "tempoEstimadoMin" INTEGER,
    "criadoPorId" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedido" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "nomeSnapshot" TEXT NOT NULL,
    "precoUnitarioCentavos" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "pesoGramas" INTEGER,
    "totalCentavos" INTEGER NOT NULL,
    "observacao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceladoEm" TIMESTAMP(3),

    CONSTRAINT "ItemPedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrabalhoImpressao" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "tipo" "TipoTrabalhoImpressao" NOT NULL,
    "status" "StatusTrabalhoImpressao" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressoEm" TIMESTAMP(3),

    CONSTRAINT "TrabalhoImpressao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nomeRestaurante" TEXT NOT NULL DEFAULT 'Cabana Boemia',
    "whatsappNumero" TEXT NOT NULL DEFAULT '',
    "tempoEstimadoPadraoMin" INTEGER NOT NULL DEFAULT 40,
    "tempoEstimadoManualMin" INTEGER,
    "tempoManualDefinidoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_hash_key" ON "RefreshToken"("hash");

-- CreateIndex
CREATE INDEX "RefreshToken_usuarioId_idx" ON "RefreshToken"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_googleId_key" ON "Cliente"("googleId");

-- CreateIndex
CREATE INDEX "Cliente_telefone_idx" ON "Cliente"("telefone");

-- CreateIndex
CREATE INDEX "Endereco_clienteId_idx" ON "Endereco"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Bairro_nome_key" ON "Bairro"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Categoria_nome_key" ON "Categoria"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_nome_key" ON "Produto"("nome");

-- CreateIndex
CREATE INDEX "Produto_categoriaId_idx" ON "Produto"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "Turno_nome_key" ON "Turno"("nome");

-- CreateIndex
CREATE INDEX "HorarioTurno_turnoId_diaSemana_idx" ON "HorarioTurno"("turnoId", "diaSemana");

-- CreateIndex
CREATE INDEX "ProdutoTurno_turnoId_idx" ON "ProdutoTurno"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_nome_key" ON "Insumo"("nome");

-- CreateIndex
CREATE INDEX "ProdutoInsumo_insumoId_idx" ON "ProdutoInsumo"("insumoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_produtoId_idx" ON "MovimentacaoEstoque"("produtoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_insumoId_idx" ON "MovimentacaoEstoque"("insumoId");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_itemPedidoId_idx" ON "MovimentacaoEstoque"("itemPedidoId");

-- CreateIndex
CREATE INDEX "Pedido_status_idx" ON "Pedido"("status");

-- CreateIndex
CREATE INDEX "Pedido_clienteId_criadoEm_idx" ON "Pedido"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "Pedido_criadoEm_idx" ON "Pedido"("criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_dataRef_numeroDia_key" ON "Pedido"("dataRef", "numeroDia");

-- CreateIndex
CREATE INDEX "ItemPedido_pedidoId_idx" ON "ItemPedido"("pedidoId");

-- CreateIndex
CREATE INDEX "ItemPedido_produtoId_idx" ON "ItemPedido"("produtoId");

-- CreateIndex
CREATE INDEX "TrabalhoImpressao_status_criadoEm_idx" ON "TrabalhoImpressao"("status", "criadoEm");

-- CreateIndex
CREATE INDEX "TrabalhoImpressao_pedidoId_idx" ON "TrabalhoImpressao"("pedidoId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endereco" ADD CONSTRAINT "Endereco_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endereco" ADD CONSTRAINT "Endereco_bairroId_fkey" FOREIGN KEY ("bairroId") REFERENCES "Bairro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HorarioTurno" ADD CONSTRAINT "HorarioTurno_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoTurno" ADD CONSTRAINT "ProdutoTurno_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoTurno" ADD CONSTRAINT "ProdutoTurno_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoInsumo" ADD CONSTRAINT "ProdutoInsumo_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProdutoInsumo" ADD CONSTRAINT "ProdutoInsumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_itemPedidoId_fkey" FOREIGN KEY ("itemPedidoId") REFERENCES "ItemPedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedido" ADD CONSTRAINT "ItemPedido_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrabalhoImpressao" ADD CONSTRAINT "TrabalhoImpressao_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
