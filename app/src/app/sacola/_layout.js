import { Stack } from 'expo-router';
import { useTema } from '../../tema/tema.js';
import { ComTemaDaLoja } from '../../componentes/Loja.js';

/**
 * A sacola é um modal com o próprio stack (como o painel do site, onde tudo
 * acontece no mesmo lugar): sacola → finalizar → (Pix ou cartão) → pedido enviado.
 */
export default function LayoutSacola() {
  return (
    <ComTemaDaLoja>
      <PilhaDaSacola />
    </ComTemaDaLoja>
  );
}

/** Sacola, checkout e enviado no tema da loja da sacola (a loja aberta). */
function PilhaDaSacola() {
  const tema = useTema();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: tema.cores.cabecalho },
        headerTintColor: tema.cores.textoInverso,
        headerTitleStyle: { fontWeight: tema.fontes.peso.forte },
        contentStyle: { backgroundColor: tema.cores.fundo },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Sacola' }} />
      <Stack.Screen name="checkout" options={{ title: 'Finalizar' }} />
      {/* Pix: sem voltar para o checkout (o pedido já existe e espera o pagamento); "Fechar" leva ao cardápio. */}
      <Stack.Screen name="pix" options={{ title: 'Pagar com Pix', headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      {/* Cartão (Checkout Pro no navegador do app): mesma regra do Pix. */}
      <Stack.Screen name="cartao" options={{ title: 'Pagar com cartão', headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
      {/* Sem voltar: o pedido já foi criado. */}
      <Stack.Screen name="enviado" options={{ title: 'Pedido enviado', headerBackVisible: false, headerLeft: () => null, gestureEnabled: false }} />
    </Stack>
  );
}
