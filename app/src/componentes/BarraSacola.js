import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { progressoFreteGratis } from '@restaurante/shared/frete';
import { useCarrinho } from '../estado/Carrinho.js';
import { useCardapio } from '../estado/Cardapio.js';
import { formatarPreco } from '../logica/dinheiro.js';
import { rotuloItens } from '../logica/sacola.js';
import { useEstilos } from '../tema/tema.js';

/**
 * "Faltam R$ X para frete grátis" + barra; atingido: "Você ganhou frete
 * grátis! 🎉" com a barra cheia em verde. Subtotal dos itens, sem a taxa.
 * Frete grátis desligado (null): não aparece.
 */
export function LinhaFreteGratis({ subtotalCentavos, freteGratis }) {
  const s = useEstilos(criarEstilos);
  const p = progressoFreteGratis(subtotalCentavos, freteGratis);
  const largura = useRef(new Animated.Value(p?.percentual ?? 0)).current;
  useEffect(() => {
    if (p) Animated.timing(largura, { toValue: p.percentual, duration: 300, useNativeDriver: false }).start();
  }, [p?.percentual, largura]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  return (
    <View style={s.frete}>
      <Text style={s.freteTexto} accessibilityLiveRegion="polite">
        {p.atingido ? (
          'Você ganhou frete grátis! 🎉'
        ) : (
          <>
            Faltam <Text style={s.forte}>{formatarPreco(p.faltaCentavos)}</Text> para frete grátis
          </>
        )}
      </Text>
      <View
        style={s.trilho}
        accessibilityRole="progressbar"
        accessibilityLabel="Progresso para o frete grátis"
        accessibilityValue={{ min: 0, max: 100, now: p.percentual }}
      >
        <Animated.View
          style={[
            s.barra,
            p.atingido && s.barraCheia,
            { width: largura.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
    </View>
  );
}

/** Barra da sacola acima das abas; some com a sacola vazia. Toque abre a sacola. */
export function BarraSacola() {
  const s = useEstilos(criarEstilos);
  const { totalItens, totalCentavos } = useCarrinho();
  const { dados } = useCardapio();
  if (!totalItens) return null;
  return (
    <View style={s.cartao}>
      <LinhaFreteGratis subtotalCentavos={totalCentavos} freteGratis={dados?.freteGratis ?? null} />
      <View style={s.linha}>
        <Text style={s.resumo}>
          <Text style={s.forte}>{formatarPreco(totalCentavos)}</Text> / {rotuloItens(totalItens)}
        </Text>
        <Pressable
          onPress={() => router.push('/sacola')}
          accessibilityRole="button"
          style={({ pressed }) => [s.botao, pressed && s.botaoPressionado]}
        >
          <Text style={s.botaoTexto}>Ver sacola</Text>
        </Pressable>
      </View>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    cartao: {
      backgroundColor: t.cores.superficie,
      borderTopWidth: 1,
      borderTopColor: t.cores.borda,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
    },
    linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    resumo: { fontSize: t.fontes.tamanho.medio, color: t.cores.texto, flexShrink: 1 },
    forte: { fontWeight: t.fontes.peso.forte },
    botao: {
      backgroundColor: t.cores.acao,
      borderRadius: t.raio.pequeno,
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    botaoPressionado: { backgroundColor: t.cores.acaoPressionada },
    botaoTexto: { color: t.cores.textoAcao, fontWeight: t.fontes.peso.forte, fontSize: t.fontes.tamanho.normal },
    frete: { gap: 6 },
    freteTexto: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.texto },
    trilho: { height: 6, borderRadius: 3, backgroundColor: t.cores.borda, overflow: 'hidden' },
    barra: { height: 6, borderRadius: 3, backgroundColor: t.cores.destaque },
    barraCheia: { backgroundColor: t.cores.sucesso },
  });
