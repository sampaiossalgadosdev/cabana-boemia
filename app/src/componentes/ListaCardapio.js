import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { formatarPreco } from '../logica/dinheiro.js';
import { useEstilos } from '../tema/tema.js';
import { ImagemProduto } from './basicos.js';

/**
 * Abas das categorias (faixa horizontal fixa abaixo do topo). Rola só a faixa
 * para manter a ativa visível (no site, scrollIntoView rolava a página junto).
 */
export function AbasCategorias({ categorias, ativa, onSelecionar }) {
  const s = useEstilos(criarEstilos);
  const faixa = useRef(null);
  const posicoes = useRef(new Map());
  useEffect(() => {
    const x = posicoes.current.get(ativa);
    if (x != null) faixa.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [ativa]);
  return (
    <View style={s.abasFundo}>
      <ScrollView
        ref={faixa}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.abas}
        accessibilityRole="tablist"
      >
        {categorias.map((c) => {
          const selecionada = c.id === ativa;
          return (
            <Pressable
              key={c.id}
              onLayout={(e) => posicoes.current.set(c.id, e.nativeEvent.layout.x)}
              onPress={() => onSelecionar(c.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: selecionada }}
              style={[s.aba, selecionada && s.abaAtiva]}
            >
              <Text style={[s.abaTexto, selecionada && s.abaTextoAtivo]}>{c.nome}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Fixo: a SectionList não aceita trocar o viewabilityConfig depois de montada (lança erro).
const VISIBILIDADE = { itemVisiblePercentThreshold: 60 };
function Divisoria() {
  const s = useEstilos(criarEstilos);
  return <View style={s.divisoria} />;
}

/** Card horizontal (texto à esquerda, foto à direita); o card inteiro abre o produto. */
const CardProduto = memo(function CardProduto({ produto, desabilitado, onAbrir }) {
  const s = useEstilos(criarEstilos);
  return (
    <Pressable
      onPress={() => onAbrir(produto)}
      disabled={desabilitado}
      accessibilityRole="button"
      accessibilityLabel={`${produto.nome}, ${formatarPreco(produto.precoCentavos)}${desabilitado ? ', fechado agora' : ''}`}
      accessibilityState={{ disabled: Boolean(desabilitado) }}
      style={({ pressed }) => [s.card, pressed && s.cardPressionado]}
    >
      <View style={s.cardTexto}>
        <Text style={s.nome} numberOfLines={2}>
          {produto.nome}
        </Text>
        {produto.descricao ? (
          <Text style={s.descricao} numberOfLines={2}>
            {produto.descricao}
          </Text>
        ) : null}
        <View style={s.rodapeCard}>
          <Text style={s.preco}>
            {formatarPreco(produto.precoCentavos)}
            {produto.tipoPreco === 'POR_KG' ? ' /kg' : ''}
          </Text>
          {desabilitado && <Text style={s.fechado}>Fechado agora</Text>}
        </View>
      </View>
      <ImagemProduto url={produto.imagemUrl} estilo={s.foto} />
    </Pressable>
  );
});

/**
 * Cardápio em seções (uma por categoria). `ref.irPara(categoriaId)` rola até a
 * seção; `onCategoriaVisivel` diz qual está no topo (para a aba ativa).
 */
export const ListaCardapio = forwardRef(function ListaCardapio(
  { categorias, desabilitado, onAbrir, onCategoriaVisivel, cabecalho, rodapeEspaco = 0, atualizando, onAtualizar },
  ref,
) {
  const s = useEstilos(criarEstilos);
  const lista = useRef(null);
  const indoPara = useRef(null);
  const sections = categorias.map((c) => ({ key: String(c.id), id: c.id, titulo: c.nome, data: c.produtos }));

  useImperativeHandle(ref, () => ({
    irPara(id) {
      const i = categorias.findIndex((c) => c.id === id);
      if (i < 0) return;
      indoPara.current = id;
      lista.current?.scrollToLocation({ sectionIndex: i, itemIndex: 0, viewOffset: 0, viewPosition: 0 });
      setTimeout(() => {
        indoPara.current = null;
      }, 600);
    },
  }));

  const aoMudarVisiveis = useRef(({ viewableItems }) => {
    const primeiro = viewableItems.find((v) => v.section);
    if (primeiro && !indoPara.current) onCategoriaVisivel?.(primeiro.section.id);
  }).current;

  const renderItem = useCallback(
    ({ item }) => <CardProduto produto={item} desabilitado={desabilitado} onAbrir={onAbrir} />,
    [desabilitado, onAbrir],
  );

  return (
    <SectionList
      ref={lista}
      sections={sections}
      keyExtractor={(p) => String(p.id)}
      renderItem={renderItem}
      renderSectionHeader={({ section }) => (
        <Text style={s.secao} accessibilityRole="header">
          {section.titulo}
        </Text>
      )}
      ItemSeparatorComponent={Divisoria}
      ListHeaderComponent={cabecalho}
      ListEmptyComponent={<Text style={s.vazio}>Nenhum item disponível no momento.</Text>}
      ListFooterComponent={<View style={{ height: 24 + rodapeEspaco }} />}
      stickySectionHeadersEnabled={false}
      initialNumToRender={60}
      onViewableItemsChanged={aoMudarVisiveis}
      viewabilityConfig={VISIBILIDADE}
      onScrollToIndexFailed={() => {}}
      refreshing={Boolean(atualizando)}
      onRefresh={onAtualizar}
      style={s.lista}
    />
  );
});

const criarEstilos = (t) =>
  StyleSheet.create({
    abasFundo: { backgroundColor: t.cores.fundo, borderBottomWidth: 1, borderBottomColor: t.cores.borda },
    abas: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
    aba: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: t.raio.pilula,
      borderWidth: 1,
      borderColor: t.cores.borda,
      backgroundColor: t.cores.superficie,
    },
    abaAtiva: { backgroundColor: t.cores.acao, borderColor: t.cores.acao },
    abaTexto: { color: t.cores.texto, fontWeight: t.fontes.peso.medio, fontSize: t.fontes.tamanho.normal },
    abaTextoAtivo: { color: t.cores.textoAcao },
    lista: { backgroundColor: t.cores.fundo },
    secao: {
      fontSize: t.fontes.tamanho.grande,
      fontWeight: t.fontes.peso.pesado,
      color: t.cores.texto,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 8,
    },
    card: {
      flexDirection: 'row',
      gap: 12,
      padding: 16,
      backgroundColor: t.cores.superficie,
      minHeight: 120,
    },
    cardPressionado: { backgroundColor: t.cores.placeholder },
    cardTexto: { flex: 1, justifyContent: 'space-between', gap: 4 },
    nome: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    descricao: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, lineHeight: 18 },
    rodapeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    preco: { fontSize: t.fontes.tamanho.medio, color: t.cores.preco, fontWeight: t.fontes.peso.forte },
    fechado: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    foto: { width: 104, height: 104, borderRadius: t.raio.pequeno },
    divisoria: { height: 1, backgroundColor: t.cores.borda, marginLeft: 16 },
    vazio: { textAlign: 'center', color: t.cores.textoSuave, padding: 32, fontSize: t.fontes.tamanho.normal },
  });
