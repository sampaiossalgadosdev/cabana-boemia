import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { resumoImpressao } from '../lib/impressao.js';
import { CamposImpressora } from './CamposImpressora.jsx';


/**
 * Configuração da impressora deste computador (salva no config.json do PDV).
 * Só um PDV deve imprimir: com dois ligados, cada cupom sairia duas vezes.
 */
export function PainelImpressora({ status, aoFechar }) {
  const dialogo = useRef(null);
  const [form, setForm] = useState(null);
  const [impressoras, setImpressoras] = useState([]);
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    dialogo.current?.showModal();
    chamar(pdv.impressao.config()).then(
      (r) => {
        setForm(r.config);
        setImpressoras(r.impressoras);
      },
      (err) => setErro(err.message),
    );
  }, []);

  const mudar = (campo, valor) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setAviso('');
  };

  async function acao(nome, fn, sucesso) {
    setOcupado(nome);
    setErro('');
    setAviso('');
    try {
      await fn();
      setAviso(sucesso);
    } catch (err) {
      setErro(err.message);
    } finally {
      setOcupado('');
    }
  }

  const salvar = (e) => {
    e.preventDefault();
    acao('salvar', async () => setForm(await chamar(pdv.impressao.definirConfig(form))), 'Configuração salva.');
  };

  const r = resumoImpressao(status);

  return (
    <dialog ref={dialogo} className="painel" onClose={aoFechar} aria-labelledby="titulo-impressora">
      <form className="painel__corpo" onSubmit={salvar}>
        <header className="painel__topo">
          <h2 id="titulo-impressora">Impressora</h2>
          <span className={`conexao impressora impressora--${r.classe}`}>
            <span className="conexao__ponto" aria-hidden="true" />
            {r.texto}
          </span>
        </header>
        {status?.mensagem && status.estado !== 'ok' && <p className="aviso">{status.mensagem}</p>}

        {!form ? (
          <p>Carregando…</p>
        ) : (
          <CamposImpressora form={form} impressoras={impressoras} mudar={mudar} />
        )}

        {erro && <p className="erro" role="alert">{erro}</p>}
        {aviso && <p className="aviso-sucesso" role="status">{aviso}</p>}

        <footer className="painel__acoes">
          <button type="button" className="botao botao--contorno" onClick={() => dialogo.current?.close()}>
            Fechar
          </button>
          <button type="button" className="botao botao--contorno" disabled={!form || Boolean(ocupado)}
            onClick={() => acao('testar', () => chamar(pdv.impressao.testar()), 'Cupom de teste enviado.')}>
            {ocupado === 'testar' ? 'Imprimindo…' : 'Imprimir teste'}
          </button>
          <button type="button" className="botao botao--contorno" disabled={!form || Boolean(ocupado) || form.modo === 'desligado'}
            onClick={() => acao('tentar', () => chamar(pdv.impressao.tentarAgora()), 'Fila conferida.')}>
            {ocupado === 'tentar' ? 'Conferindo…' : 'Tentar agora'}
          </button>
          <button type="submit" className="botao" disabled={!form || Boolean(ocupado)}>
            {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
