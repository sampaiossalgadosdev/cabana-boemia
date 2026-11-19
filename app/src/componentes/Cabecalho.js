import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEstilos, useTema } from '../tema/tema.js';

/** Topo vermelho: logo e nome da loja, turno ativo e o tempo de entrega (ou "Fechado"). */
export function Cabecalho({ cardapio }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { top } = useSafeAreaInsets();
  const aberto = cardapio?.aberto;
  return (
    <View style={[s.topo, { paddingTop: top + 8 }]}>
      <View style={s.logoFundo}>
        <Image source={tema.logo} style={s.logo} contentFit="contain" accessibilityLabel={tema.nome} />
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
    textos: { flex: 1 },
    nome: {
      color: t.cores.textoInverso,
      fontSize: t.fontes.tamanho.grande,
      fontWeight: t.fontes.peso.pesado,
      fontFamily: t.fontes.marca,
    },
    sub: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.pequeno, opacity: 0.92, marginTop: 2 },
    bolinha: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: t.cores.textoInverso },
    aberto: { backgroundColor: t.cores.sucesso },
    fechado: { backgroundColor: t.cores.desabilitado },
  });
