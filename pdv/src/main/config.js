/**
 * Configuração local do PDV: `config.json` no userData. Sem import do
 * electron (testável com node:test); o caminho e o padrão vêm de fora.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Normaliza e valida a URL da API: http(s), sem query/hash, sem barra no fim.
 * @returns {string} URL normalizada
 * @throws {Error} mensagem pronta para a tela
 */
export function validarApiUrl(valor) {
  const texto = String(valor ?? '').trim();
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error('Endereço inválido. Ex.: https://cabana-boemia.up.railway.app');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('O endereço precisa começar com https:// (ou http:// na rede local)');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Informe só o endereço do servidor, sem parâmetros');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * @param {{ caminho: string, apiUrlPadrao: string | null }} opcoes
 *   `apiUrlPadrao`: localhost em desenvolvimento; null em produção (a tela
 *   de configuração pede a URL na primeira execução).
 */
export function criarConfig({ caminho, apiUrlPadrao }) {
  let salvo = {};
  try {
    salvo = JSON.parse(fs.readFileSync(caminho, 'utf8')) ?? {};
  } catch {
    salvo = {}; // primeira execução ou arquivo corrompido
  }

  function apiUrl() {
    if (typeof salvo.apiUrl === 'string') {
      try {
        return validarApiUrl(salvo.apiUrl);
      } catch {
        // valor salvo inválido: cai no padrão
      }
    }
    return apiUrlPadrao;
  }

  return {
    obter: () => ({ apiUrl: apiUrl() }),
    apiUrl,
    definirApiUrl(valor) {
      const url = validarApiUrl(valor);
      salvo = { ...salvo, apiUrl: url };
      fs.mkdirSync(path.dirname(caminho), { recursive: true });
      const tmp = `${caminho}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(salvo, null, 2));
      fs.renameSync(tmp, caminho);
      return url;
    },
  };
}
