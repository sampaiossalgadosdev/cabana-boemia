import { useEffect, useState } from 'react';
import { NomeRestaurante } from './NomeRestaurante.jsx';
import { buscarConfig } from '../lib/api.js';

/** Caminhos das páginas legais (o Google exige a de privacidade para publicar o login). */
export const PAGINAS_LEGAIS = { '/privacidade': 'privacidade', '/termos': 'termos' };

const ATUALIZADO_EM = '16 de novembro de 2026';

/** Contato: WhatsApp da configuração, se o dono já cadastrou. */
function Contato({ whatsapp }) {
  if (!whatsapp) return <>pelo WhatsApp ou pessoalmente no restaurante</>;
  return (
    <>
      pelo WhatsApp{' '}
      <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">
        +{whatsapp}
      </a>{' '}
      ou pessoalmente no restaurante
    </>
  );
}

function Privacidade({ whatsapp }) {
  return (
    <>
      <h2>Política de Privacidade</h2>
      <p className="legal__data">Última atualização: {ATUALIZADO_EM}</p>
      <p>
        Esta política explica quais dados o site de pedidos do restaurante <strong>Cabana Boemia</strong> (Abatiá-PR)
        coleta, para que usa e quais são os seus direitos, de acordo com a Lei Geral de Proteção de Dados (Lei
        13.709/2018).
      </p>

      <h3>Dados que coletamos</h3>
      <ul>
        <li>
          <strong>Da sua conta Google</strong>, quando você entra para finalizar um pedido: nome, e-mail e o
          identificador da conta. Não recebemos a sua senha do Google.
        </li>
        <li>
          <strong>Informados por você</strong>: telefone e endereços de entrega.
        </li>
        <li>
          <strong>Dos seus pedidos</strong>: itens, observações, forma de pagamento, valores, data e hora.
        </li>
      </ul>

      <h3>Para que usamos</h3>
      <ul>
        <li>Preparar, entregar e cobrar os seus pedidos.</li>
        <li>Falar com você sobre o pedido (por telefone ou WhatsApp).</li>
        <li>Preencher seus dados no próximo pedido e permitir repetir o último pedido.</li>
      </ul>
      <p>Não usamos seus dados para propaganda e não vendemos seus dados.</p>

      <h3>Compartilhamento</h3>
      <p>
        Seus dados ficam com o restaurante. Usamos o login do Google para identificar você e um serviço de hospedagem
        em nuvem para guardar os dados do sistema. Fora isso, só compartilhamos dados se a lei exigir.
      </p>

      <h3>No seu aparelho</h3>
      <p>
        O site guarda no navegador do seu celular o carrinho e a sessão de login, para você não perder o pedido nem
        precisar entrar de novo a cada visita. Não usamos cookies de propaganda nem ferramentas de rastreamento.
      </p>

      <h3>Por quanto tempo</h3>
      <p>
        Guardamos os dados enquanto você usar o site e pelo tempo necessário para cumprir obrigações legais (por
        exemplo, registros de vendas).
      </p>

      <h3>Seus direitos</h3>
      <p>
        Você pode pedir para ver, corrigir ou apagar seus dados, ou tirar dúvidas sobre esta política, falando com o
        restaurante <Contato whatsapp={whatsapp} />.
      </p>
    </>
  );
}

function Termos({ whatsapp }) {
  return (
    <>
      <h2>Termos de Uso</h2>
      <p className="legal__data">Última atualização: {ATUALIZADO_EM}</p>
      <p>
        Ao fazer um pedido pelo site do restaurante <strong>Cabana Boemia</strong> (Abatiá-PR), você concorda com
        estes termos.
      </p>

      <h3>Pedidos</h3>
      <ul>
        <li>O site só aceita pedidos no horário de funcionamento mostrado no cardápio.</li>
        <li>
          Os produtos dependem da disponibilidade do dia. Se algo acabar ou o preço mudar antes do envio, o site avisa
          e mostra o valor atualizado antes de você confirmar.
        </li>
        <li>O pedido vale depois de enviado e recebe um número, mostrado na tela.</li>
      </ul>

      <h3>Preços, taxa e pagamento</h3>
      <ul>
        <li>Valem os preços mostrados no momento do envio do pedido.</li>
        <li>A taxa de entrega depende do bairro e aparece no resumo antes de enviar.</li>
        <li>
          O pagamento é feito na entrega (Pix, dinheiro, débito ou crédito). Se precisar de troco, informe para
          quanto ao escolher dinheiro.
        </li>
      </ul>

      <h3>Entrega</h3>
      <p>
        O tempo de entrega mostrado é uma estimativa e pode variar com o movimento. Confira o endereço e o telefone
        antes de enviar: eles são usados para a entrega e para falar com você.
      </p>

      <h3>Cancelamento</h3>
      <p>
        Para cancelar ou alterar um pedido, fale com o restaurante <Contato whatsapp={whatsapp} /> o quanto antes,
        informando o número do pedido. Pedidos que já saíram para entrega podem não ser cancelados.
      </p>

      <h3>Seus dados</h3>
      <p>
        O uso dos seus dados está descrito na <a href="/privacidade">Política de Privacidade</a>.
      </p>
    </>
  );
}

/** Página de texto simples, sem carrinho nem login. */
export function PaginaLegal({ tipo }) {
  const [whatsapp, setWhatsapp] = useState('');

  useEffect(() => {
    document.title = `${tipo === 'privacidade' ? 'Política de Privacidade' : 'Termos de Uso'} · Cabana Boemia`;
    buscarConfig()
      .then((c) => setWhatsapp(c?.whatsapp ?? ''))
      .catch(() => {}); // sem rede: o texto sai sem o número
  }, [tipo]);

  return (
    <div className="legal">
      <header className="cabecalho">
        <a href="/" className="legal__inicio" aria-label="Voltar ao cardápio">
          <NomeRestaurante />
        </a>
      </header>
      <main className="conteudo legal__texto">
        {tipo === 'privacidade' ? <Privacidade whatsapp={whatsapp} /> : <Termos whatsapp={whatsapp} />}
        <p className="legal__voltar">
          <a href="/" className="botao botao--secundario">
            Ver o cardápio
          </a>
        </p>
      </main>
    </div>
  );
}

/** Links no fim do cardápio (o Google pede a política acessível pela página inicial). */
export function RodapeLegal() {
  return (
    <footer className="conteudo rodape-legal">
      <a href="/privacidade">Política de Privacidade</a>
      <span aria-hidden="true">·</span>
      <a href="/termos">Termos de Uso</a>
    </footer>
  );
}
