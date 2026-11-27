import { Router } from 'express';
import { documento, escapar, responderPagina } from '../lib/paginaPublica.js';
import { CONTROLADOR, DOCUMENTOS_APP, emailDoTitular, identificacaoDoControlador } from '../lib/controlador.js';
import { RETENCAO_MESES } from '../services/registroAcesso.service.js';

/**
 * Política de privacidade e termos de uso do APP Taaki Delivery, em nome da
 * plataforma (controladora dos dados; ver lib/controlador.js). Páginas
 * públicas da API, fora do site (o site continua com /privacidade e /termos da
 * Cabana Boemia). São os links do app, do Play Console e da App Store.
 *
 * RASCUNHO: precisa de revisão jurídica antes da produção (ver CLAUDE.md).
 */
export const CAMINHO_PRIVACIDADE_APP = '/privacidade-app';
export const CAMINHO_TERMOS_APP = '/termos-app';

/**
 * Data de vigência dos dois textos. Mudou o texto: atualizar `DOCUMENTOS_APP`
 * (lib/controlador.js), versão e vigência: o app pede o aceite de novo.
 */
export const VIGENCIA = DOCUMENTOS_APP.vigencia;

/** Canal do titular: o e-mail (quando configurado) e o formulário de /excluir-conta. */
export function contatoHtml(email) {
  const linhaEmail = email
    ? `<li>E-mail: <a href="mailto:${escapar(email)}">${escapar(email)}</a></li>`
    : '';
  return `<ul>${linhaEmail}<li>Formulário em <a href="/excluir-conta">/excluir-conta</a> (exclusão da conta e outros pedidos sobre seus dados: escreva na observação).</li></ul>
  <p class="nota">Dúvidas sobre um pedido (atraso, troca, cancelamento) são com a loja, pelo WhatsApp que aparece na tela do pedido enviado.</p>`;
}

const rodape = (outro) => `Vigente desde ${VIGENCIA}. ${outro} · <a href="/excluir-conta">Excluir minha conta</a>`;

/** Bloco do controlador e do encarregado. */
function controladorHtml(c = CONTROLADOR) {
  const encarregado = c.pequenoPorte
    ? '<p>Como agente de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022), não há encarregado (DPO) nomeado: o canal de contato da seção "Contato" cumpre essa função.</p>'
    : '';
  return `<p>Controlador dos dados: <strong>${escapar(identificacaoDoControlador(c))}</strong>.</p>${encarregado}`;
}

export function paginaPrivacidade(email, c = CONTROLADOR, origem = undefined) {
  return documento({
    titulo: 'Política de privacidade',
    descricao:
      'Como o Taaki Delivery, app de pedidos das lojas de Abatiá-PR, coleta, usa e protege os seus dados pessoais, de acordo com a LGPD.',
    caminho: CAMINHO_PRIVACIDADE_APP,
    origem,
    rodape: rodape('<a href="/termos-app">Termos de uso</a>'),
    corpo: `
<section>
  <p>Esta política explica como o <strong>Taaki Delivery</strong>, plataforma de pedidos das lojas de Abatiá-PR, trata os seus dados pessoais no app Taaki Delivery. O Taaki Delivery é o <strong>controlador</strong> desses dados, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).</p>
  ${controladorHtml(c)}
</section>
<section>
  <h2>1. Dados que coletamos</h2>
  <ul>
    <li><strong>Conta</strong>: nome e e-mail, recebidos do Google ou da Apple quando você entra. Com a Apple, o e-mail pode ser um endereço de retransmissão criado por ela.</li>
    <li><strong>Telefone</strong> (celular), que você informa para receber o pedido.</li>
    <li><strong>Endereços de entrega</strong>: rua, número, complemento, ponto de referência e bairro.</li>
    <li><strong>Localização do endereço no mapa</strong> (latitude e longitude do pino), que você confirma no app: pela busca do endereço digitado, tocando ou arrastando o pino no mapa, ou pelo botão <strong>"Usar minha localização"</strong>. Nesse caso o app lê a localização do aparelho (GPS) <strong>uma vez, só quando você toca no botão</strong> e só com o app aberto, para posicionar o pino; nunca em segundo plano, e não guardamos o histórico de onde você esteve.</li>
    <li><strong>Histórico de pedidos</strong>: itens, observações, valores, forma de pagamento, troco, data e hora, endereço (com a localização do pino no momento do pedido), loja e a distância da loja até o endereço.</li>
    <li><strong>Registros de acesso</strong>: endereço IP e data e hora de quando você entra na conta, quando o app renova a sua sessão, quando envia um pedido e quando exclui a conta.</li>
    <li><strong>Seus aceites e escolhas</strong>: a versão destes documentos que você aceitou e quando, e se você quer receber ofertas e novidades (com data e endereço IP de cada escolha).</li>
  </ul>
  <p>Não coletamos a localização do aparelho em segundo plano, contatos, fotos nem dados de cartão, e o app não usa identificador de publicidade nem rastreia você em outros apps ou sites. O pagamento é feito na entrega, direto com a loja.</p>
</section>
<section>
  <h2>2. Para que usamos</h2>
  <ul>
    <li>Criar e manter a sua conta e identificar você nos próximos pedidos (execução do contrato).</li>
    <li>Enviar o pedido à loja, para ela preparar, entregar e falar com você sobre ele (execução do contrato).</li>
    <li>Mostrar o seu histórico e permitir repetir pedidos (execução do contrato).</li>
    <li>Marcar no mapa o lugar exato da entrega e calcular a distância da loja até o endereço, para a entrega chegar ao lugar certo (execução do contrato).</li>
    <li>Cumprir obrigações legais, como a guarda de registros de acesso e de registros fiscais (obrigação legal).</li>
    <li>Proteger a plataforma contra fraude e abuso, por exemplo limitando tentativas de login (legítimo interesse).</li>
    <li>Guardar a prova do seu aceite destes documentos e das suas escolhas de comunicação (obrigação legal e exercício de direitos).</li>
    <li><strong>Somente se você autorizar</strong> (consentimento, opcional): enviar ofertas e novidades das lojas e do Taaki Delivery. Você liga ou desliga isso quando quiser em <strong>Perfil › Comunicações</strong>; desligar não afeta seus pedidos.</li>
  </ul>
  <p>Não vendemos seus dados e não os usamos para publicidade direcionada.</p>
</section>
<section>
  <h2>3. Com quem compartilhamos</h2>
  <ul>
    <li><strong>A loja do seu pedido</strong> recebe somente o seu <strong>nome, telefone, endereço de entrega e os itens do pedido</strong> (com a localização do endereço no mapa e a distância, as observações e a forma de pagamento escolhida), com o <strong>único fim de preparar e entregar aquele pedido</strong>. A loja <strong>não pode usar esses dados para nenhuma outra finalidade</strong>, como propaganda ou cadastro próprio.</li>
    <li><strong>Google ou Apple</strong>, apenas para confirmar a sua identidade no login.</li>
    <li><strong>Google (Google Maps Platform)</strong>, para mostrar o mapa no app, achar no mapa o endereço digitado (enviamos só rua, número, bairro e cidade, sem nome nem telefone) e calcular a distância pelas ruas entre a loja e o endereço (enviamos só as duas posições). O Google trata esses dados conforme a política de privacidade dele.</li>
    <li><strong>Hospedagem</strong>: os dados ficam em servidores da Railway (Railway Corporation) nos <strong>Estados Unidos</strong> (região US East). Isso é uma <strong>transferência internacional de dados</strong>, feita para executar o contrato com você e com as garantias do art. 33 da LGPD (contrato com o provedor, que se obriga a proteger os dados, comunicação criptografada e acesso restrito).</li>
    <li><strong>Autoridades</strong>, quando houver obrigação legal ou ordem judicial.</li>
  </ul>
</section>
<section>
  <h2>4. Anúncios</h2>
  <p>O início do app pode mostrar anúncios marcados como <strong>"Patrocinado"</strong>, de lojas ou de outros anunciantes. São os mesmos para todos: <strong>não usamos seus dados para escolher anúncios</strong> e <strong>nenhum dado seu é enviado aos anunciantes</strong>, nem registramos em quais anúncios você toca. Tocar num anúncio abre a loja no app ou o site do anunciante; fora do app vale a política de privacidade do site aberto. Não aceitamos anúncios dirigidos a crianças.</p>
</section>
<section>
  <h2>5. Por quanto tempo guardamos</h2>
  <ul>
    <li><strong>Conta, telefone e endereços</strong> (com a localização no mapa): enquanto a conta existir. Ao excluir, são apagados na hora (pelo app) ou em até 15 dias (pelo formulário).</li>
    <li><strong>Pedidos</strong>: valores, itens e datas pelo prazo exigido pela legislação fiscal e de defesa do consumidor. Se você excluir a conta, os pedidos ficam <strong>sem</strong> seu nome, telefone, endereço e localização.</li>
    <li><strong>Registros de acesso</strong>: ${RETENCAO_MESES} meses, como exige o Marco Civil da Internet (Lei 12.965/2014, art. 15), mesmo depois da exclusão da conta. Passado esse prazo, são apagados automaticamente.</li>
    <li><strong>Aceites e escolhas de comunicação</strong>: enquanto a conta existir; são apagados com ela.</li>
    <li><strong>Pedidos de exclusão feitos pelo formulário</strong>: até serem atendidos e pelo tempo necessário para comprovar o atendimento.</li>
  </ul>
</section>
<section>
  <h2>6. Seus direitos</h2>
  <p>Pela LGPD (art. 18), você pode pedir: confirmação de que tratamos seus dados; acesso a eles; correção de dados incompletos ou errados (nome, telefone e endereços também se corrigem no app, em Perfil); anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informação sobre com quem compartilhamos; eliminação dos dados e revogação do consentimento, quando for o caso. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
</section>
<section>
  <h2>7. Como excluir sua conta</h2>
  <ul>
    <li>No app: <strong>Perfil › Excluir minha conta</strong>. A exclusão é imediata. Se um pedido seu ainda está sendo preparado ou entregue (feito nas últimas 3 horas), ela fica liberada quando ele for entregue ou 3 horas depois do pedido.</li>
    <li>Sem o app: pelo formulário em <a href="/excluir-conta">/excluir-conta</a>.</li>
  </ul>
</section>
<section>
  <h2>8. Segurança</h2>
  <p>A comunicação entre o app e os servidores é criptografada (HTTPS). A sessão fica guardada na área segura do aparelho (Keychain no iPhone, Keystore no Android). O acesso aos dados é restrito a quem precisa deles para operar a plataforma e as lojas.</p>
</section>
<section>
  <h2>9. Crianças</h2>
  <p>O app é destinado a maiores de 18 anos.</p>
</section>
<section>
  <h2>10. Contato</h2>
  ${contatoHtml(email)}
</section>
<section>
  <h2>11. Mudanças nesta política</h2>
  <p>Se esta política mudar, a nova versão será publicada aqui com a nova data de vigência, e o app pedirá que você leia e aceite a nova versão antes de continuar.</p>
</section>`,
  });
}

export function paginaTermos(email, c = CONTROLADOR, origem = undefined) {
  return documento({
    titulo: 'Termos de uso',
    descricao:
      'Regras de uso do app Taaki Delivery: conta, pedidos às lojas de Abatiá-PR, pagamento, cancelamento e responsabilidades da plataforma e das lojas.',
    caminho: CAMINHO_TERMOS_APP,
    origem,
    rodape: rodape('<a href="/privacidade-app">Política de privacidade</a>'),
    corpo: `
<section>
  <p>Estes termos valem para o uso do app <strong>Taaki Delivery</strong>, plataforma que reúne o cardápio de lojas de Abatiá-PR e envia os seus pedidos a elas. Ao usar o app, você concorda com estes termos e com a <a href="/privacidade-app">política de privacidade</a>.</p>
  <p>Responsável pela plataforma: <strong>${escapar(identificacaoDoControlador(c))}</strong>.</p>
</section>
<section>
  <h2>1. O que é a plataforma</h2>
  <p>O Taaki Delivery intermedeia o pedido entre você e a loja. <strong>Cada loja é responsável</strong> pelos produtos, preços, preparo, entrega, troca e emissão de documentos fiscais dos pedidos feitos a ela. A loja recebe só os dados necessários para preparar e entregar o pedido e não pode usá-los para outra finalidade.</p>
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
  <h2>7. Anúncios e comunicações</h2>
  <p>O app pode mostrar anúncios, sempre identificados como "Patrocinado". O anunciante é o responsável pelo que anuncia; a oferta de uma loja anunciada vale nas condições do cardápio dela no app. Ofertas e novidades por mensagem só são enviadas se você autorizar em Perfil › Comunicações, e você pode desligar quando quiser.</p>
</section>
<section>
  <h2>8. Disponibilidade</h2>
  <p>O app pode ficar fora do ar para manutenção ou por falhas de rede. Sem conexão, o app mostra o último cardápio salvo, mas não envia pedidos.</p>
</section>
<section>
  <h2>9. Mudanças nestes termos</h2>
  <p>Se os termos mudarem, a nova versão será publicada aqui com a nova data de vigência, e o app pedirá o seu aceite antes de continuar. Se não concordar, você pode sair da conta ou excluí-la.</p>
</section>
<section>
  <h2>10. Lei aplicável</h2>
  <p>Valem as leis brasileiras, em especial o Código de Defesa do Consumidor. Fica eleito o foro do domicílio do consumidor.</p>
</section>
<section>
  <h2>11. Contato</h2>
  ${contatoHtml(email)}
</section>`,
  });
}

/** `origem` = https://<domínio principal do Taaki> (canonical e link do início). */
export function criarRotasLegais({ email = emailDoTitular(), origem = undefined } = {}) {
  const r = Router();
  r.get(CAMINHO_PRIVACIDADE_APP, (req, res) => responderPagina(res, 200, paginaPrivacidade(email, CONTROLADOR, origem), { indexar: true }));
  r.get(CAMINHO_TERMOS_APP, (req, res) => responderPagina(res, 200, paginaTermos(email, CONTROLADOR, origem), { indexar: true }));
  return r;
}
