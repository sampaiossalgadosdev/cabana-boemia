import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEstilos, useTema } from '../tema/tema.js';

/**
 * Topo na cor da loja: voltar (para a lista de lojas), logo e nome da loja,
 * turno ativo e o tempo de entrega (ou "Fechado").
 */
export function Cabecalho({ cardapio, onVoltar }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { top } = useSafeAreaInsets();
  const aberto = cardapio?.aberto;
  return (
    <View style={[s.topo, { paddingTop: top + 8 }]}>
      {onVoltar && (
        <Pressable onPress={onVoltar} accessibilityRole="button" accessibilityLabel="Voltar para as lojas" hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={tema.cores.textoInverso} />
        </Pressable>
      )}
      <View style={s.logoFundo}>
        {tema.logo ? (
          <Image source={tema.logo} style={s.logo} contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={tema.nome} />
        ) : (
          <Text style={s.inicial}>{tema.nome.trim()[0]?.toUpperCase()}</Text>
        )}
      </View>
      <View style={s.textos}>
        <Text style={s.nome} numberOfLines={1} accessibilityRole="header">
          {tema.nome}
        </Text>
        {cardapio && (
          <Text style={s.sub} numberOfLines={1}>
            {aberto
              ? `${cardapio.turno?.nome ?? 'Aberto'} · entrega em ~${cardapio.tempoEstimadoMin} min`
              : `Fechado${cardapio.proximaAbertura?.turno ? ` · ${cardapio.proximaAbertura.turno.nome} em breve` : ''}`}
          </Text>
        )}
      </View>
      {cardapio && <View style={[s.bolinha, aberto ? s.aberto : s.fechado]} accessibilityLabel={aberto ? 'Aberto' : 'Fechado'} />}
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    topo: {
      backgroundColor: t.cores.cabecalho,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 12,
    },
    logoFundo: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: t.cores.fundo,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logo: { width: 50, height: 34 },
    inicial: { fontSize: 24, fontWeight: t.fontes.peso.pesado, color: t.cores.acao },
    textos: { flex: 1 },
    nome: {
      color: t.cores.textoInverso,
      fontSize: t.fontes.tamanho.grande,
      fontWeight: t.fontes.peso.pesado,
      fontFamily: t.fontes.marca,
    },
    sub: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.pequeno, opacity: 0.92, marginTop: 2 },
    bolinha: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: t.cores.textoInverso },
    // Cheia (na cor do texto do topo) = aberta; vazada = fechada: vale para qualquer cor de loja.
    aberto: { backgroundColor: t.cores.textoInverso },
    fechado: { backgroundColor: 'transparent' },
  });
