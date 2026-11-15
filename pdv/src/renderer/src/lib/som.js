/**
 * Alerta de pedido novo, sintetizado com Web Audio (sem arquivo de som).
 * A janela usa autoplayPolicy 'no-user-gesture-required', então toca mesmo
 * sem clique depois de o PDV abrir sozinho com o Windows.
 */
let contexto = null;

/** Dois "dings" (ding-dong ×2), ~1,3 s. */
export function tocarAlerta() {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === 'suspended') contexto.resume();
    const inicio = contexto.currentTime + 0.02;
    const notas = [
      [988, 0],
      [784, 0.22],
      [988, 0.6],
      [784, 0.82],
    ];
    for (const [freq, atraso] of notas) {
      const osc = contexto.createOscillator();
      const ganho = contexto.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = inicio + atraso;
      ganho.gain.setValueAtTime(0.0001, t);
      ganho.gain.exponentialRampToValueAtTime(0.6, t + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(ganho).connect(contexto.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    }
  } catch (err) {
    console.error('Falha ao tocar o alerta', err);
  }
}
