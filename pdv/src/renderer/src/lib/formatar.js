const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/** Centavos (Int) → "R$ 16,00". */
export const formatarPreco = (centavos) => moeda.format((centavos ?? 0) / 100);

/** ISO (UTC) → "19:42" no horário de São Paulo. */
export const formatarHora = (iso) => hora.format(new Date(iso));

/** "43999990000" → "(43) 99999-0000". */
export function formatarTelefone(t) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? '';
}

export const NOME_CANAL = { SITE: 'Site', WHATSAPP: 'WhatsApp', SALAO: 'Salão' };

export const NOME_PAGAMENTO = { PIX: 'Pix', DINHEIRO: 'Dinheiro', DEBITO: 'Débito', CREDITO: 'Crédito' };
export const FORMAS_PAGAMENTO = Object.keys(NOME_PAGAMENTO);

/** Peso em gramas → "0,450 kg". */
export const formatarPeso = (g) => `${(g / 1000).toFixed(3).replace('.', ',')} kg`;
