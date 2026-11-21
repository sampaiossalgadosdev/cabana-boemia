/**
 * Primeiro uso do "PDV do Batiá" num computador que tinha o programa antigo
 * "Cabana Boemia PDV": importa a configuração dele para a Cabana não perder nada.
 * Sem electron aqui (testável com node:test); roda no topo do main, ANTES de o
 * Chromium iniciar (a chave da sessão cifrada é lida do "Local State" na partida).
 *
 * Importa (só se a pasta nova ainda não tem config.json e a antiga tem):
 * - config.json: endereço do servidor, impressora, id do agente de impressão
 *   (as reservas da fila continuam com o mesmo computador) e a loja do ADMIN;
 * - sessao.bin + "Local State": o login salvo. O refresh é cifrado pelo
 *   safeStorage (DPAPI no Windows) com a chave guardada no "Local State";
 *   copiando os dois, o mesmo usuário do Windows abre já logado. Se não
 *   decifrar (outro usuário do Windows, arquivo velho), só pede o login.
 * O "abrir com o Windows" o main refaz com o nome novo e apaga o do antigo.
 * Nada da pasta antiga é apagado (o programa antigo é desinstalado à mão).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Pasta de dados deste PDV (em %APPDATA%), FIXA: é a do tempo em que o programa
 * se chamava "PDV do Abatiá". O Electron montaria o userData com o nome do
 * programa (productName, hoje "PDV do Batiá"); trocar o nome mudaria a pasta e o
 * PDV perderia servidor, login (sessao.bin + "Local State"), impressora e o id do
 * agente de impressão. Nunca mude este valor.
 */
export const PASTA_DE_DADOS = 'PDV do Abatiá';
/** Nome da pasta de dados do programa antigo (em %APPDATA%). */
export const PASTA_DO_PDV_ANTIGO = 'Cabana Boemia PDV';
/** Arquivos importados, na ordem; só config.json é obrigatório. */
export const ARQUIVOS_IMPORTADOS = ['config.json', 'sessao.bin', 'Local State'];
/** Marca na pasta nova: importado (e de onde), para o log e o suporte. */
export const MARCA_IMPORTACAO = 'importado-do-pdv-antigo.json';

/**
 * @param {{ dadosNovos: string, dadosAntigos: string, agora?: () => Date }} opcoes
 * @returns {{ importou: boolean, motivo?: 'ja-configurado' | 'sem-pdv-antigo' | 'erro', arquivos?: string[], erro?: string }}
 */
export function importarDoPdvAntigo({ dadosNovos, dadosAntigos, agora = () => new Date() }) {
  if (path.resolve(dadosNovos) === path.resolve(dadosAntigos)) return { importou: false, motivo: 'ja-configurado' };
  if (fs.existsSync(path.join(dadosNovos, 'config.json'))) return { importou: false, motivo: 'ja-configurado' };
  if (!fs.existsSync(path.join(dadosAntigos, 'config.json'))) return { importou: false, motivo: 'sem-pdv-antigo' };
  try {
    // config.json tem que ser JSON válido (senão a tela de configuração aparece normalmente).
    JSON.parse(fs.readFileSync(path.join(dadosAntigos, 'config.json'), 'utf8'));
    fs.mkdirSync(dadosNovos, { recursive: true });
    const arquivos = [];
    for (const nome of ARQUIVOS_IMPORTADOS) {
      const origem = path.join(dadosAntigos, nome);
      const destino = path.join(dadosNovos, nome);
      if (!fs.existsSync(origem)) continue;
      // "Local State" só sem um próprio (nunca troca a chave de uma pasta que já cifrou algo).
      if (nome === 'Local State' && fs.existsSync(destino)) continue;
      fs.copyFileSync(origem, destino);
      arquivos.push(nome);
    }
    fs.writeFileSync(
      path.join(dadosNovos, MARCA_IMPORTACAO),
      JSON.stringify({ de: dadosAntigos, em: agora().toISOString(), arquivos }, null, 2),
    );
    return { importou: true, arquivos };
  } catch (err) {
    // Importar é melhor esforço: falhou, o PDV abre como num computador novo.
    return { importou: false, motivo: 'erro', erro: err?.message ?? String(err) };
  }
}
