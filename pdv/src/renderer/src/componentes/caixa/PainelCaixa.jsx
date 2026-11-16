import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../../lib/pdv.js';
import { formatarHora, formatarPreco } from '../../lib/formatar.js';
import { avisoCaixaEsquecido, lerValorCaixa, removerPendente } from '../../lib/caixa.js';
import { PendentesFechamento } from './PendentesFechamento.jsx';

const ABAS = [
  ['SANGRIA', 'Sangria'],
  ['SUPRIMENTO', 'Suprimento'],
  ['FECHAR', 'Fechar caixa'],
];

/**
 * Painel do botão "Caixa": sangria, suprimento e fechamento cego (só o valor
 * contado; o PDV nunca vê o esperado nem a diferença).
 */
export function PainelCaixa({ caixa, aoMudar, aoFechado, aoFechar }) {
  const dialogo = useRef(null);
  const [aba, setAba] = useState('SANGRIA');
  const [valor, setValor] = useState('');
  const [texto, setTexto] = useState(''); // motivo ou observação
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [pendentes, setPendentes] = useState(null);
  const esquecido = avisoCaixaEsquecido(caixa);

  useEffect(() => {
    dialogo.current?.showModal();
  }, []);

  function trocarAba(a) {
    setAba(a);
    setValor('');
    setTexto('');
    setErro('');
    setAviso('');
  }

  async function enviar(e) {
    e.preventDefault();
    const fechar = aba === 'FECHAR';
    const { centavos, erro: invalido } = lerValorCaixa(valor, { minimo: fechar ? 0 : 1 });
    if (invalido) return setErro(invalido);
    if (!fechar && !texto.trim()) return setErro('Informe o motivo');
    setEnviando(true);
    setErro('');
    setAviso('');
    try {
      if (fechar) {
        await chamar(pdv.caixa.fechar({ valorContadoCentavos: centavos, observacao: texto }));
        aoFechado('Caixa fechado. O resumo foi enviado para a impressora.');
        dialogo.current?.close();
        return;
      }
      const r = await chamar(pdv.caixa.movimento({ tipo: aba, valorCentavos: centavos, motivo: texto }));
      aoMudar(r.caixa);
      setAviso(
        aba === 'SANGRIA'
          ? `Sangria de ${formatarPreco(centavos)} registrada.`
          : `Suprimento de ${formatarPreco(centavos)} registrado.`,
      );
      setValor('');
      setTexto('');
    } catch (err) {
      if (err.codigo === 'PEDIDOS_ABERTOS') setPendentes(err.detalhes?.pedidos ?? []);
      else setErro(err.message);
    } finally {
      setEnviando(false);
    }
  }

  const fechar = aba === 'FECHAR';
  return (
    <dialog ref={dialogo} className="painel painel-caixa" onClose={aoFechar} aria-labelledby="titulo-caixa">
      <div className="painel__corpo">
        <div className="painel__topo">
          <h2 id="titulo-caixa">Caixa</h2>
          <span className="texto-suave">
            Aberto às {formatarHora(caixa.abertoEm)} por {caixa.abertoPor?.nome} · fundo {formatarPreco(caixa.valorInicialCentavos)}
          </span>
        </div>
        {esquecido && <p className="aviso" role="alert">{esquecido}. Feche este caixa e abra um novo.</p>}

        <div className="segmentado" role="tablist" aria-label="Operação">
          {ABAS.map(([id, nome]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id}
              className={`segmentado__opcao ${aba === id ? 'segmentado__opcao--ativa' : ''}`} onClick={() => trocarAba(id)}>
              {nome}
            </button>
          ))}
        </div>

        <form className="painel-caixa__form" onSubmit={enviar}>
          <label className="campo">
            {fechar ? 'Dinheiro contado na gaveta (R$)' : 'Valor (R$)'}
            <input className="campo__grande" inputMode="decimal" placeholder="0,00" value={valor} disabled={enviando}
              autoFocus key={aba} onChange={(e) => {
                setValor(e.target.value);
                setErro('');
              }} />
          </label>
          <label className="campo">
            {fechar ? 'Observação (opcional)' : 'Motivo'}
            <input value={texto} maxLength={fechar ? 500 : 140} disabled={enviando}
              placeholder={aba === 'SANGRIA' ? 'Ex.: depósito no banco' : aba === 'SUPRIMENTO' ? 'Ex.: troco trazido do banco' : ''}
              onChange={(e) => setTexto(e.target.value)} />
          </label>
          {fechar && (
            <p className="texto-suave">Conte todo o dinheiro da gaveta e digite o total. O resumo sai na impressora.</p>
          )}
          {erro && <p className="erro" role="alert">{erro}</p>}
          {aviso && <p className="aviso-sucesso" role="status">{aviso}</p>}
          <div className="painel__acoes">
            <button type="button" className="botao botao--contorno" disabled={enviando} onClick={() => dialogo.current?.close()}>
              Voltar
            </button>
            <button type="submit" className={`botao ${fechar ? 'botao--perigo' : ''}`} disabled={enviando}>
              {enviando ? 'Enviando…' : fechar ? 'Fechar caixa' : `Registrar ${aba === 'SANGRIA' ? 'sangria' : 'suprimento'}`}
            </button>
          </div>
        </form>

        {fechar && pendentes &&
          (pendentes.length ? (
            <PendentesFechamento pedidos={pendentes} aoResolver={(id) => setPendentes((l) => removerPendente(l, id))} />
          ) : (
            <p className="aviso-sucesso" role="status">Tudo resolvido. Toque em "Fechar caixa" de novo.</p>
          ))}

        {!fechar && caixa.movimentos.length > 0 && (
          <ul className="painel-caixa__movimentos" aria-label="Movimentos do caixa">
            {caixa.movimentos.map((m) => (
              <li key={m.id}>
                <span>{formatarHora(m.criadoEm)}</span>
                <span>{m.tipo === 'SANGRIA' ? 'Sangria' : 'Suprimento'} · {m.motivo}</span>
                <strong>{m.tipo === 'SANGRIA' ? '−' : '+'}{formatarPreco(m.valorCentavos)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
