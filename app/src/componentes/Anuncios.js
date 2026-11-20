import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { BASE, buscarAnuncios } from '../lib/api.js';
import { ETIQUETA_ANUNCIO, anunciosParaMostrar, rotuloDoAnuncio } from '../logica/anuncios.js';
import { useEstilos } from '../tema/tema.js';

const MARGEM = 16;
const PROPORCAO = 2; // largura : altura (a retaguarda pede 2:1)

function abrir(anuncio) {
  if (anuncio.acao.tipo === 'loja') router.push(anuncio.acao.caminho);
  else Linking.openURL(anuncio.acao.url).catch(() => {});
}

/**
 * Carrossel "Patrocinado" no Início (GET /publico/anuncios). A etiqueta
 * "Patrocinado" fica sempre visível em cada peça (e no rótulo do leitor de
 * tela). Sem anúncio no ar ou sem rede: não aparece nada. Nada é medido no
 * aparelho. `recarregar()` (puxar para atualizar da vitrine) busca de novo.
 */
export const CarrosselAnuncios = forwardRef(function CarrosselAnuncios(_, ref) {
  const s = useEstilos(criarEstilos);
  const { width } = useWindowDimensions();
  const [anuncios, setAnuncios] = useState([]);
  const [atual, setAtual] = useState(0);
  const controle = useRef(null);
  const largura = width - MARGEM * 2;

  const buscar = useCallback(async ({ forcar = false } = {}) => {
    controle.current?.abort();
    const c = new AbortController();
    controle.current = c;
    try {
      const { anuncios: lista } = await buscarAnuncios(c.signal, { forcar });
      setAnuncios(anunciosParaMostrar(lista, BASE));
      setAtual(0);
    } catch {
      // sem rede ou API fora: mantém o que já estava (ou nada)
    }
  }, []);

  useEffect(() => {
    buscar();
    return () => controle.current?.abort();
  }, [buscar]);

  useImperativeHandle(ref, () => ({ recarregar: () => buscar({ forcar: true }) }), [buscar]);

  if (!anuncios.length) return null;

  return (
    <View style={s.bloco} accessibilityLabel="Anúncios patrocinados">
      <FlatList
        data={anuncios}
        keyExtractor={(a) => String(a.id)}
        horizontal
        pagingEnabled={false}
        snapToInterval={largura + 10}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: MARGEM, gap: 10 }}
        onMomentumScrollEnd={(e) => setAtual(Math.round(e.nativeEvent.contentOffset.x / (largura + 10)))}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => abrir(item)}
            accessibilityRole={item.acao.tipo === 'loja' ? 'button' : 'link'}
            accessibilityLabel={rotuloDoAnuncio(item)}
            style={({ pressed }) => [s.peca, { width: largura, height: largura / PROPORCAO }, pressed && { opacity: 0.9 }]}
          >
            <Image source={{ uri: item.imagem }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" accessible={false} />
            <View style={s.etiqueta} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={s.etiquetaTexto}>{ETIQUETA_ANUNCIO}</Text>
            </View>
          </Pressable>
        )}
      />
      {anuncios.length > 1 ? (
        <View style={s.pontos} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {anuncios.map((a, i) => (
            <View key={a.id} style={[s.ponto, i === atual && s.pontoAtual]} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const criarEstilos = (t) =>
  StyleSheet.create({
    // A lista da vitrine já tem 16 de margem: o carrossel vai de ponta a ponta.
    bloco: { marginHorizontal: -MARGEM, marginBottom: 16 },
    peca: { borderRadius: t.raio.normal, overflow: 'hidden', backgroundColor: t.cores.placeholder },
    // Fundo escuro e texto branco: legível sobre qualquer imagem.
    etiqueta: {
      position: 'absolute',
      top: 8,
      left: 8,
      backgroundColor: t.cores.sobreImagemFundo,
      borderRadius: t.raio.pilula,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    etiquetaTexto: { color: t.cores.sobreImagemTexto, fontSize: 12, fontWeight: t.fontes.peso.forte },
    pontos: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
    ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.cores.borda },
    pontoAtual: { backgroundColor: t.cores.acao, width: 16 },
  });
