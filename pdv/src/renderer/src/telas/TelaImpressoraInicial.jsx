import { useEffect, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { Logo } from '../componentes/Logo.jsx';
import { CamposImpressora } from '../componentes/CamposImpressora.jsx';

/**
 * Primeira execução, passo 2 (depois do servidor): impressora e largura do papel.
 * Pode ser trocada depois pelo indicador "Impressora" da barra.
 * "Configurar depois" grava "não imprime" (assim esta tela não volta a cada abertura).
 */
export function TelaImpressoraInicial({ aoConcluir }) {
  const [form, setForm] = useState(null);
  const [impressoras, setImpressoras] = useState([]);
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    chamar(pdv.impressao.config()).then(
      (r) => {
        // Sugestão: impressora do Windows, já com a primeira da lista se houver só uma.
        const unica = r.impressoras.length === 1 ? r.impressoras[0] : '';
        setForm({ ...r.config, modo: 'impressora', impressora: r.config.impressora || unica });
        setImpressoras(r.impressoras);
      },
      (err) => setErro(err.message),
    );
  }, []);

  const mudar = (campo, valor) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setErro('');
    setAviso('');
  };

  async function salvar(dados, depois) {
    setOcupado(depois ? 'depois' : 'salvar');
    setErro('');
    try {
      await chamar(pdv.impressao.definirConfig(dados));
      aoConcluir();
    } catch (err) {
      setErro(err.message);
      setOcupado('');
    }
  }

  async function testar() {
    setOcupado('testar');
    setErro('');
    setAviso('');
    try {
      // O teste usa a configuração salva: salva antes (sem sair da tela).
      await chamar(pdv.impressao.definirConfig(form));
      await chamar(pdv.impressao.testar());
      setAviso('Cupom de teste enviado. Confira se saiu certo (acentos e corte).');
    } catch (err) {
      setErro(err.message);
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="tela-centro">
      <form
        className="cartao-login cartao-login--largo"
        onSubmit={(e) => {
          e.preventDefault();
          salvar(form, false);
        }}
      >
        <Logo className="cartao-login__logo" />
        <h1 className="cartao-login__titulo">Impressora</h1>
        <p className="cartao-login__texto">
          Escolha a impressora térmica deste computador e a largura do papel. Só um computador deve imprimir: com dois
          ligados, cada cupom sairia duas vezes.
        </p>

        {!form ? (
          <p>{erro ? '' : 'Procurando impressoras…'}</p>
        ) : (
          <>
            <CamposImpressora form={form} impressoras={impressoras} mudar={mudar} />
            {form.modo === 'impressora' && impressoras.length === 0 && (
              <p className="aviso">Nenhuma impressora instalada no Windows. Instale o driver da térmica ou use o modo teste.</p>
            )}
          </>
        )}

        {erro && <p className="erro" role="alert">{erro}</p>}
        {aviso && <p className="aviso-sucesso" role="status">{aviso}</p>}

        <div className="cartao-login__acoes">
          <button type="button" className="botao botao--contorno" disabled={!form || Boolean(ocupado) || form.modo === 'desligado'}
            onClick={testar}>
            {ocupado === 'testar' ? 'Imprimindo…' : 'Imprimir teste'}
          </button>
          <button type="submit" className="botao" disabled={!form || Boolean(ocupado)}>
            {ocupado === 'salvar' ? 'Salvando…' : 'Salvar e continuar'}
          </button>
        </div>
        <button type="button" className="link cartao-login__depois" disabled={Boolean(ocupado)}
          onClick={() => salvar({ ...(form ?? {}), modo: 'desligado' }, true)}>
          Configurar depois (este computador não imprime por enquanto)
        </button>
      </form>
    </div>
  );
}
