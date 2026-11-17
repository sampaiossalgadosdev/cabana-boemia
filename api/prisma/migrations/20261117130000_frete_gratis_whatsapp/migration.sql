-- Frete grátis vale também no delivery lançado pelo PDV (WhatsApp)? Padrão: sim
-- (linhas existentes ganham true; nada muda enquanto freteGratisAtivo = false).
ALTER TABLE "Configuracao" ADD COLUMN     "freteGratisWhatsapp" BOOLEAN NOT NULL DEFAULT true;
