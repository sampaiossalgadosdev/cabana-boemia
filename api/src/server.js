import http from 'node:http';
import { criarApp, lerOrigensCors } from './app.js';
import { criarTempoReal } from './lib/tempoReal.js';
import { prisma } from './lib/prisma.js';
import { problemasNosSegredos } from './lib/tokens.js';
import { credenciaisApple } from './lib/apple.js';
import { emailDoTitular } from './lib/controlador.js';
import { lerHostsTaaki, origensPermitidas } from './lib/dominios.js';
import { ehProducao, problemasNoVerificador } from './lib/verificadorTelefone.js';
import { iniciarLimpezaDiaria } from './services/registroAcesso.service.js';

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

// Login com celular: verificador de TESTE em produção deixaria qualquer um entrar
// com os números da lista. Não sobe (nem com outro valor inválido).
const problemasTelefone = problemasNoVerificador();
if (problemasTelefone.length) {
  console.error('A API não vai iniciar (login com celular):');
  for (const p of problemasTelefone) console.error(`  - ${p}`);
  process.exit(1);
}
if ((process.env.PHONE_VERIFIER ?? '').trim() === 'test') {
  if (ehProducao()) {
    console.warn(
      '*** ATENÇÃO: login com celular no modo TESTE EM PRODUÇÃO (PHONE_TEST_EM_PRODUCAO=sim). Quem souber um número ' +
        'e o código de PHONE_TEST_NUMBERS entra naquela conta. Apague PHONE_VERIFIER, PHONE_TEST_NUMBERS e ' +
        'PHONE_TEST_EM_PRODUCAO antes de abrir o app ao público. ***',
    );
  } else {
    console.warn('Aviso: login com celular no modo TESTE (PHONE_VERIFIER=test): só os números de PHONE_TEST_NUMBERS, sem SMS.');
  }
}

if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn('Aviso: GOOGLE_CLIENT_ID ausente. O login de clientes no site responde 503 até configurar.');
}
if (!credenciaisApple()) {
  console.warn(
    'Aviso: APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY ausentes. O "Entrar com Apple" funciona, mas a exclusão de conta não revoga o login na Apple.',
  );
}

if (!emailDoTitular()) {
  console.warn('Aviso: CONTATO_TITULAR_EMAIL ausente. A política de privacidade do app fica só com o formulário como canal do titular.');
}

// Registros de acesso do cliente: apaga os de mais de 6 meses ao iniciar e a cada 24 h.
const pararLimpeza = iniciarLimpezaDiaria();

const porta = Number(process.env.PORT) || 3000;
const app = criarApp();
const servidor = http.createServer(app);
const io = criarTempoReal(servidor, {
  corsOrigins: origensPermitidas(lerOrigensCors(process.env.CORS_ORIGINS), lerHostsTaaki(process.env.TAAKI_HOSTS)),
});

servidor.listen(porta, () => {
  console.log(`API ouvindo na porta ${porta}`);
});

function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  pararLimpeza();
  // io.close desconecta os sockets e fecha também o servidor HTTP.
  io.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
