import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTema } from '../../tema/tema.js';

/** Abas Início, Pedidos e Perfil (como no site). Pedidos e Perfil chegam no próximo passo. */
export default function LayoutAbas() {
  const tema = useTema();
  const icone =
    (nome) =>
    ({ color, size, focused }) => <Ionicons name={focused ? nome : `${nome}-outline`} size={size} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tema.cores.acao,
        tabBarInactiveTintColor: tema.cores.textoSuave,
        tabBarLabelStyle: { fontSize: 12, fontWeight: tema.fontes.peso.medio },
        tabBarStyle: { backgroundColor: tema.cores.superficie, borderTopColor: tema.cores.borda },
        sceneStyle: { backgroundColor: tema.cores.fundo },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icone('home') }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos', tabBarIcon: icone('receipt') }} />
      <Tabs.Screen name="perfil" options={{ title: 'Perfil', tabBarIcon: icone('person') }} />
    </Tabs>
  );
}
