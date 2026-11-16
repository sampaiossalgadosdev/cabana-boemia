import { useEffect, useState } from 'react';
import { sessao, aoExpirarSessao } from './lib/api.js';
import { TELAS, useRota } from './lib/rotas.js';
import { Logo, useAvisar } from './componentes/comuns.jsx';
import {
  IconeBairros,
  IconeCardapioDia,
  IconeCategorias,
  IconeConfig,
  IconeEquipe,
  IconeEstoque,
  IconeMenu,
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
import { TelaBairros } from './telas/TelaBairros.jsx';
import { TelaEquipe } from './telas/TelaEquipe.jsx';
import { TelaConfiguracoes } from './telas/TelaConfiguracoes.jsx';

const ICONES = {
  'cardapio-do-dia': IconeCardapioDia,
  relatorio: IconeRelatorio,
  produtos: IconeProdutos,
  categorias: IconeCategorias,
  estoque: IconeEstoque,
  turnos: IconeRelogio,
  bairros: IconeBairros,
  equipe: IconeEquipe,
  configuracoes: IconeConfig,
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
  configuracoes: TelaConfiguracoes,
};

export function App() {
  const [usuario, setUsuario] = useState(undefined); // undefined = restaurando
  const [erroInicial, setErroInicial] = useState('');
  const avisar = useAvisar();

  async function restaurar() {
    setErroInicial('');
    try {
      setUsuario(await sessao.restaurar());
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
  if (!usuario) return <TelaLogin aoEntrar={setUsuario} />;
  return <Estrutura usuario={usuario} aoSair={() => setUsuario(null)} />;
}

function Estrutura({ usuario, aoSair }) {
  const [tela, ir] = useRota();
  const [menuAberto, setMenuAberto] = useState(false);
  const Tela = COMPONENTES[tela];
  const titulo = TELAS.find((t) => t.caminho === tela).titulo;

  useEffect(() => {
    document.title = `${titulo} · Retaguarda · Cabana Boemia`;
  }, [titulo]);

  useEffect(() => {
    if (!menuAberto) return undefined;
    const fechar = (e) => e.key === 'Escape' && setMenuAberto(false);
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [menuAberto]);

  async function sair() {
    await sessao.sair();
    aoSair();
  }

  return (
    <div className={`estrutura${menuAberto ? ' estrutura--menu-aberto' : ''}`}>
      <header className="topo-movel">
        <button type="button" onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto}>
          <IconeMenu />
        </button>
        <span>{titulo}</span>
      </header>

      <nav
        className="menu"
        aria-label="Retaguarda"
        onClick={(e) => {
          if (e.target === e.currentTarget) setMenuAberto(false);
        }}
      >
        <div className="menu__logo">
          <Logo />
        </div>
        {TELAS.map((t) => {
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
          <p className="menu__usuario">{usuario.nome}</p>
          <button type="button" className="botao botao--menu-sair" onClick={sair}>
            <IconeSair /> Sair
          </button>
        </div>
      </nav>

      <main className="conteudo">
        <div className="pagina">
          <Tela ir={ir} />
        </div>
      </main>
    </div>
  );
}
