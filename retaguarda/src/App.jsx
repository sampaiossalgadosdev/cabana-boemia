import { useEffect, useState } from 'react';
import { api, sessao, aoExpirarSessao } from './lib/api.js';
import { TELAS, telaPermitida, telasDoMenu, useRota } from './lib/rotas.js';
import { aplicarTema } from './lib/tema.js';
import { escolherLoja, lembrarLoja } from './lib/lojaEscolhida.js';
import { LogoLoja, useAvisar, useCarregar } from './componentes/comuns.jsx';
import {
  IconeBairros,
  IconeCardapioDia,
  IconeCategorias,
  IconeConfig,
  IconeEquipe,
  IconeEstoque,
  IconeLixo,
  IconeLoja,
  IconeMenu,
  IconeMegafone,
  IconePaleta,
  IconeProdutos,
  IconeRelatorio,
  IconeRelogio,
  IconeSair,
} from './componentes/Icones.jsx';
import { TelaLogin } from './telas/TelaLogin.jsx';
import { TelaCardapioDoDia } from './telas/TelaCardapioDoDia.jsx';
import { TelaProdutos } from './telas/TelaProdutos.jsx';
import { TelaRelatorio } from './telas/TelaRelatorio.jsx';
import { TelaCategorias } from './telas/TelaCategorias.jsx';
import { TelaEstoque } from './telas/TelaEstoque.jsx';
import { TelaTurnos } from './telas/TelaTurnos.jsx';
import { TelaBairros, TelaBairrosCidade } from './telas/TelaBairros.jsx';
import { TelaEquipe } from './telas/TelaEquipe.jsx';
import { TelaConfiguracoes } from './telas/TelaConfiguracoes.jsx';
import { TelaPerfil } from './telas/TelaPerfil.jsx';
import { TelaLojas } from './telas/TelaLojas.jsx';
import { TelaExclusoes } from './telas/TelaExclusoes.jsx';
import { TelaAnuncios } from './telas/TelaAnuncios.jsx';

const ICONES = {
  'cardapio-do-dia': IconeCardapioDia,
  relatorio: IconeRelatorio,
  produtos: IconeProdutos,
  categorias: IconeCategorias,
  estoque: IconeEstoque,
  turnos: IconeRelogio,
  bairros: IconeBairros,
  equipe: IconeEquipe,
  perfil: IconePaleta,
  configuracoes: IconeConfig,
  lojas: IconeLoja,
  'bairros-cidade': IconeBairros,
  anuncios: IconeMegafone,
  exclusoes: IconeLixo,
};

const COMPONENTES = {
  'cardapio-do-dia': TelaCardapioDoDia,
  relatorio: TelaRelatorio,
  produtos: TelaProdutos,
  categorias: TelaCategorias,
  estoque: TelaEstoque,
  turnos: TelaTurnos,
  bairros: TelaBairros,
  equipe: TelaEquipe,
  perfil: TelaPerfil,
  configuracoes: TelaConfiguracoes,
  lojas: TelaLojas,
  'bairros-cidade': TelaBairrosCidade,
  anuncios: TelaAnuncios,
  exclusoes: TelaExclusoes,
};

export function App() {
  const [usuario, setUsuario] = useState(undefined); // undefined = restaurando
  const [erroInicial, setErroInicial] = useState('');
  const avisar = useAvisar();

  /** ADMIN volta na loja em que estava; DONO nunca manda X-Loja (a API sabe a loja dele). */
  function prepararLoja(u) {
    if (u?.papel === 'ADMIN') lembrarLoja();
    else escolherLoja(null);
    setUsuario(u);
  }

  async function restaurar() {
    setErroInicial('');
    try {
      prepararLoja(await sessao.restaurar());
    } catch (err) {
      setErroInicial(err.message);
    }
  }

  useEffect(() => {
    restaurar();
    return aoExpirarSessao(() => {
      setUsuario(null);
      avisar('Sua sessão expirou. Entre de novo.', 'erro');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sem loja (login, plataforma): tema padrão do Delivery Abatiá.
  useEffect(() => {
    if (!usuario) aplicarTema(null);
  }, [usuario]);

  if (erroInicial) {
    return (
      <div className="login">
        <div className="login__cartao" style={{ textAlign: 'center' }}>
          <p>{erroInicial}</p>
          <button type="button" className="botao botao--primario" onClick={restaurar}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (usuario === undefined) return <div className="login" aria-busy="true" />;
  if (!usuario) return <TelaLogin aoEntrar={prepararLoja} />;
  return <Estrutura usuario={usuario} aoSair={() => setUsuario(null)} />;
}

function Estrutura({ usuario, aoSair }) {
  const admin = usuario.papel === 'ADMIN';
  // Loja aberta (identidade: slug, nome, logo, cor). DONO: a dele. ADMIN: a que escolher (null = plataforma).
  const [loja, setLoja] = useState(admin ? null : usuario.loja);
  const lojas = useCarregar(() => (admin ? api.plataforma.lojas.listar() : Promise.resolve(null)), [admin]);
  const [telaPedida, ir] = useRota();
  const [menuAberto, setMenuAberto] = useState(false);
  // ADMIN: até a lista chegar não sabe se volta numa loja; não monta tela nenhuma (nada vai sem X-Loja).
  const decidindo = admin && !lojas.dados && !lojas.erro;
  const menu = telasDoMenu(usuario.papel, Boolean(loja));
  const tela = telaPermitida(telaPedida, menu);
  const Tela = COMPONENTES[tela];
  const titulo = TELAS.find((t) => t.caminho === tela).titulo;
  const [tema, setTema] = useState(() => aplicarTema(loja));

  useEffect(() => {
    setTema(aplicarTema(loja));
  }, [loja]);

  // ADMIN: ao recarregar, volta na loja que tinha aberto (se ela ainda existe).
  useEffect(() => {
    if (!admin || !lojas.dados) return;
    const slug = lembrarLoja();
    const achada = lojas.dados.lojas.find((l) => l.slug === slug) ?? null;
    if (!achada) escolherLoja(null);
    setLoja((atual) => (atual && achada && atual.slug === achada.slug ? { ...atual, ...achada } : achada));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojas.dados]);

  useEffect(() => {
    document.title = `${titulo} · ${tema.nome}`;
  }, [titulo, tema.nome]);

  useEffect(() => {
    if (!menuAberto) return undefined;
    const fechar = (e) => e.key === 'Escape' && setMenuAberto(false);
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [menuAberto]);

  async function sair() {
    escolherLoja(null);
    await sessao.sair();
    aoSair();
  }

  /** ADMIN abre a retaguarda de uma loja (ou volta à plataforma). */
  function abrirLoja(slug) {
    const achada = lojas.dados?.lojas.find((l) => l.slug === slug) ?? null;
    escolherLoja(achada?.slug ?? null);
    setLoja(achada);
    ir(telasDoMenu(usuario.papel, Boolean(achada))[0].caminho);
    setMenuAberto(false);
  }

  /** Perfil salvo (cor/logo) ou loja editada pelo ADMIN: o tema muda na hora. */
  function lojaMudou(nova) {
    if (nova && loja && nova.slug === loja.slug) setLoja((l) => ({ ...l, ...nova }));
    if (admin) lojas.recarregar();
  }

  return (
    <div className={`estrutura${menuAberto ? ' estrutura--menu-aberto' : ''}`}>
      <header className="topo-movel">
        <button type="button" onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto}>
          <IconeMenu />
        </button>
        <span>
          {titulo} · {tema.nome}
        </span>
      </header>

      <nav
        className="menu"
        aria-label="Retaguarda"
        onClick={(e) => {
          if (e.target === e.currentTarget) setMenuAberto(false);
        }}
      >
        <div className="menu__logo">
          <LogoLoja nome={tema.nome} logoUrl={tema.logoUrl} />
        </div>
        {tema.logoUrl && <p className="menu__loja">{tema.nome}</p>}
        {admin && (
          <label className="menu__seletor">
            <span>Loja aberta</span>
            <select className="entrada" value={loja?.slug ?? ''} onChange={(e) => abrirLoja(e.target.value)}>
              <option value="">Plataforma (todas as lojas)</option>
              {(lojas.dados?.lojas ?? []).map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.nome}
                  {l.ativa ? '' : ' (inativa)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {menu.map((t) => {
          const Icone = ICONES[t.caminho];
          return (
            <a
              key={t.caminho}
              href={`${import.meta.env.BASE_URL}${t.caminho}`}
              className="menu__item"
              aria-current={tela === t.caminho ? 'page' : undefined}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                ir(t.caminho);
                setMenuAberto(false);
              }}
            >
              <Icone />
              {t.titulo}
            </a>
          );
        })}
        <div className="menu__rodape">
          <p className="menu__usuario">
            {usuario.nome}
            {admin && ' · administrador'}
          </p>
          <button type="button" className="botao botao--menu-sair" onClick={sair}>
            <IconeSair /> Sair
          </button>
        </div>
      </nav>

      <main className="conteudo">
        <div className="pagina">
          {decidindo ? (
            <div className="estado">Carregando…</div>
          ) : (
            // Trocar de loja remonta a tela (recarrega os dados da outra loja).
            <Tela key={loja?.slug ?? 'plataforma'} ir={ir} usuario={usuario} loja={loja} aoMudarLoja={lojaMudou} abrirLoja={abrirLoja} />
          )}
        </div>
      </main>
    </div>
  );
}
