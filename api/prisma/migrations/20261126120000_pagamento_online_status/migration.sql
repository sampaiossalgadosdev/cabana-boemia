-- Pagamento online (Mercado Pago): status do pedido que espera o pagamento
-- (AGUARDANDO_PAGAMENTO, fora do PDV até a aprovação) e o do Pix que venceu
-- (EXPIRADO, fora do relatório de cancelados). Migration própria: valor novo de
-- enum só pode ser usado depois do commit. Só aditiva.

-- AlterEnum
ALTER TYPE "StatusPedido" ADD VALUE 'AGUARDANDO_PAGAMENTO' BEFORE 'ABERTO';
ALTER TYPE "StatusPedido" ADD VALUE 'EXPIRADO';
