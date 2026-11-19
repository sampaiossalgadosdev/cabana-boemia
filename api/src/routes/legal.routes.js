import { Router } from 'express';
import { formatarTelefone } from '@restaurante/shared/telefone';
import { assincrono } from '../lib/assincrono.js';
import { documento, escapar, responderPagina } from '../lib/paginaPublica.js';
import * as publicoService from '../services/publico.service.js';

/**
 * Política de privacidade e termos de uso do APP Delivery Abatiá, em nome da
 * plataforma (controladora dos dados). Páginas públicas da API, fora do site
 * (o site continua com /privacidade e /termos da Cabana Boemia). São os links
 * do app, do Play Console e da App Store.
 *
 * RASCUNHO: precisa de revisão jurídica antes da produção (ver CLAUDE.md).
 */
export const CAMINHO_PRIVACIDADE_APP = '/privacidade-app';
export const CAMINHO_TERMOS_APP = '/termos-app';

/** Data de vigência dos dois textos. Mudou o texto: atualizar. */
export const VIGENCIA = '19 de novembro de 2026';

/** Contato: WhatsApp da configuração (quando preenchido) + formulário de /excluir-conta. */
export function contatoHtml(whatsapp) {
  const numero = String(whatsapp ?? '').replace(/\D/g, '');
  const local = numero.startsWith('55') ? numero.slice(2) : numero;
  const zap = numero
    ? `<li>WhatsApp: <a href="https://wa.me/${numero}">${escapar(formatarTelefone(local))}</a></li>`
    : '';
  return `<ul>${zap}<li>Formulário em <a href="/excluir-conta">/excluir-conta</a> (exclusão da conta e outros pedidos sobre seus dados: escreva na observação).</li></ul>`;
}

const rodape = (outro) =>
  `Vigente desde ${VIGENCIA}. ${outro} · <a href="/excluir-conta">Excluir minha conta</a>`;

export function paginaPrivacidade(whatsapp) {
  return documento({
    titulo: 'Política de privacidade',
    rodape: rodape('<a href="/termos-app">Termos de uso</a>'),
    corpo: `
<section>
  <p>Esta política explica como o <strong>Delivery Abatiá</strong>, plataforma de pedidos das lojas de Abatiá-PR, trata os seus dados pessoais no app Delivery Abatiá. O Delivery Abatiá é o <strong>controlador</strong> desses dados, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).</p>
</section>
<section>
  <h2>1. Dados que coletamos</h2>
  <ul>
    <li><strong>Conta</strong>: nome e e-mail, recebidos do Google ou da Apple quando você entra. Com a Apple, o e-mail pode ser um endereço de retransmissão criado por ela.</li>
    <li><strong>Telefone</strong> (celular), que você informa para receber o pedido.</li>
    <li><strong>Endereços de entrega</strong>: rua, número, complemento, ponto de referência e bairro.</li>
    <li><strong>Histórico de pedidos</strong>: itens, observações, valores, forma de pagamento, troco, data e hora, endereço e loja.</li>
    <li><strong>Registros de acesso</strong>: endereço IP, data e hora e o endereço acessado em nossos servidores.</li>
  </ul>
  <p>Não coletamos localização do aparelho, contatos, fotos nem dados de cartão. O pagamento é feito na entrega, direto com a loja.</p>
</section>
<section>
  <h2>2. Para que usamos</h2>
  <ul>
    <li>Criar e manter a sua conta e identificar você nos próximos pedidos (execução do contrato).</li>
    <li>Enviar o pedido à loja, para ela preparar, entregar e falar com você sobre ele (execução do contrato).</li>
    <li>Mostrar o seu histórico e permitir repetir pedidos (execução do contrato).</li>
    <li>Cumprir obrigações legais, como a guarda de registros de acesso e de registros fiscais (obrigação legal).</li>
    <li>Proteger a plataforma contra fraude e abuso, por exemplo limitando tentativas de login (legítimo interesse).</li>
  </ul>
  <p>Não usamos seus dados para publicidade e não os vendemos.</p>
</section>
<section>
  <h2>3. Com quem compartilhamos</h2>
  <ul>
    <li><strong>A loja do seu pedido</strong> recebe nome, telefone, endereço de entrega, itens, observações e forma de pagamento, <strong>somente para preparar e entregar aquele pedido</strong>.</li>
    <li><strong>Google ou Apple</strong>, apenas para confirmar a sua identidade no login.</li>
    <li><strong>Hospedagem</strong>: os dados ficam em servidores contratados da Railway (Railway Corporation), que podem estar fora do Brasil. A transferência segue o art. 33 da LGPD.</li>
    <li><strong>Autoridades</strong>, quando houver obrigação legal ou ordem judicial.</li>
  </ul>
</section>
<section>
  <h2>4. Por quanto tempo guardamos</h2>
  <ul>
    <li><strong>Conta, telefone e endereços</strong>: enquanto a conta existir. Ao excluir, são apagados na hora (pelo app) ou em até 15 dias (pelo formulário).</li>
    <li><strong>Pedidos</strong>: valores, itens e datas por até 5 anos, por obrigações fiscais e para atender reclamações. Se você excluir a conta, os pedidos ficam <strong>sem</strong> seu nome, telefone e endereço.</li>
    <li><strong>Registros de acesso</strong>: 6 meses, como exige o Marco Civil da Internet (Lei 12.965/2014, art. 15).</li>
    <li><strong>Pedidos de exclusão feitos pelo formulário</strong>: até serem atendidos e pelo tempo necessário para comprovar o atendimento.</li>
  </ul>
</section>
<section>
  <h2>5. Seus direitos</h2>
  <p>Pela LGPD (art. 18), você pode pedir: confirmação de que tratamos seus dados; acesso a eles; correção de dados incompletos ou errados (nome, telefone e endereços também se corrigem no app, em Perfil); anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informação sobre com quem compartilhamos; eliminação dos dados e revogação do consentimento, quando for o caso. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
</section>
<section>
  <h2>6. Como excluir sua conta</h2>
  <ul>
    <li>No app: <strong>Perfil › Excluir minha conta</strong>. A exclusão é imediata. Se você fez um pedido nas últimas 3 horas, ela fica liberada 3 horas depois dele.</li>
    <li>Sem o app: pelo formulário em <a href="/excluir-conta">/excluir-conta</a>.</li>
  </ul>
</section>
<section>
  <h2>7. Segurança</h2>
  <p>A comunicação entre o app e os servidores é criptografada (HTTPS). A sessão fica guardada na área segura do aparelho (Keychain no iPhone, Keystore no Android). O acesso aos dados é restrito a quem precisa deles para operar a plataforma e as lojas.</p>
</section>
<section>
  <h2>8. Crianças</h2>
  <p>O app é destinado a maiores de 18 anos.</p>
</section>
<section>
  <h2>9. Contato</h2>
  ${contatoHtml(whatsapp)}
</section>
<section>
  <h2>10. Mudanças nesta política</h2>
  <p>Se esta política mudar, a nova versão será publicada aqui com a nova data de vigência. Mudanças importantes serão avisadas no app.</p>
</section>`,
  });
}

export function paginaTermos(whatsapp) {
  return documento({
    titulo: 'Termos de uso',
    rodape: rodape('<a href="/privacidade-app">Política de privacidade</a>'),
    corpo: `
<section>
  <p>Estes termos valem para o uso do app <strong>Delivery Abatiá</strong>, plataforma que reúne o cardápio de lojas de Abatiá-PR e envia os seus pedidos a elas. Ao usar o app, você concorda com estes termos e com a <a href="/privacidade-app">política de privacidade</a>.</p>
</section>
<section>
  <h2>1. O que é a plataforma</h2>
  <p>O Delivery Abatiá intermedeia o pedido entre você e a loja. <strong>Cada loja é responsável</strong> pelos produtos, preços, preparo, entrega, troca e emissão de documentos fiscais dos pedidos feitos a ela.</p>
</section>
<section>
  <h2>2. Conta</h2>
  <ul>
    <li>Para pedir, você entra com Google ou Apple e informa um celular válido.</li>
    <li>Mantenha seus dados de contato e endereços corretos: a loja usa esses dados para entregar.</li>
    <li>Você pode excluir a conta quando quiser (Perfil › Excluir minha conta, ou <a href="/excluir-conta">/excluir-conta</a>).</li>
  </ul>
</section>
<section>
  <h2>3. Pedidos</h2>
  <ul>
    <li>O cardápio, os preços e a disponibilidade são da loja e podem mudar. O total é conferido no envio: se algum preço mudou, o app avisa e pede nova confirmação antes de criar o pedido.</li>
    <li>O pedido está feito quando o app mostra "Pedido nº … recebido!". O tempo de entrega informado é uma estimativa.</li>
    <li>Pedidos só são aceitos no horário de funcionamento da loja e enquanto houver estoque.</li>
  </ul>
</section>
<section>
  <h2>4. Pagamento</h2>
  <p>O pagamento é feito <strong>na entrega, direto à loja</strong> (Pix, dinheiro ou cartão), pelo valor confirmado no app. A plataforma não cobra nem guarda dados de pagamento.</p>
</section>
<section>
  <h2>5. Cancelamento</h2>
  <p>Para cancelar, fale com a loja pelo WhatsApp (o link aparece na tela do pedido enviado). O cancelamento depende de o pedido ainda não ter saído para entrega.</p>
</section>
<section>
  <h2>6. Uso adequado</h2>
  <p>Não é permitido fazer pedidos falsos, usar dados de outra pessoa ou tentar burlar o funcionamento do app. Nesses casos a conta pode ser bloqueada.</p>
</section>
<section>
  <h2>7. Disponibilidade</h2>
  <p>O app pode ficar fora do ar para manutenção ou por falhas de rede. Sem conexão, o app mostra o último cardápio salvo, mas não envia pedidos.</p>
</section>
<section>
  <h2>8. Mudanças nestes termos</h2>
  <p>Se os termos mudarem, a nova versão será publicada aqui com a nova data de vigência.</p>
</section>
<section>
  <h2>9. Lei aplicável</h2>
  <p>Valem as leis brasileiras, em especial o Código de Defesa do Consumidor. Fica eleito o foro do domicílio do consumidor.</p>
</section>
<section>
  <h2>10. Contato</h2>
  ${contatoHtml(whatsapp)}
</section>`,
  });
}

export function criarRotasLegais() {
  const r = Router();
  const whatsapp = async () => (await publicoService.config().catch(() => null))?.whatsapp ?? '';
  r.get(
    CAMINHO_PRIVACIDADE_APP,
    assincrono(async (req, res) => responderPagina(res, 200, paginaPrivacidade(await whatsapp()), { indexar: true })),
  );
  r.get(
    CAMINHO_TERMOS_APP,
    assincrono(async (req, res) => responderPagina(res, 200, paginaTermos(await whatsapp()), { indexar: true })),
  );
  return r;
}
