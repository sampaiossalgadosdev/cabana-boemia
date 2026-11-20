import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatarReais } from '../lib/dinheiro.js';
import {
  SITUACOES_ANUNCIO,
  deCampoDataHora,
  errosPorCampo,
  formatarDataHora,
  formatarDocumento,
  paraCampoDataHora,
} from '../lib/formatar.js';
import { problemaDoArquivo } from '../lib/imagem.js';
import { Campo, CampoDinheiro, Dialogo, EstadoCarga, Interruptor, useAvisar, useCarregar } from '../componentes/comuns.jsx';

const VAZIO = {
  anuncianteNome: '',
  anuncianteDocumento: '',
  destino: 'LOJA',
  destinoLojaId: '',
  destinoUrl: '',
  inicio: '',
  fim: '',
  valorPagoCentavos: null,
  ordem: '0',
  ativo: true,
  naoDirigidoACriancas: false,
};

/**
 * Plataforma (só ADMIN): anúncios do carrossel "Patrocinado" no Início do app.
 * Registro da veiculação (anunciante, CPF/CNPJ, imagem, destino, período,
 * valor pago). Não há excluir: desativar tira do ar e o registro fica (o banco
 * guarda até 1 ano depois do fim).
 */
export function TelaAnuncios() {
  const carga = useCarregar(() => Promise.all([api.plataforma.anuncios.listar(), api.plataforma.lojas.listar()]));
  const [editando, setEditando] = useState(null); // anúncio | 'novo'
  const avisar = useAvisar();

  async function alternar(a) {
    try {
      await api.plataforma.anuncios.alterar(a.id, { ativo: !a.ativo });
      avisar(a.ativo ? 'Anúncio desativado (saiu do app).' : 'Anúncio reativado.');
      await carga.recarregar();
    } catch (err) {
      avisar(err.message);
    }
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Anúncios</h1>
          <p className="pagina__sub">
            Carrossel &quot;Patrocinado&quot; do Início do app. Os registros ficam guardados por pelo menos 1 ano depois do fim da veiculação (não há excluir).
          </p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
          + Novo anúncio
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {([{ anuncios }, { lojas }]) => (
          <>
            <section className="cartao tabela-rolagem">
              {anuncios.length === 0 ? (
                <p className="estado">Nenhum anúncio cadastrado.</p>
              ) : (
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Anúncio</th>
                      <th>Destino</th>
                      <th>Período</th>
                      <th className="num">Valor pago</th>
                      <th>Situação</th>
                      <th className="fim">
                        <span className="visualmente-oculto">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {anuncios.map((a) => {
                      const sit = SITUACOES_ANUNCIO[a.situacao];
                      return (
                        <tr key={a.id} className={a.situacao === 'NO_AR' ? undefined : 'linha--inativa'}>
                          <td className="produto-nome">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <img className="anuncio-miniatura" src={a.imagemUrl} alt="" />
                              <div>
                                {a.anuncianteNome}
                                <div className="suave">{formatarDocumento(a.anuncianteDocumento)}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ maxWidth: 220, whiteSpace: 'normal', wordBreak: 'break-all' }}>
                            {a.destino === 'LOJA' ? `Loja: ${a.destinoLoja?.nome}` : a.destinoUrl}
                          </td>
                          <td>
                            {formatarDataHora(a.inicio)}
                            <div className="suave">até {formatarDataHora(a.fim)}</div>
                          </td>
                          <td className="num">{formatarReais(a.valorPagoCentavos)}</td>
                          <td>
                            <span className={`etiqueta ${sit.classe}`}>{sit.texto}</span>
                          </td>
                          <td className="fim">
                            <div className="acoes" style={{ justifyContent: 'flex-end' }}>
                              <button type="button" className="botao botao--pequeno" onClick={() => setEditando(a)}>
                                Editar
                              </button>
                              <button type="button" className="botao botao--pequeno" onClick={() => alternar(a)}>
                                {a.ativo ? 'Desativar' : 'Reativar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <FormAnuncio
              anuncio={editando}
              lojas={lojas}
              aoFechar={() => setEditando(null)}
              aoSalvar={async (mensagem) => {
                setEditando(null);
                avisar(mensagem);
                await carga.recarregar();
              }}
            />
          </>
        )}
      </EstadoCarga>
    </>
  );
}

function FormAnuncio({ anuncio, lojas, aoFechar, aoSalvar }) {
  const novo = anuncio === 'novo';
  const [f, setF] = useState(VAZIO);
  const [imagem, setImagem] = useState(null); // { imagemId, imagemUrl } enviada agora
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!anuncio) return;
    setErros({});
    setErroGeral('');
    setImagem(null);
    setSalvando(false);
    setF(
      novo
        ? VAZIO
        : {
            anuncianteNome: anuncio.anuncianteNome,
            anuncianteDocumento: formatarDocumento(anuncio.anuncianteDocumento),
            destino: anuncio.destino,
            destinoLojaId: anuncio.destinoLoja ? String(anuncio.destinoLoja.id) : '',
            destinoUrl: anuncio.destinoUrl ?? '',
            inicio: paraCampoDataHora(anuncio.inicio),
            fim: paraCampoDataHora(anuncio.fim),
            valorPagoCentavos: anuncio.valorPagoCentavos,
            ordem: String(anuncio.ordem),
            ativo: anuncio.ativo,
            naoDirigidoACriancas: true,
          },
    );
  }, [anuncio, novo]);

  const mudar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const imagemAtual = imagem?.imagemUrl ?? (novo ? null : anuncio?.imagemUrl);

  async function escolherImagem(arquivo) {
    const problema = problemaDoArquivo(arquivo);
    if (problema) {
      setErros((x) => ({ ...x, imagemId: problema.replace('A logo', 'A imagem') }));
      return;
    }
    setEnviando(true);
    setErros((x) => ({ ...x, imagemId: undefined }));
    try {
      setImagem(await api.plataforma.anuncios.enviarImagem(arquivo));
    } catch (err) {
      setErros((x) => ({ ...x, imagemId: err.message }));
    } finally {
      setEnviando(false);
    }
  }

  async function salvar() {
    const locais = {};
    if (novo && !imagem) locais.imagemId = 'Envie a imagem do anúncio';
    if (!deCampoDataHora(f.inicio)) locais.inicio = 'Informe o início';
    if (!deCampoDataHora(f.fim)) locais.fim = 'Informe o fim';
    if (f.valorPagoCentavos == null) locais.valorPagoCentavos = 'Informe o valor pago (0 se for cortesia)';
    if (f.destino === 'LOJA' && !f.destinoLojaId) locais.destinoLojaId = 'Escolha a loja';
    if (novo && !f.naoDirigidoACriancas) locais.naoDirigidoACriancas = 'Confirme para continuar';
    if (Object.keys(locais).length) {
      setErros(locais);
      return;
    }
    const dados = {
      anuncianteNome: f.anuncianteNome.trim(),
      anuncianteDocumento: f.anuncianteDocumento,
      destino: f.destino,
      destinoLojaId: f.destino === 'LOJA' ? Number(f.destinoLojaId) : null,
      destinoUrl: f.destino === 'LINK' ? f.destinoUrl.trim() : null,
      inicio: deCampoDataHora(f.inicio),
      fim: deCampoDataHora(f.fim),
      valorPagoCentavos: f.valorPagoCentavos,
      ordem: Number(f.ordem || 0),
      ativo: f.ativo,
    };
    if (imagem) dados.imagemId = imagem.imagemId;
    if (novo) dados.naoDirigidoACriancas = true;
    setSalvando(true);
    setErros({});
    setErroGeral('');
    try {
      if (novo) await api.plataforma.anuncios.criar(dados);
      else await api.plataforma.anuncios.alterar(anuncio.id, dados);
      await aoSalvar(novo ? 'Anúncio cadastrado.' : 'Anúncio salvo.');
    } catch (err) {
      const porCampo = errosPorCampo(err);
      setErros(porCampo);
      if (!Object.keys(porCampo).length) setErroGeral(err.message);
      setSalvando(false);
    }
  }

  const texto = (campo, rotulo, { ajuda, max = 150, inteiro, ...resto } = {}) => (
    <Campo rotulo={rotulo} erro={erros[campo]} ajuda={ajuda} className={inteiro ? 'inteiro' : ''}>
      {(id, d) => (
        <input
          id={id}
          className="entrada"
          maxLength={max}
          value={f[campo]}
          aria-invalid={Boolean(erros[campo]) || undefined}
          aria-describedby={d}
          onChange={mudar(campo)}
          {...resto}
        />
      )}
    </Campo>
  );

  return (
    <Dialogo
      aberto={Boolean(anuncio)}
      largo
      titulo={novo ? 'Novo anúncio' : `Editar anúncio de ${anuncio?.anuncianteNome ?? ''}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando || enviando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      <div className="grade-form">
        {texto('anuncianteNome', 'Anunciante (nome ou razão social)')}
        {texto('anuncianteDocumento', 'CPF ou CNPJ do anunciante', { max: 18, inputMode: 'numeric' })}

        <div className="campo inteiro">
          <span className="campo__rotulo">Imagem</span>
          <div className="seletor-cor">
            {imagemAtual && <img className="anuncio-previa" src={imagemAtual} alt="Imagem do anúncio" />}
            <label className="botao">
              {enviando ? 'Enviando…' : imagemAtual ? 'Trocar imagem…' : 'Escolher imagem…'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visualmente-oculto"
                disabled={enviando}
                onChange={(e) => {
                  const a = e.target.files?.[0];
                  e.target.value = '';
                  if (a) escolherImagem(a);
                }}
              />
            </label>
          </div>
          {erros.imagemId ? (
            <span className="campo__erro">{erros.imagemId}</span>
          ) : (
            <span className="campo__ajuda">PNG, JPEG ou WebP, até 500 KB. Formato 2:1 (ex.: 1200 × 600). O app põe a etiqueta &quot;Patrocinado&quot; por cima.</span>
          )}
        </div>

        <div className="campo inteiro">
          <span className="campo__rotulo">Ao tocar no anúncio</span>
          <div className="opcoes" role="radiogroup" aria-label="Destino">
            {[
              ['LOJA', 'Abre uma loja do app'],
              ['LINK', 'Abre um link (https)'],
            ].map(([valor, rotulo]) => (
              <label key={valor} className="opcao">
                <input type="radio" name="destino" value={valor} checked={f.destino === valor} onChange={mudar('destino')} /> {rotulo}
              </label>
            ))}
          </div>
        </div>
        {f.destino === 'LOJA' ? (
          <Campo rotulo="Loja" erro={erros.destinoLojaId} className="inteiro">
            {(id, d) => (
              <select id={id} className="entrada" value={f.destinoLojaId} aria-describedby={d} onChange={mudar('destinoLojaId')}>
                <option value="">Escolha…</option>
                {lojas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                    {l.ativa ? '' : ' (inativa: o anúncio não aparece)'}
                  </option>
                ))}
              </select>
            )}
          </Campo>
        ) : (
          texto('destinoUrl', 'Link', { max: 500, inteiro: true, placeholder: 'https://', inputMode: 'url' })
        )}

        {texto('inicio', 'Início (horário de Brasília)', { type: 'datetime-local' })}
        {texto('fim', 'Fim', { type: 'datetime-local', ajuda: 'Sai do app neste horário.' })}
        <Campo rotulo="Valor pago (R$)" erro={erros.valorPagoCentavos}>
          {(id, d) => (
            <CampoDinheiro
              id={id}
              valor={f.valorPagoCentavos}
              invalido={Boolean(erros.valorPagoCentavos)}
              descritoPor={d}
              aoMudar={(c) => setF((x) => ({ ...x, valorPagoCentavos: c }))}
            />
          )}
        </Campo>
        {texto('ordem', 'Ordem no carrossel', { max: 4, inputMode: 'numeric', ajuda: 'Menor aparece primeiro.' })}

        <div className="campo inteiro">
          <Interruptor ligado={f.ativo} aoMudar={(v) => setF((x) => ({ ...x, ativo: v }))} rotulo="Ativo (aparece no app dentro do período)" />
        </div>
        {novo && (
          <div className="campo inteiro">
            <label className="declaracao">
              <input
                type="checkbox"
                checked={f.naoDirigidoACriancas}
                onChange={(e) => setF((x) => ({ ...x, naoDirigidoACriancas: e.target.checked }))}
              />
              <span>
                Confirmo que o anúncio <strong>não é dirigido a crianças</strong> (linguagem, personagens, brinquedos ou promoções infantis), como exigem o CDC (art. 37, § 2º) e a Resolução Conanda 163/2014.
              </span>
            </label>
            {erros.naoDirigidoACriancas && <span className="campo__erro">{erros.naoDirigidoACriancas}</span>}
          </div>
        )}
      </div>
    </Dialogo>
  );
}
