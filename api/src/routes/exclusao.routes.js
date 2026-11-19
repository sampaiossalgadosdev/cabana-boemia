import express, { Router } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { normalizarTelefone } from '@restaurante/shared/telefone';
import { assincrono } from '../lib/assincrono.js';
import * as solicitacaoRepo from '../repositories/solicitacaoExclusao.repository.js';

/**
 * Página pública de exclusão de conta (/excluir-conta), servida pela API sem
 * passar pelo site. É o link exigido pelo Google Play ("excluir conta fora do
 * app"). Explica o que acontece e grava um pedido em SolicitacaoExclusao, que
 * o dono atende à mão (confere a identidade e exclui). HTML puro, sem script.
 */
export const CAMINHO_EXCLUSAO = '/excluir-conta';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const escapar = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Excluir conta · Delivery Abatiá</title>
<meta name="robots" content="noindex">
<style>
body{margin:0;background:#FBF3E8;color:#111;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{background:#C8102E;color:#FBF3E8;padding:20px 16px}header h1{margin:0;font-size:22px}
main{max-width:640px;margin:0 auto;padding:16px}section,form,.ok{background:#fff;border:1px solid #EADED0;border-radius:14px;padding:16px;margin:16px 0}
h2{font-size:18px;margin:0 0 8px}ul{padding-left:20px;margin:8px 0}label{display:block;margin:12px 0 0;font-weight:600}
input,textarea{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:10px;border:1px solid #EADED0;border-radius:10px;font:inherit;font-weight:400}
button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:10px;background:#C8102E;color:#fff;font:inherit;font-weight:700}
.erro{color:#9E0B22;margin:4px 0 0}.ok{border-left:4px solid #2E7D4F}.isca{position:absolute;left:-9999px}small{color:#5E5249}
</style></head><body>
<header><h1>Excluir conta · Delivery Abatiá</h1></header>
<main>
<section>
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
  </ul>
  <p><small>Pedidos em andamento precisam ser entregues antes da exclusão.</small></p>
</section>
${corpo}
</main></body></html>`;
}

const responder = (res, status, opcoes) => {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP });
  res.send(pagina(opcoes));
};

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
