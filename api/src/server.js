import { criarApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { problemasNosSegredos } from './lib/tokens.js';

// Falha cedo: sem segredos válidos a API subiria e só quebraria no primeiro login.
const problemas = problemasNosSegredos();
if (problemas.length) {
  console.error('A API não vai iniciar. Corrija no .env (ou nas variáveis do Railway):');
  for (const p of problemas) console.error(`  - ${p}`);
  console.error(
    `Gere um valor com: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
  );
  process.exit(1);
}

if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn('Aviso: GOOGLE_CLIENT_ID ausente. O login de clientes no site responde 503 até configurar.');
}

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
