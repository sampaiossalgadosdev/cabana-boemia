const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** GET /publico/cardapio. Lança em erro de rede ou status ≠ 2xx. */
export async function buscarCardapio(signal) {
  const res = await fetch(`${BASE}/publico/cardapio`, { signal });
  if (!res.ok) throw new Error(`Cardápio indisponível (HTTP ${res.status})`);
  return res.json();
}
