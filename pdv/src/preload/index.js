/**
 * Ponte mínima renderer → main (contextIsolation ligado, sandbox ligado).
 * Expõe funções com nome; nunca o ipcRenderer cru. Cada chamada devolve
 * `{ ok: true, dados } | { ok: false, erro: { mensagem, codigo, status } }`.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Eventos main → renderer que a página pode escutar. */
const EVENTOS = ['pedido:novo', 'pedido:atualizado', 'socket:status', 'sessao:expirou', 'impressao:status'];

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
    reimprimir: (id) => chamar('pedidos:reimprimir', Number(id)),
  },
  comandas: {
    listar: () => chamar('comandas:listar'),
    obter: (id) => chamar('comandas:obter', Number(id)),
    abrir: (dados) =>
      chamar('comandas:abrir', { nomeCliente: String(dados?.nomeCliente ?? ''), mesaRotulo: String(dados?.mesaRotulo ?? '') }),
    lancarItem: (id, item) => chamar('comandas:lancarItem', Number(id), item),
    removerItem: (id, itemId) => chamar('comandas:removerItem', Number(id), Number(itemId)),
    fechar: (id, dados) =>
      chamar('comandas:fechar', Number(id), {
        formaPagamento: String(dados?.formaPagamento ?? ''),
        imprimirConta: dados?.imprimirConta === true,
      }),
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
  impressao: {
    status: () => chamar('impressao:status'),
    config: () => chamar('impressao:config'),
    definirConfig: (dados) =>
      chamar('impressao:definirConfig', {
        modo: String(dados?.modo ?? ''),
        impressora: String(dados?.impressora ?? ''),
        largura: Number(dados?.largura),
        tabela: String(dados?.tabela ?? ''),
        guilhotina: dados?.guilhotina === true,
      }),
    testar: () => chamar('impressao:testar'),
    tentarAgora: () => chamar('impressao:tentarAgora'),
  },
  /** @returns {() => void} para parar de escutar */
  aoEvento(nome, callback) {
    if (!EVENTOS.includes(nome)) throw new Error(`Evento não permitido: ${nome}`);
    const ouvinte = (_evento, dados) => callback(dados);
    ipcRenderer.on(nome, ouvinte);
    return () => ipcRenderer.removeListener(nome, ouvinte);
  },
});
