import { useEffect, useRef, useState } from 'react';
import { chamar, pdv } from '../lib/pdv.js';
import { resumoImpressao } from '../lib/impressao.js';

const MODOS = [
  { valor: 'desligado', rotulo: 'Desligada', dica: 'Este computador não imprime (use no PDV que não fica no balcão).' },
  { valor: 'impressora', rotulo: 'Impressora do Windows', dica: 'Térmica USB instalada com o driver.' },
  { valor: 'arquivo', rotulo: 'Modo teste (.txt)', dica: 'Sem impressora: cada cupom vira um arquivo de texto.' },
];

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

  // Nome salvo que não aparece mais no Windows continua na lista (para ver o que estava).
  const opcoes = form?.impressora && !impressoras.includes(form.impressora) ? [form.impressora, ...impressoras] : impressoras;
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
          <>
            <fieldset className="painel__grupo">
              <legend>Este computador</legend>
              {MODOS.map((m) => (
                <label key={m.valor} className={`opcao opcao--linha ${form.modo === m.valor ? 'opcao--marcada' : ''}`}>
                  <input type="radio" name="modo" value={m.valor} checked={form.modo === m.valor}
                    onChange={() => mudar('modo', m.valor)} />
                  <span>
                    <strong>{m.rotulo}</strong>
                    <small>{m.dica}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="campo">
              <span>Impressora instalada no Windows</span>
              <select value={form.impressora} disabled={form.modo !== 'impressora'}
                onChange={(e) => mudar('impressora', e.target.value)}>
                <option value="">Escolha…</option>
                {opcoes.map((nome) => (
                  <option key={nome} value={nome}>{nome}</option>
                ))}
              </select>
            </label>

            <div className="painel__linha">
              <fieldset className="painel__grupo">
                <legend>Largura do papel</legend>
                {[[48, '80 mm (48 colunas)'], [32, '58 mm (32 colunas)']].map(([v, rotulo]) => (
                  <label key={v} className={`opcao ${form.largura === v ? 'opcao--marcada' : ''}`}>
                    <input type="radio" name="largura" checked={form.largura === v} onChange={() => mudar('largura', v)} />
                    {rotulo}
                  </label>
                ))}
              </fieldset>

              <label className="campo">
                <span>Tabela de caracteres</span>
                <select value={form.tabela} onChange={(e) => mudar('tabela', e.target.value)}>
                  <option value="cp860">cp860 (português)</option>
                  <option value="cp850">cp850 (multilíngue)</option>
                </select>
              </label>

              <label className="opcao opcao--caixa">
                <input type="checkbox" checked={form.guilhotina} onChange={(e) => mudar('guilhotina', e.target.checked)} />
                Cortar o papel (guilhotina)
              </label>
            </div>
          </>
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
