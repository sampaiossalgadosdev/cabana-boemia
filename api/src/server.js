import { criarApp } from './app.js';
import { prisma } from './lib/prisma.js';

const porta = Number(process.env.PORT) || 3000;
const app = criarApp();

const servidor = app.listen(porta, () => {
  console.log(`API ouvindo na porta ${porta}`);
});

function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  servidor.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
