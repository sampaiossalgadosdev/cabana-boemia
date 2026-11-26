import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useCliente } from '../estado/Cliente.js';
import { lerPixPendente } from '../logica/pagamento.js';

/**
 * Pix aguardando pagamento guardado no aparelho (o app fechou ou o cliente saiu da tela):
 * ao abrir o app (ou voltar para ele), com a conta logada, abre de novo a tela do Pix, que
 * consulta a API e mostra aprovado, expirado ou o QR com o tempo que falta.
 */
export function RetomarPix() {
  const { status } = useCliente();
  const caminho = usePathname();
  const caminhoAtual = useRef(caminho);
  caminhoAtual.current = caminho;

  useEffect(() => {
    if (status !== 'logado') return undefined;
    let vivo = true;
    const conferir = async () => {
      const pix = await lerPixPendente();
      if (vivo && pix && caminhoAtual.current !== '/sacola/pix') router.push('/sacola/pix');
    };
    conferir();
    const app = AppState.addEventListener('change', (e) => e === 'active' && conferir());
    return () => {
      vivo = false;
      app.remove();
    };
  }, [status]);

  return null;
}
