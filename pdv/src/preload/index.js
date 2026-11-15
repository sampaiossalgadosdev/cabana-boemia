/**
 * Ponte mínima renderer → main (contextIsolation ligado, sandbox ligado).
 * Expõe funções com nome; nunca o ipcRenderer cru. Cada chamada devolve
 * `{ ok: true, dados } | { ok: false, erro: { mensagem, codigo, status } }`.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Eventos main → renderer que a página pode escutar. */
const EVENTOS = ['pedido:novo', 'pedido:atualizado', 'socket:status', 'sessao:expirou'];

const chamar = (canal, ...args) => ipcRenderer.invoke(canal, ...args);

contextBridge.exposeInMainWorld('pdv', {
  config: {
    obter: () => chamar('config:obter'),
    definirApiUrl: (url) => chamar('config:definirApiUrl', String(url ?? '')),
  },
  sessao: {
    restaurar: () => chamar('sessao:restaurar'),
    entrar: (email, senha) => chamar('sessao:entrar', String(email ?? ''), String(senha ?? '')),
    sair: () => chamar('sessao:sair'),
  },
  pedidos: {
    listarFila: () => chamar('pedidos:fila'),
    finalizar: (id, formaPagamento) => chamar('pedidos:finalizar', Number(id), String(formaPagamento ?? '')),
    cancelar: (id) => chamar('pedidos:cancelar', Number(id)),
    criar: (dados) => chamar('pedidos:criar', dados),
  },
  cardapio: {
    obter: (turnoId) => chamar('cardapio:obter', turnoId == null ? null : Number(turnoId)),
  },
  bairros: {
    listar: () => chamar('bairros:listar'),
  },
  clientes: {
    buscar: (busca) => chamar('clientes:buscar', String(busca ?? '')),
    criar: (dados) => chamar('clientes:criar', dados),
    adicionarEndereco: (clienteId, endereco) => chamar('clientes:adicionarEndereco', Number(clienteId), endereco),
  },
  tempo: {
    obter: () => chamar('tempo:obter'),
    definir: (minutos) => chamar('tempo:definir', minutos == null ? null : Number(minutos)),
  },
  tempoReal: {
    status: () => chamar('tempoReal:status'),
  },
  /** @returns {() => void} para parar de escutar */
  aoEvento(nome, callback) {
    if (!EVENTOS.includes(nome)) throw new Error(`Evento não permitido: ${nome}`);
    const ouvinte = (_evento, dados) => callback(dados);
    ipcRenderer.on(nome, ouvinte);
    return () => ipcRenderer.removeListener(nome, ouvinte);
  },
});
