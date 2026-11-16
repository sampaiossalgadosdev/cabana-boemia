/**
 * Configuração local do PDV: `config.json` no userData. Sem import do
 * electron (testável com node:test); o caminho e o padrão vêm de fora.
 */
import fs from 'node:fs';
import path from 'node:path';
import { lerConfigImpressao, validarConfigImpressao } from './agente-impressao/configuracao.js';

/** Prefixo das rotas da API no servidor (o site fica em /, a retaguarda em /admin). */
export const PREFIXO_API = '/api';

/**
 * Normaliza e valida o endereço do servidor: http(s), sem query/hash, sem
 * barra no fim e sem o `/api` (o PDV acrescenta sozinho; quem digitar com
 * `/api` não fica com `/api/api`).
 * @returns {string} endereço normalizado
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
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/** Base das rotas HTTP da API a partir do endereço do servidor. */
export const baseDaApi = (servidor) => (servidor ? `${servidor}${PREFIXO_API}` : null);

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

  /** Endereço do servidor como a pessoa configurou (sem `/api`). */
  function servidor() {
    if (typeof salvo.apiUrl === 'string') {
      try {
        return validarApiUrl(salvo.apiUrl);
      } catch {
        // valor salvo inválido: cai no padrão
      }
    }
    return apiUrlPadrao;
  }

  function gravar(novo) {
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    const tmp = `${caminho}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(novo, null, 2));
    fs.renameSync(tmp, caminho);
    salvo = novo;
  }

  return {
    obter: () => ({ apiUrl: servidor() }),
    servidor,
    /** Base das rotas da API (`<servidor>/api`); null se não configurado. */
    apiUrl: () => baseDaApi(servidor()),
    definirApiUrl(valor) {
      const url = validarApiUrl(valor);
      gravar({ ...salvo, apiUrl: url });
      return url;
    },
    /** Impressora deste computador (modo, nome no Windows, largura, tabela, guilhotina). */
    impressao: () => lerConfigImpressao(salvo.impressao),
    definirImpressao(dados) {
      const impressao = validarConfigImpressao(dados);
      gravar({ ...salvo, impressao });
      return impressao;
    },
  };
}
