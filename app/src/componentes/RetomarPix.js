import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useCliente } from '../estado/Cliente.js';
import { lerCartaoPendente, lerPixPendente } from '../logica/pagamento.js';

/**
 * Pix ou cartão aguardando pagamento guardado no aparelho (o app fechou ou o cliente saiu da
 * tela): ao abrir o app (ou voltar para ele), com a conta logada, abre de novo a tela do Pix ou
 * do cartão, que consulta a API e mostra aprovado, recusado, expirado ou o tempo que falta.
 * Na volta do navegador do cartão, a própria tela do cartão está aberta e nada muda.
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
      if (vivo && pix && caminhoAtual.current !== '/sacola/pix') return router.push('/sacola/pix');
      const cartao = pix ? null : await lerCartaoPendente();
      if (vivo && cartao && !['/sacola/cartao', '/cartao-retorno'].includes(caminhoAtual.current)) router.push('/sacola/cartao');
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
