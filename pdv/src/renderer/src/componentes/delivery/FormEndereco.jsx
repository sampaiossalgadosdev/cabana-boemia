import { formatarPreco } from '../../lib/formatar.js';

export const ENDERECO_VAZIO = { rua: '', numero: '', complemento: '', referencia: '', bairroId: '' };

/** Campos de endereço (controlados). Bairro com a taxa de entrega. */
export function CamposEndereco({ valor, aoMudar, bairros, autoFocus = false }) {
  const mudar = (campo) => (e) => aoMudar({ ...valor, [campo]: e.target.value });
  return (
    <div className="form-grade">
      <label className="campo campo--largo">
        <span>Rua</span>
        <input required maxLength={120} value={valor.rua} onChange={mudar('rua')} autoFocus={autoFocus} />
      </label>
      <label className="campo">
        <span>Número</span>
        <input required maxLength={20} value={valor.numero} onChange={mudar('numero')} />
      </label>
      <label className="campo">
        <span>Bairro</span>
        <select required value={valor.bairroId} onChange={mudar('bairroId')}>
          <option value="">Escolha…</option>
          {bairros.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome} · {formatarPreco(b.taxaCentavos)}
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        <span>Complemento</span>
        <input maxLength={120} value={valor.complemento} onChange={mudar('complemento')} />
      </label>
      <label className="campo campo--largo">
        <span>Referência</span>
        <input maxLength={200} value={valor.referencia} onChange={mudar('referencia')} />
      </label>
    </div>
  );
}

export const enderecoParaEnvio = (v) => ({ ...v, bairroId: Number(v.bairroId) });
