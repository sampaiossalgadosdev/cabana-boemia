import { useState } from 'react';
import { useCliente } from '../cliente/ClienteContext.jsx';
import * as api from '../lib/api.js';
import { formatarPreco } from '../lib/dinheiro.js';

const ERRO_GENERICO = 'Não foi possível salvar agora. Confira sua conexão e tente de novo.';

/** "Rua das Flores, 120 - Casa 2" */
export const textoEndereco = (e) => `${e.rua}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`;

/**
 * Endereço novo (POST) ou edição (`endereco` presente → PUT). Usado no
 * checkout e no Perfil. Bairro só dos ativos (com a taxa ao lado).
 */
export function FormEndereco({ bairros, endereco = null, titulo, onSalvo, onCancelar }) {
  const { token } = useCliente();
  const bairroAtivo = endereco && bairros.some((b) => b.id === endereco.bairro.id);
  const [dados, setDados] = useState({
    rua: endereco?.rua ?? '',
    numero: endereco?.numero ?? '',
    complemento: endereco?.complemento ?? '',
    referencia: endereco?.referencia ?? '',
    bairroId: bairroAtivo ? String(endereco.bairro.id) : '',
  });
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (e) => setDados((d) => ({ ...d, [campo]: e.target.value }));

  const salvar = async (e) => {
    e.preventDefault();
    const novos = {};
    if (!dados.rua.trim()) novos.rua = 'Informe a rua';
    if (!dados.numero.trim()) novos.numero = 'Informe o número';
    if (!dados.bairroId) novos.bairroId = 'Escolha o bairro';
    setErros(novos);
    if (Object.keys(novos).length) return;

    setSalvando(true);
    try {
      const corpo = { ...dados, bairroId: Number(dados.bairroId) };
      const r = endereco
        ? await api.atualizarEndereco(token, endereco.id, corpo) // sem `principal`: mantém
        : await api.criarEndereco(token, corpo);
      onSalvo(r.endereco);
    } catch (err) {
      const porCampo = Object.fromEntries((err.detalhes ?? []).map((d) => [d.campo, d.mensagem]));
      setErros(Object.keys(porCampo).length ? porCampo : { geral: err.status ? err.message : ERRO_GENERICO });
    } finally {
      setSalvando(false);
    }
  };

  const campo = (id, rotulo, props = {}) => (
    <div className="campo">
      <label className="campo__rotulo" htmlFor={`end-${id}`}>
        {rotulo}
      </label>
      <input id={`end-${id}`} value={dados[id]} onChange={mudar(id)} aria-invalid={Boolean(erros[id])} {...props} />
      {erros[id] && <p className="erro">{erros[id]}</p>}
    </div>
  );

  return (
    <form className="checkout-passo" onSubmit={salvar} noValidate aria-label={titulo ?? 'Endereço de entrega'}>
      <h3 className="checkout-passo__titulo">{titulo ?? 'Endereço de entrega'}</h3>
      {campo('rua', 'Rua', { autoComplete: 'address-line1', maxLength: 120 })}
      {campo('numero', 'Número', { inputMode: 'numeric', maxLength: 20 })}
      <div className="campo">
        <label className="campo__rotulo" htmlFor="end-bairroId">
          Bairro
        </label>
        <select id="end-bairroId" value={dados.bairroId} onChange={mudar('bairroId')} aria-invalid={Boolean(erros.bairroId)}>
          <option value="">Escolha…</option>
          {bairros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome} · entrega {formatarPreco(b.taxaCentavos)}
            </option>
          ))}
        </select>
        {endereco && !bairroAtivo && <p className="nota nota--esquerda">Não entregamos mais em {endereco.bairro.nome}. Escolha outro bairro.</p>}
        {erros.bairroId && <p className="erro">{erros.bairroId}</p>}
      </div>
      {campo('complemento', 'Complemento (opcional)', { maxLength: 120 })}
      {campo('referencia', 'Ponto de referência (opcional)', { maxLength: 200 })}
      {erros.geral && (
        <p className="erro" role="alert">
          {erros.geral}
        </p>
      )}
      <button type="submit" className="botao botao--primario botao--bloco checkout-passo__acao" disabled={salvando}>
        {salvando ? 'Salvando…' : 'Salvar endereço'}
      </button>
      {onCancelar && (
        <button type="button" className="botao botao--texto botao--bloco" onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </form>
  );
}
