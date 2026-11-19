import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEstilos } from '../tema/tema.js';

/** Faixa vermelha com o título da aba (Pedidos, Perfil). */
export function TopoAba({ titulo }) {
  const s = useEstilos(criarEstilos);
  const { top } = useSafeAreaInsets();
  return (
    <View style={[s.topo, { paddingTop: top + 12 }]}>
      <Text style={s.titulo} accessibilityRole="header">
        {titulo}
      </Text>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    topo: { backgroundColor: t.cores.cabecalho, paddingHorizontal: 16, paddingBottom: 14 },
    titulo: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.grande, fontWeight: t.fontes.peso.pesado },
  });
