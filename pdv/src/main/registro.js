/**
 * Log em arquivo com rotação por tamanho (sem dependências; testável com node:test).
 * `impressao.log` é o atual; ao passar de `maxBytes`, vira `impressao.1.log`, o
 * `.1` vira `.2`... e o mais antigo além de `arquivos` é apagado.
 * Escrita síncrona: o volume é pequeno (eventos do agente) e uma linha nunca se perde
 * se o app fechar logo depois.
 */
import fs from 'node:fs';
import path from 'node:path';

const NIVEIS = ['info', 'warn', 'error'];

/** Texto de um argumento: Error com stack, objeto em JSON, o resto como string. */
function formatar(arg) {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Data/hora local legível (o computador do balcão está em America/Sao_Paulo). */
function carimbo(d) {
  const p = (n, t = 2) => String(n).padStart(t, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * @param {{ pasta: string, nome: string, maxBytes?: number, arquivos?: number,
 *           agora?: () => Date, espelho?: Pick<Console, 'info' | 'warn' | 'error'> | null }} opcoes
 *   `arquivos`: quantos antigos guardar além do atual.
 *   `espelho`: também escreve no console (dev); null desliga.
 * @returns {{ info: Function, warn: Function, error: Function, caminho: string }}
 */
export function criarRegistro({ pasta, nome, maxBytes = 1024 * 1024, arquivos = 5, agora = () => new Date(), espelho = console }) {
  const caminho = path.join(pasta, `${nome}.log`);
  const antigo = (n) => path.join(pasta, `${nome}.${n}.log`);
  let tamanho = null;

  function girar() {
    try {
      fs.rmSync(antigo(arquivos), { force: true });
      for (let n = arquivos - 1; n >= 1; n--) {
        if (fs.existsSync(antigo(n))) fs.renameSync(antigo(n), antigo(n + 1));
      }
      if (fs.existsSync(caminho)) fs.renameSync(caminho, antigo(1));
    } catch {
      // arquivo preso (antivírus, outro processo): segue escrevendo no atual
    }
    tamanho = fs.existsSync(caminho) ? fs.statSync(caminho).size : 0;
  }

  function escrever(nivel, args) {
    const linha = `${carimbo(agora())} ${nivel.toUpperCase().padEnd(5)} ${args.map(formatar).join(' ')}\n`;
    try {
      if (tamanho === null) {
        fs.mkdirSync(pasta, { recursive: true });
        tamanho = fs.existsSync(caminho) ? fs.statSync(caminho).size : 0;
      }
      const bytes = Buffer.byteLength(linha);
      if (tamanho > 0 && tamanho + bytes > maxBytes) girar();
      fs.appendFileSync(caminho, linha);
      tamanho += bytes;
    } catch {
      // disco cheio ou sem permissão: o log nunca derruba o agente
    }
    espelho?.[nivel]?.(...args);
  }

  const registro = { caminho };
  for (const nivel of NIVEIS) registro[nivel] = (...args) => escrever(nivel, args);
  return registro;
}
