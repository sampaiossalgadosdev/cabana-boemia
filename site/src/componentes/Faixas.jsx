import { quandoAbre } from '../lib/horario.js';

/** Loja fechada: o cardápio aparece como prévia, sem permitir pedido. */
export function AvisoFechado({ proximaAbertura }) {
  return (
    <div className="faixa" role="note">
      <strong>Estamos fechados agora.</strong>
      {proximaAbertura
        ? `Dá uma olhada no cardápio: os pedidos abrem ${quandoAbre(proximaAbertura.em)}.`
        : 'Os pedidos voltam assim que abrirmos.'}
    </div>
  );
}

/** Atualização falhou: o cardápio mostrado é o último que chegou. */
export function FaixaSemConexao() {
  return (
    <div className="faixa faixa--conexao" role="status">
      <strong>Sem conexão.</strong>
      Mostrando o último cardápio carregado; tentando de novo…
    </div>
  );
}
