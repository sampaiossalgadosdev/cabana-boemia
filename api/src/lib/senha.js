import bcrypt from 'bcryptjs';

// Custo 12 em produção. Os testes baixam via BCRYPT_CUSTO para ficarem rápidos.
const CUSTO = Math.max(4, Number(process.env.BCRYPT_CUSTO) || 12);

export function gerarHashSenha(senha) {
  return bcrypt.hash(senha, CUSTO);
}

export function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

let hashFicticio;
/**
 * Hash usado quando o email não existe, para o login levar o mesmo tempo
 * e não revelar quais emails estão cadastrados.
 */
export async function obterHashFicticio() {
  hashFicticio ??= await gerarHashSenha('senha-ficticia-para-tempo-constante');
  return hashFicticio;
}
