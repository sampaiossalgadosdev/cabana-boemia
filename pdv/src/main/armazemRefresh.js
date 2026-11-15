/**
 * Guarda o refresh token cifrado com o `safeStorage` do Electron (DPAPI no
 * Windows) em `sessao.bin` no userData. NUNCA grava em texto puro: sem
 * cifragem disponível, o token fica só na memória (re-login ao reabrir).
 * Usa a API assíncrona (a síncrona está deprecada desde o Electron 45).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {{ caminho: string, safeStorage: {
 *   isAsyncEncryptionAvailable(): Promise<boolean>,
 *   encryptStringAsync(s: string): Promise<Buffer>,
 *   decryptStringAsync(b: Buffer): Promise<{ result: string, shouldReEncrypt: boolean }> } }} opcoes
 */
export function criarArmazemRefresh({ caminho, safeStorage }) {
  let emMemoria = null;

  async function gravar(token) {
    await fs.mkdir(path.dirname(caminho), { recursive: true });
    const tmp = `${caminho}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptStringAsync(token));
    await fs.rename(tmp, caminho);
  }

  return {
    async ler() {
      if (emMemoria) return emMemoria;
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await fs.readFile(caminho));
        emMemoria = result || null;
        if (emMemoria && shouldReEncrypt) await gravar(emMemoria); // chave rotacionada
      } catch {
        emMemoria = null; // sem arquivo, ou cifrado por outro usuário do Windows
      }
      return emMemoria;
    },

    async guardar(token) {
      emMemoria = token;
      if (!(await safeStorage.isAsyncEncryptionAvailable())) {
        await fs.rm(caminho, { force: true });
        return;
      }
      await gravar(token);
    },

    async apagar() {
      emMemoria = null;
      await fs.rm(caminho, { force: true });
    },
  };
}
