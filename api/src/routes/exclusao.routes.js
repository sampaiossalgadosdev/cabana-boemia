import express, { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { normalizarTelefone } from '@restaurante/shared/telefone';
import { assincrono } from '../lib/assincrono.js';
import * as solicitacaoRepo from '../repositories/solicitacaoExclusao.repository.js';
import { documento, escapar, responderPagina } from '../lib/paginaPublica.js';

/**
 * Página pública de exclusão de conta (/excluir-conta), servida pela API sem
 * passar pelo site. É o link exigido pelo Google Play ("excluir conta fora do
 * app"). Explica o que acontece e grava um pedido em SolicitacaoExclusao, que
 * o dono atende à mão (confere a identidade e exclui). HTML puro, sem script.
 */
export const CAMINHO_EXCLUSAO = '/excluir-conta';



const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Confere o formulário. @returns {{ dados?: object, erros: Record<string,string> }} */
export function validarSolicitacao(corpo = {}) {
  const limpo = (v, max) => String(v ?? '').trim().slice(0, max);
  const nome = limpo(corpo.nome, 100);
  const email = limpo(corpo.email, 200).toLowerCase();
  const telefoneBruto = limpo(corpo.telefone, 30);
  const mensagem = limpo(corpo.mensagem, 500);
  const erros = {};
  if (email && !EMAIL.test(email)) erros.email = 'E-mail inválido.';
  const telefone = telefoneBruto ? normalizarTelefone(telefoneBruto) : null;
  if (telefoneBruto && !telefone) erros.telefone = 'Celular inválido (DDD + número).';
  if (!email && !telefoneBruto) erros.geral = 'Informe o e-mail da conta ou o celular cadastrado.';
  return {
    erros,
    dados: Object.keys(erros).length
      ? null
      : { nome: nome || null, email: email || null, telefone: telefone || null, mensagem: mensagem || null },
  };
}

function pagina({ enviado = false, erros = {}, valores = {} } = {}) {
  const erro = (campo) => (erros[campo] ? `<p class="erro">${escapar(erros[campo])}</p>` : '');
  const corpo = enviado
    ? `<div class="ok"><h2>Pedido recebido</h2><p>Vamos conferir os dados e excluir sua conta em até 15 dias. Se precisarmos confirmar que a conta é sua, falaremos pelo e-mail ou celular informado.</p></div>`
    : `<form method="post" action="${CAMINHO_EXCLUSAO}" novalidate>
  <h2>Pedir a exclusão</h2>
  ${erro('geral')}
  <label>Nome <input name="nome" maxlength="100" autocomplete="name" value="${escapar(valores.nome)}"></label>
  <label>E-mail usado para entrar (Google ou Apple) <input name="email" type="email" maxlength="200" autocomplete="email" value="${escapar(valores.email)}"></label>
  ${erro('email')}
  <label>Celular cadastrado <input name="telefone" type="tel" maxlength="30" autocomplete="tel" placeholder="(43) 99999-0000" value="${escapar(valores.telefone)}"></label>
  ${erro('telefone')}
  <label>Observação (opcional) <textarea name="mensagem" maxlength="500" rows="3">${escapar(valores.mensagem)}</textarea></label>
  <label class="isca" aria-hidden="true">Não preencha <input name="site" tabindex="-1" autocomplete="off"></label>
  <button type="submit">Pedir exclusão da conta</button>
</form>`;
  return documento({
    titulo: 'Excluir conta',
    corpo: `<section>
  <h2>Pelo app (na hora)</h2>
  <p>Abra o app <strong>Delivery Abatiá</strong>, vá em <strong>Perfil › Excluir minha conta</strong> e confirme.</p>
</section>
<section>
  <h2>O que é apagado</h2>
  <ul>
    <li>Sua conta: nome, e-mail, telefone e o vínculo com o Google ou a Apple.</li>
    <li>Todos os endereços salvos.</li>
    <li>As sessões abertas no app (você sai de todos os aparelhos).</li>
  </ul>
  <h2>O que fica</h2>
  <ul>
    <li>Os pedidos já feitos (valores, itens e data), que o restaurante guarda como registro fiscal, <strong>sem</strong> seu nome, telefone e endereço: aparecem como "Cliente excluído".</li>
    <li>Os registros de acesso (IP e data e hora de login e pedidos), por 6 meses, como exige o Marco Civil da Internet; depois são apagados automaticamente.</li>
  </ul>
  <p><small>Se um pedido seu feito nas últimas 3 horas ainda está sendo preparado ou entregue, a exclusão fica liberada quando ele for entregue ou 3 horas depois do pedido (a loja ainda precisa do endereço).</small></p>
  <p><small>Mais detalhes na <a href="/privacidade-app">política de privacidade</a>.</small></p>
</section>
${corpo}`,
  });
}

const responder = (res, status, opcoes) => responderPagina(res, status, pagina(opcoes));

/** @param {{ limiteSolicitacoes?: number }} [opcoes] */
export function criarRotasExclusao({ limiteSolicitacoes = 5 } = {}) {
  const r = Router();
  const limitar = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: limiteSolicitacoes,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => responder(res, 429, { erros: { geral: 'Muitos envios. Tente de novo mais tarde.' } }),
  });

  r.get(CAMINHO_EXCLUSAO, (req, res) => responder(res, 200, { enviado: req.query.enviado === '1' }));
  r.post(
    CAMINHO_EXCLUSAO,
    limitar,
    express.urlencoded({ extended: false, limit: '10kb' }),
    assincrono(async (req, res) => {
      // Campo-isca preenchido = robô: finge que deu certo.
      if (req.body?.site) return res.redirect(303, `${CAMINHO_EXCLUSAO}?enviado=1`);
      const { dados, erros } = validarSolicitacao(req.body);
      if (!dados) return responder(res, 400, { erros, valores: req.body });
      await solicitacaoRepo.criar(dados);
      res.redirect(303, `${CAMINHO_EXCLUSAO}?enviado=1`);
    }),
  );
  return r;
}
