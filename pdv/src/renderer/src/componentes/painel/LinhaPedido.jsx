import { IconeMais, IconeStatus } from '../Icones.jsx';
import { formatarDataHora, formatarPreco, formatarTelefone, NOME_PAGAMENTO } from '../../lib/formatar.js';
import { minutosDeAtraso, STATUS, estaAberto, tituloDoPedido } from '../../lib/painel.js';

/** Uma linha da lista "Entregas/Encomendas". O botão à direita abre as opções do pedido. */
export function LinhaPedido({ pedido, agora, novo, aoAbrir, aoVer }) {
  const status = STATUS[pedido.status] ?? { rotulo: pedido.status, classe: 'aberto' };
  const atraso = minutosDeAtraso(pedido, agora);
  const registrado = pedido.registradoPor ? `Registrado por: ${pedido.registradoPor}` : 'Registrado pelo site';

  return (
    <li className={`linha-pedido ${novo ? 'linha-pedido--novo' : ''}`} onPointerDown={novo ? aoVer : undefined}>
      <div className="linha-pedido__info">
        <p className="linha-pedido__titulo">
          {tituloDoPedido(pedido)}
          {pedido.canal === 'SITE' && <span className="selo selo--site">Site</span>}
          {novo && <span className="selo selo--novo">Novo</span>}
        </p>
        <p className={`status-pedido status-pedido--${status.classe}`}>
          <IconeStatus status={status.classe} /> {status.rotulo}
          {pedido.pagoEm && <span className="selo selo--pago">Pago · {NOME_PAGAMENTO[pedido.formaPagamento]}</span>}
        </p>
        {pedido.enderecoTexto && (
          <p className="linha-pedido__texto">
            {pedido.enderecoTexto}
            {pedido.bairroNome && ` · ${pedido.bairroNome}`}
          </p>
        )}
        {pedido.telefone && <p className="linha-pedido__texto">Tel.: {formatarTelefone(pedido.telefone)}</p>}
        {pedido.encomenda ? (
          <p className="linha-pedido__tempo linha-pedido__tempo--agendado">
            P/ o dia {formatarDataHora(pedido.agendadoPara)}
            {atraso > 0 && <span className="linha-pedido__atraso"> ({atraso} minutos de atraso)</span>}
          </p>
        ) : (
          pedido.tempoEstimadoMin != null && (
            <p className="linha-pedido__tempo">
              Tempo informado: {pedido.tempoEstimadoMin} minutos
              {atraso > 0 && <span className="linha-pedido__atraso"> ({atraso} minutos de atraso)</span>}
            </p>
          )
        )}
        <p className="linha-pedido__registro">
          {registrado} em {formatarDataHora(pedido.criadoEm)}
        </p>
      </div>
      <div className="linha-pedido__lado">
        <p className="linha-pedido__valor">
          <span>Vlr. pedido:</span> <strong>{formatarPreco(pedido.totalCentavos)}</strong>
        </p>
        <button type="button" className="botao-icone" onClick={() => aoAbrir(pedido.id)}
          aria-label={`Opções do pedido ${pedido.numeroDia}`} title={estaAberto(pedido) ? 'Status, finalizar, imprimir, cancelar' : 'Ver e imprimir'}>
          <IconeMais />
        </button>
      </div>
    </li>
  );
}
