-- Foto do produto: link editável na retaguarda (Produtos). Null = placeholder no site.
ALTER TABLE "Produto" ADD COLUMN "imagemUrl" VARCHAR(500);

-- Fotos provisórias (Unsplash, licença livre) até chegarem as fotos reais.
-- Só onde o campo está vazio; produto renomeado ou novo fica sem (placeholder).
-- Calabresa Acebolada e Salame ficam sem foto (nenhuma provisória combinava).
UPDATE "Produto" AS p
SET "imagemUrl" = 'https://images.unsplash.com/photo-' || v.foto || '?w=600&h=600&fit=crop&auto=format&q=70'
FROM (VALUES
  ('Misto Quente', '1528735602780-2552fd46c7af'),
  ('Cachorro Quente', '1541214113241-21578d2d9b62'),
  ('X-Burguer', '1568901346375-23c9450c58cd'),
  ('X-Salada', '1571091718767-18b5b1457add'),
  ('X-Egg', '1586190848861-99aa4a171e90'),
  ('X-Bacon', '1607013251379-e6eecfffe234'),
  ('X-Calabresa', '1542574271-7f3b92e6c821'),
  ('X-Frango', '1606755962773-d324e0a13086'),
  ('X-Tudo', '1553979459-d2229ba7433b'),
  ('Pizza Tradicional', '1574071318508-1cdbab80d002'),
  ('Pizza Calabresa', '1628840042765-356cda07504e'),
  ('Pizza Bacon', '1565299624946-b28f40a0ae38'),
  ('Pizza Frango', '1594007654729-407eedc4be65'),
  ('Pizza 4 Queijos', '1613564834361-9436948817d1'),
  ('Pizza Moda da Casa', '1618213837799-25d5552820d3'),
  ('Batata Frita (500g)', '1573080496219-bb080dd4f877'),
  ('Batata Frita com Mussarela e Bacon (500g)', '1585109649139-366815a0d713'),
  ('Batata Frita com Cheddar e Bacon (500g)', '1576107232684-1279f390859f'),
  ('Frango a Passarinho (1kg)', '1626645738196-c2a7c87a8f58'),
  ('Refrigerante Lata', '1527960471264-932f39eb5846'),
  ('Coca-Cola 1L', '1622483767028-3f66f32aef97'),
  ('Coca-Cola 2L', '1622483767028-3f66f32aef97'),
  ('Suco 300ml', '1600271886742-f049cd451bba'),
  ('Suco 900ml', '1621506289937-a8e4df240d0b'),
  ('Marmita P', '1603133872878-684f208fb84b'),
  ('Marmita M', '1603133872878-684f208fb84b'),
  ('Marmita G', '1603133872878-684f208fb84b')
) AS v(nome, foto)
WHERE p.nome = v.nome AND p."imagemUrl" IS NULL;
