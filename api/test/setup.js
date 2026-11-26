/**
 * Pré-carregado em todo processo de teste (`node --test --import ./test/setup.js`).
 * Aponta o Prisma para o banco de teste e define segredos próprios dos testes,
 * para que nenhum teste toque no banco de dev nem dependa do .env de dev.
 */
process.env.DATABASE_URL_DEV ??= process.env.DATABASE_URL ?? '';
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
process.env.JWT_SECRET = 'teste-jwt-secret-com-pelo-menos-32-caracteres!!';
process.env.JWT_REFRESH_SECRET = 'teste-refresh-secret-com-pelo-menos-32-caracteres';
process.env.JWT_CLIENTE_SECRET = 'teste-cliente-secret-com-pelo-menos-32-caracteres';
process.env.GOOGLE_CLIENT_ID = 'cliente-teste.apps.googleusercontent.com';
process.env.BCRYPT_CUSTO = '4';
process.env.PRISMA_HIDE_UPDATE_MESSAGE = '1';
// Login com celular: cada teste passa o próprio verificador (o .env de dev pode ter PHONE_VERIFIER=test).
process.env.PHONE_VERIFIER = '';
process.env.PHONE_TEST_NUMBERS = '';
// Pagamento online: segredos próprios dos testes (o .env de dev pode não ter ou ter outros).
process.env.CAMPANHA_TELEFONE_SECRET = 'teste-campanha-telefone-com-pelo-menos-32-caracteres';
process.env.MP_STATE_SECRET = 'teste-state-mercado-pago-com-pelo-menos-32-caracteres';
