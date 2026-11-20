import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCardapio } from '../estado/Cardapio.js';
import { useCarrinho } from '../estado/Carrinho.js';
import { AvisosNaTela } from '../estado/Avisos.js';
import { OBSERVACAO_MAX, QUANTIDADE_MAX } from '../logica/carrinho.js';
import { limiteDaLinha } from '../logica/sacola.js';
import { limiteParaAdicionar } from '../logica/cardapio.js';
import { formatarPreco } from '../logica/dinheiro.js';
import { Botao, ImagemProduto, Quantidade } from '../componentes/basicos.js';
import { useEstilos, useTema } from '../tema/tema.js';
import { ComTemaDaLoja } from '../componentes/Loja.js';

/**
 * Produto (modal): quantidade 1–20 (até o saldo, `maxSacola`) e observação até
 * 140 caracteres. Com `linha` (vindo da sacola), edita a linha da sacola.
 */
export default function TelaProduto() {
  return (
    <ComTemaDaLoja>
      <Produto />
    </ComTemaDaLoja>
  );
}

function Produto() {
  const { id, linha } = useLocalSearchParams();
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom, top } = useSafeAreaInsets();
  // iOS: o modal é um cartão abaixo da barra de status; Android: tela cheia (edge-to-edge).
  const recuoTopo = Platform.OS === 'ios' ? 0 : top;
  const { produtosPorId, podePedir, slug, loja } = useCardapio();
  const carrinho = useCarrinho();

  const item = linha ? carrinho.itens.find((i) => i.id === linha) : null;
  const produtoId = Number(id ?? item?.produtoId);
  const produto =
    produtosPorId.get(produtoId) ??
    (item ? { id: item.produtoId, nome: item.nome, precoCentavos: item.precoCentavos } : null);

  const itensDaLoja = carrinho.loja?.slug === slug ? carrinho.itens : [];
  const limite = item ? limiteDaLinha(item, carrinho.itens, produtosPorId.get(produtoId)) : limiteParaAdicionar(itensDaLoja, produto);
  const [quantidade, setQuantidade] = useState(() => Math.max(1, Math.min(item?.quantidade ?? 1, limite || 1)));
  const [observacao, setObservacao] = useState(item?.observacao ?? '');

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!produto) {
    return (
      <View style={[s.tela, s.centro]}>
        <Text style={s.descricao}>Este item não está mais no cardápio.</Text>
        <Botao titulo="Voltar ao cardápio" variante="secundario" onPress={fechar} estilo={{ marginTop: 16 }} />
      </View>
    );
  }

  const semEstoque = limite === 0;
  const podeConfirmar = item ? !semEstoque : podePedir && !semEstoque;
  const confirmar = async () => {
    if (item) {
      carrinho.editar(item.id, { quantidade, observacao });
      return fechar();
    }
    // A sacola é de uma loja só: com itens de outra, pergunta se pode esvaziar.
    const daLoja = { slug, nome: loja?.nome || slug };
    if (!(await carrinho.confirmarLoja(daLoja))) return undefined;
    carrinho.adicionar(produto, quantidade, observacao, daLoja);
    return fechar();
  };

  return (
    <KeyboardAvoidingView style={s.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        {produto.imagemUrl ? <ImagemProduto url={produto.imagemUrl} estilo={[s.foto, { marginTop: recuoTopo }]} /> : <View style={[s.semFoto, { marginTop: recuoTopo }]} />}
        <View style={s.corpo}>
          <Text style={s.nome} accessibilityRole="header">
            {produto.nome}
          </Text>
          {produto.descricao ? <Text style={s.descricao}>{produto.descricao}</Text> : null}
          <Text style={s.preco}>{formatarPreco(produto.precoCentavos)}</Text>

          <Text style={s.rotulo}>Quantidade</Text>
          <View style={s.linhaQtd}>
            <Quantidade valor={quantidade} maximo={Math.max(1, Math.min(QUANTIDADE_MAX, limite))} onMudar={setQuantidade} />
            {limite > 0 && limite < QUANTIDADE_MAX && quantidade >= limite && <Text style={s.max}>Máx. disponível</Text>}
          </View>

          <View style={s.rotuloLinha}>
            <Text style={s.rotulo}>Observação</Text>
            <Text style={s.contador}>
              {observacao.length}/{OBSERVACAO_MAX}
            </Text>
          </View>
          <TextInput
            value={observacao}
            onChangeText={setObservacao}
            maxLength={OBSERVACAO_MAX}
            placeholder="Ex.: sem cebola, ponto da carne…"
            placeholderTextColor={tema.cores.textoDesabilitado}
            multiline
            style={s.observacao}
            accessibilityLabel="Observação"
          />
        </View>
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: bottom + 12 }]}>
        {semEstoque ? (
          <Text style={s.aviso}>Você já tem na sacola o máximo disponível deste item.</Text>
        ) : !item && !podePedir ? (
          <Text style={s.aviso}>Fechado agora: dá para ver o cardápio, mas não para pedir.</Text>
        ) : null}
        <Botao
          titulo={`${item ? 'Salvar alterações' : 'Adicionar'} · ${formatarPreco(produto.precoCentavos * quantidade)}`}
          onPress={confirmar}
          desabilitado={!podeConfirmar}
          bloco
        />
      </View>

      <Pressable onPress={fechar} accessibilityRole="button" accessibilityLabel="Fechar" style={[s.fechar, { top: recuoTopo + 12 }]} hitSlop={10}>
        <Ionicons name="close" size={24} color={tema.cores.texto} />
      </Pressable>
      <AvisosNaTela distanciaDoFim={110} />
    </KeyboardAvoidingView>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.superficie },
    centro: { alignItems: 'center', justifyContent: 'center', padding: 32 },
    conteudo: { paddingBottom: 24 },
    foto: { width: '100%', aspectRatio: 16 / 10 },
    semFoto: { height: 56 },
    corpo: { padding: 16, gap: 8 },
    nome: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado, color: t.cores.texto },
    descricao: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, lineHeight: 21 },
    preco: { fontSize: t.fontes.tamanho.grande, color: t.cores.preco, fontWeight: t.fontes.peso.forte },
    rotulo: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.forte, color: t.cores.texto, marginTop: 12 },
    rotuloLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    contador: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    linhaQtd: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    max: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.aviso, fontWeight: t.fontes.peso.medio },
    observacao: {
      minHeight: 88,
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pequeno,
      padding: 12,
      fontSize: t.fontes.tamanho.normal,
      color: t.cores.texto,
      textAlignVertical: 'top',
      backgroundColor: t.cores.fundo,
    },
    rodape: {
      paddingHorizontal: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.cores.borda,
      backgroundColor: t.cores.superficie,
      gap: 8,
    },
    aviso: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, textAlign: 'center' },
    fechar: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: t.cores.superficie,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 3,
      shadowColor: t.cores.sombra,
      shadowOpacity: 0.15,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
    },
  });
