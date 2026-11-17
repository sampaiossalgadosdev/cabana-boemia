import { useState } from 'react';
import { mascararTelefone, normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';
import { useCliente } from '../cliente/ClienteContext.jsx';
import { etapaCheckout } from '../cliente/sessao.js';
import { Finalizacao } from './Finalizacao.jsx';
import { EntrarComGoogle } from './EntrarComGoogle.jsx';

const ERRO_GENERICO = 'Não foi possível concluir agora. Confira sua conexão e tente de novo.';

/**
 * Telefone obrigatório (e nome). `onCancelar` só existe ao alterar um telefone
 * já salvo. Também usado no Perfil (`titulo`, `texto`, `rotuloBotao`).
 */
export function PassoTelefone({
  onSalvo,
  onCancelar,
  titulo = 'Seu telefone',
  texto = 'Obrigatório para a entrega: é por ele que falamos com você sobre o pedido.',
  rotuloBotao = 'Salvar e continuar',
}) {
  const { cliente, atualizarPerfil } = useCliente();
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [telefone, setTelefone] = useState(mascararTelefone(cliente?.telefone ?? ''));
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    const novos = {};
    if (!nome.trim()) novos.nome = 'Informe seu nome';
    if (!normalizarTelefone(telefone)) novos.telefone = MENSAGEM_TELEFONE_INVALIDO;
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    try {
      await atualizarPerfil({ nome: nome.trim(), telefone: normalizarTelefone(telefone) });
      onSalvo();
    } catch (err) {
      const porCampo = Object.fromEntries((err.detalhes ?? []).map((d) => [d.campo, d.mensagem]));
      setErros(Object.keys(porCampo).length ? porCampo : { geral: ERRO_GENERICO });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form className="checkout-passo" onSubmit={enviar} noValidate aria-labelledby="titulo-telefone">
      <h3 id="titulo-telefone" className="checkout-passo__titulo">
        {titulo}
      </h3>
      <p className="checkout-passo__texto">{texto}</p>

      <div className="campo">
        <label className="campo__rotulo" htmlFor="cliente-nome">
          Nome
        </label>
        <input
          id="cliente-nome"
          type="text"
          autoComplete="name"
          maxLength={100}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-invalid={Boolean(erros.nome)}
          aria-describedby={erros.nome ? 'erro-nome' : undefined}
        />
        {erros.nome && (
          <p id="erro-nome" className="erro">
            {erros.nome}
          </p>
        )}
      </div>

      <div className="campo">
        <label className="campo__rotulo" htmlFor="cliente-telefone">
          Celular com DDD
        </label>
        <input
          id="cliente-telefone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="(43) 99999-0000"
          value={telefone}
          onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
          aria-invalid={Boolean(erros.telefone)}
          aria-describedby={erros.telefone ? 'erro-telefone' : undefined}
          autoFocus
        />
        {erros.telefone && (
          <p id="erro-telefone" className="erro">
            {erros.telefone}
          </p>
        )}
      </div>

      {erros.geral && (
        <p className="erro" role="alert">
          {erros.geral}
        </p>
      )}

      <button type="submit" className="botao botao--primario botao--bloco checkout-passo__acao" disabled={salvando}>
        {salvando ? 'Salvando…' : rotuloBotao}
      </button>
      {onCancelar && (
        <button type="button" className="botao botao--texto botao--bloco" onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </form>
  );
}

/**
 * Checkout dentro da gaveta do carrinho: login → telefone (obrigatório) →
 * confirmar dados → pagamento → envio.
 */
export function Checkout({ onPedidoEnviado, onCardapioDesatualizado, freteGratis, onFreteGratis }) {
  const sessao = useCliente();
  const [editando, setEditando] = useState(false);
  const etapa = etapaCheckout(sessao);

  if (etapa === 'carregando') return <p className="nota">Carregando seus dados…</p>;
  if (etapa === 'login') {
    return (
      <EntrarComGoogle
        titulo="Entre para finalizar"
        texto="Usamos sua conta Google só para identificar você. Sua sacola continua aqui."
      />
    );
  }
  if (etapa === 'telefone' || editando) {
    return (
      <PassoTelefone
        key={sessao.cliente.id}
        onSalvo={() => setEditando(false)}
        onCancelar={etapa === 'telefone' ? null : () => setEditando(false)}
      />
    );
  }
  return (
    <Finalizacao
      key={sessao.cliente.id}
      onEditarTelefone={() => setEditando(true)}
      onPedidoEnviado={onPedidoEnviado}
      onCardapioDesatualizado={onCardapioDesatualizado}
      freteGratis={freteGratis}
      onFreteGratis={onFreteGratis}
    />
  );
}
