import { useEffect, useState } from 'react';
import { PALETA_SUGESTOES, avaliarCor, normalizarCor, variaveisDoTema } from '@restaurante/shared/cores';
import { api } from '../lib/api.js';
import { TIPOS_LOGO, problemaDoArquivo } from '../lib/imagem.js';
import { Confirmar, EstadoCarga, LogoLoja, useAvisar, useCarregar } from '../componentes/comuns.jsx';

/** Arquivo → data: URL (a prévia; a CSP da retaguarda libera data: em imagem). */
const lerComoDataUrl = (arquivo) =>
  new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    leitor.readAsDataURL(arquivo);
  });

/**
 * Perfil da loja: a logo e a cor primária que aparecem na retaguarda, no PDV e
 * no app do cliente. Prévia ao vivo; cor ilegível não salva (o texto por cima
 * fica claro ou escuro sozinho). "Voltar ao padrão" volta ao que o
 * administrador definiu ao criar a loja.
 */
export function TelaPerfil({ aoMudarLoja }) {
  const carga = useCarregar(() => api.perfil.obter());
  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Perfil da loja</h1>
          <p className="pagina__sub">Logo e cor da loja na retaguarda, no PDV e no app do cliente.</p>
        </div>
      </div>
      <EstadoCarga carga={carga}>
        {({ perfil }) => (
          <FormPerfil
            perfil={perfil}
            aoSalvar={async (novo) => {
              aoMudarLoja?.(novo);
              await carga.recarregar();
            }}
          />
        )}
      </EstadoCarga>
    </>
  );
}

function FormPerfil({ perfil, aoSalvar }) {
  const avisar = useAvisar();
  const [cor, setCor] = useState(perfil.corPrimaria ?? perfil.corPrimariaPadrao ?? '#C8102E');
  const [arquivo, setArquivo] = useState(null);
  const [previaLogo, setPreviaLogo] = useState(null);
  const [erroArquivo, setErroArquivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);

  useEffect(() => {
    setCor(perfil.corPrimaria ?? perfil.corPrimariaPadrao ?? '#C8102E');
    setArquivo(null);
    setPreviaLogo(null);
  }, [perfil]);

  const avaliacao = avaliarCor(cor);
  const corMudou = avaliacao.cor !== (perfil.corPrimaria ?? null);
  const mudou = (corMudou && avaliacao.ok) || Boolean(arquivo);
  const logoDaPrevia = previaLogo ?? perfil.logoUrl;
  const v = variaveisDoTema(avaliacao.ok ? avaliacao.cor : null);
  const estiloPrevia = {
    '--previa-cor': v['--cor-primaria'],
    '--previa-texto': v['--cor-primaria-texto'],
    '--previa-escura': v['--cor-primaria-escura'],
    '--previa-escura-texto': v['--cor-primaria-escura-texto'],
    '--previa-na-base': v['--cor-primaria-na-base'],
  };

  async function escolherArquivo(e) {
    const a = e.target.files?.[0];
    e.target.value = '';
    if (!a) return;
    const problema = problemaDoArquivo(a);
    setErroArquivo(problema ?? '');
    if (problema) return;
    try {
      setPreviaLogo(await lerComoDataUrl(a));
      setArquivo(a);
    } catch (err) {
      setErroArquivo(err.message);
    }
  }

  async function salvar() {
    if (!avaliacao.ok) return;
    setSalvando(true);
    try {
      let novo = perfil;
      if (arquivo) novo = (await api.perfil.logo(arquivo)).perfil;
      if (corMudou) novo = (await api.perfil.cor(avaliacao.cor)).perfil;
      avisar('Perfil da loja salvo.');
      await aoSalvar(novo);
    } catch (err) {
      avisar(err.message, 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <section className="cartao" style={{ padding: 16, display: 'grid', gap: 20 }}>
        <div className="campo">
          <span className="campo__rotulo">Logo</span>
          <div className="seletor-cor">
            <div className="logo-atual">
              <LogoLoja nome={perfil.nome} logoUrl={logoDaPrevia} />
            </div>
            <label className="botao">
              Escolher imagem…
              <input type="file" accept={TIPOS_LOGO.join(',')} className="visualmente-oculto" onChange={escolherArquivo} />
            </label>
            {arquivo && (
              <button
                type="button"
                className="botao botao--texto"
                onClick={() => {
                  setArquivo(null);
                  setPreviaLogo(null);
                }}
              >
                Desfazer
              </button>
            )}
          </div>
          {erroArquivo ? (
            <span className="campo__erro">{erroArquivo}</span>
          ) : (
            <span className="campo__ajuda">PNG, JPEG ou WebP, até 500 KB. De preferência com fundo transparente.</span>
          )}
        </div>

        <div className="campo">
          <span className="campo__rotulo">Cor da loja</span>
          <div className="paleta" role="group" aria-label="Sugestões de cor">
            {PALETA_SUGESTOES.map((s) => (
              <button
                key={s.cor}
                type="button"
                className="paleta__cor"
                style={{ background: s.cor }}
                title={s.nome}
                aria-label={s.nome}
                aria-pressed={avaliacao.cor === s.cor}
                onClick={() => setCor(s.cor)}
              />
            ))}
          </div>
          <div className="seletor-cor" style={{ marginTop: 10 }}>
            <input
              type="color"
              aria-label="Escolher outra cor"
              value={normalizarCor(cor)?.toLowerCase() ?? '#000000'}
              onChange={(e) => setCor(e.target.value)}
            />
            <input
              className="entrada entrada--curta"
              aria-label="Cor em hexadecimal"
              value={cor}
              maxLength={7}
              onChange={(e) => setCor(e.target.value)}
              aria-invalid={!avaliacao.ok || undefined}
            />
          </div>
          {avaliacao.ok ? (
            <span className="campo__ajuda">
              Texto dos botões: {avaliacao.texto === '#FFFFFF' ? 'claro' : 'escuro'} (ajustado sozinho; contraste {String(avaliacao.contrasteTexto).replace('.', ',')}:1).
            </span>
          ) : (
            <span className="campo__erro">{avaliacao.motivo}</span>
          )}
        </div>

        <div className="campo">
          <span className="campo__rotulo">Prévia</span>
          <div className="previa" style={estiloPrevia} aria-label="Prévia da retaguarda com a cor e a logo escolhidas">
            <div className="previa__menu">
              <div className="previa__logo">
                <LogoLoja nome={perfil.nome} logoUrl={logoDaPrevia} />
              </div>
              <span className="previa__item previa__item--ativo">Cardápio do dia</span>
              <span className="previa__item">Produtos</span>
              <span className="previa__item">Relatório</span>
            </div>
            <div className="previa__corpo">
              <p className="previa__titulo">{perfil.nome}</p>
              <div className="previa__abas">
                <span className="previa__aba previa__aba--ativa">Almoço</span>
                <span className="previa__aba">Lanches</span>
              </div>
              <span className="previa__botao">Salvar</span>
            </div>
          </div>
        </div>

        <div className="acoes">
          <button type="button" className="botao botao--primario" disabled={!mudou || salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            className="botao"
            disabled={perfil.noPadrao || salvando}
            onClick={() =>
              setConfirmar({
                titulo: 'Voltar ao padrão?',
                texto: 'A logo e a cor voltam às definidas pelo administrador quando a loja foi criada.',
                confirmar: 'Voltar ao padrão',
                acao: async () => {
                  const { perfil: novo } = await api.perfil.voltarAoPadrao();
                  avisar('Logo e cor voltaram ao padrão.');
                  await aoSalvar(novo);
                },
              })
            }
          >
            Voltar ao padrão
          </button>
          {perfil.corPrimariaPadrao && (
            <span className="suave" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Padrão:
              <span className="paleta__cor" style={{ width: 20, height: 20, background: perfil.corPrimariaPadrao, cursor: 'default' }} />
              {perfil.corPrimariaPadrao}
            </span>
          )}
        </div>
      </section>
      <Confirmar pedido={confirmar} aoFechar={() => setConfirmar(null)} />
    </>
  );
}
