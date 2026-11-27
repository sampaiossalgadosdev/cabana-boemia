import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';

/**
 * Destino do link `deliveryabatia://cartao-retorno` da página de volta do Checkout Pro. O
 * navegador do app fecha ao ver o link; no Android o link também chega ao Expo Router e abre
 * esta rota, que só volta para a tela do cartão (quem confere o pagamento é ela, pela nossa API).
 */
export default function CartaoRetorno() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/sacola/cartao');
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
