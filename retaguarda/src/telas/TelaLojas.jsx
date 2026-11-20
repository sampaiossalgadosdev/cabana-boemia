import { useEffect, useState } from 'react';
import { PALETA_SUGESTOES, avaliarCor, normalizarCor } from '@restaurante/shared/cores';
import { api } from '../lib/api.js';
import { errosPorCampo, formatarWhatsapp } from '../lib/formatar.js';
import { Campo, Dialogo, EstadoCarga, Interruptor, LogoLoja, useAvisar, useCarregar } from '../componentes/comuns.jsx';
import { problemaDoArquivo } from '../lib/imagem.js';

const VAZIA = {
  slug: '',
  nome: '',
  razaoSocial: '',
  documento: '',
  endereco: '',
  whatsapp: '',
  descricao: '',
  cor: '#C8102E',
  corFundo: '',
  ordem: '0',
  ativa: true,
  turnos: 'Almoço, Lanches',
};

/** "Lanchonete do Zé" → "lanchonete-do-ze" (sugestão do endereço). */
export function slugDoNome(nome) {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Plataforma (só ADMIN): as lojas. Criar (com a cor e a logo padrão e os
 * turnos iniciais), editar todos os campos, criar o dono e abrir a retaguarda
 * da loja. A loja nasce sem cardápio: o dono cadastra na retaguarda dele.
 */
export function TelaLojas({ abrirLoja, aoMudarLoja }) {
  const carga = useCarregar(() => api.plataforma.lojas.listar());
  const [editando, setEditando] = useState(null); // loja | 'nova'
  const [donoDe, setDonoDe] = useState(null);
  const avisar = useAvisar();

  async function mudou(mensagem, loja) {
    setEditando(null);
    avisar(mensagem);
    await carga.recarregar();
    aoMudarLoja?.(loja);
  }

  return (
    <>
      <div className="pagina__topo">
        <div>
          <h1 className="pagina__titulo">Lojas</h1>
          <p className="pagina__sub">Lojas da plataforma Delivery Abatiá. A loja nasce sem cardápio: o dono cadastra na retaguarda.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('nova')}>
          + Nova loja
        </button>
      </div>
      <EstadoCarga carga={carga}>
        {({ lojas }) => (
          <section className="cartao tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Cor</th>
                  <th className="num">Equipe</th>
                  <th className="num">Pedidos</th>
                  <th>Ativa</th>
                  <th className="fim">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lojas.map((l) => (
                  <tr key={l.id} className={l.ativa ? undefined : 'linha--inativa'}>
                    <td className="produto-nome">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="logo-atual" style={{ width: 64, minHeight: 40, padding: 4 }}>
                          <LogoLoja nome={l.nome.slice(0, 1)} logoUrl={l.logoUrl} />
                        </div>
                        <div>
                          {l.nome}
                          <div className="suave">/{l.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="paleta__cor" style={{ display: 'inline-block', width: 24, height: 24, background: l.corPrimaria ?? '#C8102E', cursor: 'default' }} title={l.corPrimaria ?? 'padrão'} />
                    </td>
                    <td className="num">{l.usuarios}</td>
                    <td className="num">{l.pedidos}</td>
                    <td>{l.ativa ? 'Sim' : 'Não'}</td>
                    <td className="fim">
                      <div className="acoes" style={{ justifyContent: 'flex-end' }}>
                        <button type="button" className="botao botao--pequeno" onClick={() => setEditando(l)}>
                          Editar
                        </button>
                        <button type="button" className="botao botao--pequeno" onClick={() => setDonoDe(l)}>
                          Criar dono
                        </button>
                        <button type="button" className="botao botao--pequeno botao--primario" onClick={() => abrirLoja(l.slug)}>
                          Abrir retaguarda
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </EstadoCarga>
      <FormLoja loja={editando} aoFechar={() => setEditando(null)} aoSalvar={mudou} />
      <FormDono loja={donoDe} aoFechar={() => setDonoDe(null)} aoSalvar={(m) => { setDonoDe(null); avisar(m); carga.recarregar(); }} />
    </>
  );
}

function FormLoja({ loja, aoFechar, aoSalvar }) {
  const nova = loja === 'nova';
  const [f, setF] = useState(VAZIA);
  const [slugTocado, setSlugTocado] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!loja) return;
    setErros({});
    setErroGeral('');
    setArquivo(null);
    setSalvando(false);
    setSlugTocado(!nova);
    setF(
      nova
        ? VAZIA
        : {
            slug: loja.slug,
            nome: loja.nome,
            razaoSocial: loja.razaoSocial ?? '',
            documento: loja.documento ?? '',
            endereco: loja.endereco ?? '',
            whatsapp: loja.whatsapp ? formatarWhatsapp(loja.whatsapp) : '',
            descricao: loja.descricao ?? '',
            cor: loja.corPrimariaPadrao ?? loja.corPrimaria ?? '#C8102E',
            corFundo: loja.corFundo ?? '',
            ordem: String(loja.ordem ?? 0),
            ativa: loja.ativa,
            turnos: '',
          },
    );
  }, [loja, nova]);

  const mudar = (campo) => (e) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const avaliacao = avaliarCor(f.cor);

  async function salvar() {
    if (!avaliacao.ok) {
      setErros({ cor: avaliacao.motivo });
      return;
    }
    const dados = {
      slug: f.slug.trim(),
      nome: f.nome.trim(),
      razaoSocial: f.razaoSocial,
      documento: f.documento,
      endereco: f.endereco,
      whatsapp: f.whatsapp,
      descricao: f.descricao,
      corFundo: normalizarCor(f.corFundo),
      ordem: Number(f.ordem || 0),
      ativa: f.ativa,
    };
    if (nova) {
      dados.corPrimaria = avaliacao.cor;
      dados.turnos = f.turnos.split(',').map((t) => t.trim()).filter(Boolean);
    } else {
      dados.corPrimariaPadrao = avaliacao.cor;
    }
    setSalvando(true);
    setErros({});
    setErroGeral('');
    try {
      let { loja: salva } = nova ? await api.plataforma.lojas.criar(dados) : await api.plataforma.lojas.alterar(loja.id, dados);
      if (arquivo) ({ loja: salva } = await api.plataforma.lojas.logoPadrao(salva.id, arquivo));
      await aoSalvar(nova ? `Loja ${salva.nome} criada. Agora crie o dono dela.` : 'Loja salva.', salva);
    } catch (err) {
      const porCampo = errosPorCampo(err);
      porCampo.cor ??= porCampo.corPrimaria ?? porCampo.corPrimariaPadrao;
      setErros(porCampo);
      if (!Object.keys(porCampo).length) setErroGeral(err.message);
      setSalvando(false);
    }
  }

  const texto = (campo, rotulo, { ajuda, max = 200, ...resto } = {}) => (
    <Campo rotulo={rotulo} erro={erros[campo]} ajuda={ajuda} className={resto.inteiro ? 'inteiro' : ''}>
      {(id, d) => (
        <input
          id={id}
          className="entrada"
          maxLength={max}
          value={f[campo]}
          aria-invalid={Boolean(erros[campo]) || undefined}
          aria-describedby={d}
          onChange={(e) => {
            mudar(campo)(e);
            if (campo === 'nome' && nova && !slugTocado) setF((x) => ({ ...x, slug: slugDoNome(e.target.value) }));
            if (campo === 'slug') setSlugTocado(true);
          }}
          {...(resto.inputMode && { inputMode: resto.inputMode })}
          {...(resto.placeholder && { placeholder: resto.placeholder })}
        />
      )}
    </Campo>
  );

  return (
    <Dialogo
      aberto={Boolean(loja)}
      largo
      titulo={nova ? 'Nova loja' : `Editar ${loja?.nome ?? ''}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      <div className="grade-form">
        {texto('nome', 'Nome', { max: 100 })}
        {texto('slug', 'Endereço (slug)', { max: 60, ajuda: 'Letras minúsculas, números e hífen. Ex.: lanchonete-do-ze' })}
        {texto('razaoSocial', 'Razão social', { max: 150 })}
        {texto('documento', 'CPF ou CNPJ', { max: 18, inputMode: 'numeric' })}
        {texto('endereco', 'Endereço', { max: 200, inteiro: true })}
        {texto('whatsapp', 'WhatsApp', { max: 20, inputMode: 'tel', placeholder: '(43) 99999-0000' })}
        {texto('ordem', 'Ordem na vitrine', { max: 4, inputMode: 'numeric' })}
        <Campo rotulo="Descrição (aparece no app)" erro={erros.descricao} className="inteiro">
          {(id, d) => (
            <textarea id={id} className="entrada" rows={2} maxLength={500} value={f.descricao} aria-describedby={d} onChange={mudar('descricao')} />
          )}
        </Campo>
        <div className="campo inteiro">
          <span className="campo__rotulo">{nova ? 'Cor da loja' : 'Cor padrão'}</span>
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
                onClick={() => setF((x) => ({ ...x, cor: s.cor }))}
              />
            ))}
          </div>
          <div className="seletor-cor" style={{ marginTop: 8 }}>
            <input type="color" aria-label="Outra cor" value={normalizarCor(f.cor)?.toLowerCase() ?? '#000000'} onChange={mudar('cor')} />
            <input className="entrada entrada--curta" aria-label="Cor em hexadecimal" maxLength={7} value={f.cor} onChange={mudar('cor')} />
          </div>
          {avaliacao.ok ? (
            <span className="campo__ajuda">
              {nova ? 'É também a cor padrão: o dono pode trocar e voltar a ela.' : 'Se o dono não trocou a cor, a da loja acompanha.'}
            </span>
          ) : (
            <span className="campo__erro">{erros.cor ?? avaliacao.motivo}</span>
          )}
        </div>
        <div className="campo">
          <span className="campo__rotulo">{nova ? 'Logo' : 'Logo padrão'}</span>
          <div className="seletor-cor">
            {!nova && loja?.logoUrlPadrao && !arquivo && (
              <div className="logo-atual" style={{ width: 120, minHeight: 50 }}>
                <LogoLoja nome={loja.nome} logoUrl={loja.logoUrlPadrao} />
              </div>
            )}
            <label className="botao">
              {arquivo ? arquivo.name : 'Escolher imagem…'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visualmente-oculto"
                onChange={(e) => {
                  const a = e.target.files?.[0];
                  e.target.value = '';
                  if (!a) return;
                  const problema = problemaDoArquivo(a);
                  setErros((x) => ({ ...x, logo: problema ?? undefined }));
                  setArquivo(problema ? null : a);
                }}
              />
            </label>
          </div>
          {erros.logo ? <span className="campo__erro">{erros.logo}</span> : <span className="campo__ajuda">PNG, JPEG ou WebP, até 500 KB.</span>}
        </div>
        {texto('corFundo', 'Cor de fundo (app)', { max: 7, placeholder: '#FBF3E8', ajuda: 'Opcional. Fundo da loja no app do cliente.' })}
        {nova && texto('turnos', 'Turnos iniciais', { max: 200, inteiro: true, ajuda: 'Separados por vírgula. Os horários o dono define em Turnos e horários.' })}
        <div className="campo inteiro">
          <Interruptor ligado={f.ativa} aoMudar={(v) => setF((x) => ({ ...x, ativa: v }))} rotulo="Loja ativa (aparece no app)" />
        </div>
      </div>
    </Dialogo>
  );
}

function FormDono({ loja, aoFechar, aoSalvar }) {
  const [f, setF] = useState({ nome: '', email: '', senha: '' });
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setF({ nome: '', email: '', senha: '' });
    setErros({});
    setErroGeral('');
    setSalvando(false);
  }, [loja]);

  async function salvar() {
    setSalvando(true);
    try {
      await api.plataforma.lojas.criarDono(loja.id, { nome: f.nome.trim(), email: f.email.trim(), senha: f.senha });
      aoSalvar(`Dono de ${loja.nome} criado. Ele entra na retaguarda com este e-mail e senha.`);
    } catch (err) {
      const porCampo = errosPorCampo(err);
      setErros(porCampo);
      if (!Object.keys(porCampo).length) setErroGeral(err.message);
      setSalvando(false);
    }
  }

  const campo = (nome, rotulo, tipo = 'text') => (
    <Campo rotulo={rotulo} erro={erros[nome]}>
      {(id, d) => (
        <input
          id={id}
          type={tipo}
          className="entrada"
          value={f[nome]}
          autoComplete={tipo === 'password' ? 'new-password' : 'off'}
          aria-invalid={Boolean(erros[nome]) || undefined}
          aria-describedby={d}
          onChange={(e) => setF((x) => ({ ...x, [nome]: e.target.value }))}
        />
      )}
    </Campo>
  );

  return (
    <Dialogo
      aberto={Boolean(loja)}
      titulo={`Dono de ${loja?.nome ?? ''}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? 'Criando…' : 'Criar dono'}
          </button>
        </>
      }
    >
      {erroGeral && <div className="alerta">{erroGeral}</div>}
      {campo('nome', 'Nome')}
      {campo('email', 'E-mail', 'email')}
      {campo('senha', 'Senha (mínimo 8 caracteres)', 'password')}
    </Dialogo>
  );
}
