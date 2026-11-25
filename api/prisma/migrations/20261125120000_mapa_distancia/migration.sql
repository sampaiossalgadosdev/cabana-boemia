-- Endereço com pino no mapa e distância pelas ruas. Só aditiva: tudo opcional,
-- nada existente muda (endereços, lojas e pedidos antigos ficam sem pino/distância).

CREATE TYPE "OrigemDistancia" AS ENUM ('ROTA', 'ESTIMADA');

-- Pino do endereço do cliente e da loja: os dois ou nenhum, dentro das faixas
-- (IS NOT NULL explícito: com um NULL o BETWEEN daria NULL e o CHECK passaria).
ALTER TABLE "Endereco" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Endereco" ADD CONSTRAINT "Endereco_pino_check"
  CHECK (("latitude" IS NULL AND "longitude" IS NULL)
      OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
          AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180));

ALTER TABLE "Loja" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_pino_check"
  CHECK (("latitude" IS NULL AND "longitude" IS NULL)
      OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL
          AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180));

-- Pedido: posições usadas (fotos da compra) e a distância com a origem do valor.
ALTER TABLE "Pedido" ADD COLUMN "latitudeEntrega" DOUBLE PRECISION,
ADD COLUMN "longitudeEntrega" DOUBLE PRECISION,
ADD COLUMN "latitudeLoja" DOUBLE PRECISION,
ADD COLUMN "longitudeLoja" DOUBLE PRECISION,
ADD COLUMN "distanciaMetros" INTEGER,
ADD COLUMN "distanciaOrigem" "OrigemDistancia";
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_pino_entrega_check"
  CHECK (("latitudeEntrega" IS NULL) = ("longitudeEntrega" IS NULL));
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_pino_loja_check"
  CHECK (("latitudeLoja" IS NULL) = ("longitudeLoja" IS NULL));
-- Distância só com as duas posições e a origem; sempre >= 0.
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_distancia_check"
  CHECK (("distanciaMetros" IS NULL AND "distanciaOrigem" IS NULL)
      OR ("distanciaMetros" >= 0 AND "distanciaOrigem" IS NOT NULL
          AND "latitudeEntrega" IS NOT NULL AND "latitudeLoja" IS NOT NULL));

-- Chamadas ao Google por dia (limite diário e acompanhamento; sem dado pessoal).
CREATE TABLE "UsoMapa" (
    "dia" DATE NOT NULL,
    "servico" VARCHAR(20) NOT NULL,
    "chamadas" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UsoMapa_pkey" PRIMARY KEY ("dia","servico"),
    CONSTRAINT "UsoMapa_chamadas_check" CHECK ("chamadas" >= 0)
);

-- Cache da distância pelas ruas (coordenadas arredondadas em 4 casas, ×10⁴).
CREATE TABLE "CacheRota" (
    "origemLat" INTEGER NOT NULL,
    "origemLng" INTEGER NOT NULL,
    "destinoLat" INTEGER NOT NULL,
    "destinoLng" INTEGER NOT NULL,
    "distanciaMetros" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CacheRota_pkey" PRIMARY KEY ("origemLat","origemLng","destinoLat","destinoLng"),
    CONSTRAINT "CacheRota_distancia_check" CHECK ("distanciaMetros" >= 0)
);
