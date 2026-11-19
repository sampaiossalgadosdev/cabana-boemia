import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEstilos, useTema } from '../tema/tema.js';
import { BarraSacola } from './BarraSacola.js';
import { AvisosNaTela } from '../estado/Avisos.js';

/** Aba ainda sem conteúdo (Pedidos e Perfil entram junto com o login, no próximo passo). */
export function EmBreve({ titulo, icone, texto }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { top } = useSafeAreaInsets();
  return (
    <View style={s.tela}>
      <View style={[s.topo, { paddingTop: top + 12 }]}>
        <Text style={s.titulo} accessibilityRole="header">
          {titulo}
        </Text>
      </View>
      <View style={s.corpo}>
        <Ionicons name={icone} size={56} color={tema.cores.destaque} />
        <Text style={s.texto}>{texto}</Text>
      </View>
      <BarraSacola />
      <AvisosNaTela distanciaDoFim={90} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    topo: { backgroundColor: t.cores.cabecalho, paddingHorizontal: 16, paddingBottom: 14 },
    titulo: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.grande, fontWeight: t.fontes.peso.pesado },
    corpo: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    texto: { color: t.cores.textoSuave, fontSize: t.fontes.tamanho.medio, textAlign: 'center', maxWidth: 300 },
  });
