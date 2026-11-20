import { useEffect } from 'react';
import { BackHandler, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useUltimoPedido } from '../../estado/UltimoPedido.js';
import { useCardapio } from '../../estado/Cardapio.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import { linkCancelamento, rotuloPagamento, textoTaxa } from '../../logica/pedido.js';
import { Botao } from '../../componentes/basicos.js';
import { useEstilos, useTema } from '../../tema/tema.js';

/** Sucesso (como PedidoEnviado.jsx do site): número, previsão, itens, total e cancelamento pelo WhatsApp. */
export default function TelaPedidoEnviado() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom } = useSafeAreaInsets();
  const { pedidoEnviado: pedido } = useUltimoPedido();
  // Cancelamento pelo WhatsApp DA LOJA do pedido (a configuração dela veio com o cardápio).
  const { loja } = useCardapio();
  const whatsapp = loja?.whatsapp ?? '';

  const navegacao = useNavigation();
  // Fecha o modal da sacola inteiro (o stack de cima é o da raiz).
  const voltarAoCardapio = () => {
    const raiz = navegacao.getParent();
    if (raiz?.canGoBack()) raiz.goBack();
    else router.replace('/');
  };

  // Voltar (Android) não leva de novo à sacola/checkout: vai ao cardápio.
  useEffect(() => {
    const s2 = BackHandler.addEventListener('hardwareBackPress', () => {
      voltarAoCardapio();
      return true;
    });
    return () => s2.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pedido) {
    return (
      <View style={[s.tela, s.centro]}>
        <Botao titulo="Voltar ao cardápio" onPress={voltarAoCardapio} />
      </View>
    );
  }

  const link = whatsapp ? linkCancelamento(whatsapp, pedido.numeroDia, pedido.nomeCliente) : null;
  return (
    <ScrollView style={s.tela} contentContainerStyle={[s.conteudo, { paddingBottom: bottom + 24 }]}>
      <View style={s.selo}>
        <Ionicons name="checkmark" size={44} color={tema.cores.textoAcao} />
      </View>
      <Text style={s.titulo} accessibilityRole="header">{`Pedido nº ${pedido.numeroDia} recebido!`}</Text>
      {pedido.tempoEstimadoMin != null && (
        <Text style={s.tempo}>
          Previsão de entrega: <Text style={s.forte}>{`cerca de ${pedido.tempoEstimadoMin} min`}</Text>
        </Text>
      )}

      <View style={s.cartao}>
        {pedido.itens.map((i) => (
          <View key={i.id} style={s.linha}>
            <View style={{ flex: 1 }}>
              <Text style={s.texto}>{`${i.quantidade}× ${i.nome}`}</Text>
              {i.observacao ? <Text style={s.obs}>{i.observacao}</Text> : null}
            </View>
            <Text style={s.texto}>{formatarPreco(i.totalCentavos)}</Text>
          </View>
        ))}
        <View style={s.linha}>
          <Text style={[s.texto, { flex: 1 }]}>{`Taxa de entrega (${pedido.bairroNome})`}</Text>
          <Text style={[s.texto, pedido.taxaEntregaCentavos === 0 && s.gratis]}>{textoTaxa(pedido.taxaEntregaCentavos)}</Text>
        </View>
        <View style={[s.linha, s.total]}>
          <Text style={s.forte}>Total</Text>
          <Text style={s.forte}>{formatarPreco(pedido.totalCentavos)}</Text>
        </View>
      </View>

      <Text style={s.nota}>
        {`${rotuloPagamento(pedido.formaPagamento)} na entrega`}
        {pedido.trocoParaCentavos ? ` · troco para ${formatarPreco(pedido.trocoParaCentavos)}` : ''}
        {'\n'}
        {pedido.enderecoTexto}
      </Text>

      <Botao titulo="Voltar ao cardápio" onPress={voltarAoCardapio} bloco estilo={{ marginTop: 20 }} />
      {link ? (
        <Botao titulo="Deseja cancelar seu pedido?" variante="texto" onPress={() => Linking.openURL(link)} bloco estilo={{ marginTop: 4 }} />
      ) : (
        whatsapp === '' && <Text style={[s.nota, { textAlign: 'center' }]}>Para cancelar, fale com o restaurante.</Text>
      )}
    </ScrollView>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    centro: { alignItems: 'center', justifyContent: 'center' },
    conteudo: { padding: 16, alignItems: 'stretch' },
    selo: {
      alignSelf: 'center',
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: t.cores.sucesso,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    titulo: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado, color: t.cores.texto, textAlign: 'center', marginTop: 12 },
    tempo: { fontSize: t.fontes.tamanho.medio, color: t.cores.texto, textAlign: 'center', marginTop: 6 },
    forte: { fontWeight: t.fontes.peso.forte, color: t.cores.texto, fontSize: t.fontes.tamanho.medio },
    cartao: {
      backgroundColor: t.cores.superficie,
      borderRadius: t.raio.normal,
      borderWidth: 1,
      borderColor: t.cores.borda,
      padding: 14,
      marginTop: 20,
      gap: 10,
    },
    linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto },
    obs: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, fontWeight: t.fontes.peso.forte },
    gratis: { color: t.cores.sucesso, fontWeight: t.fontes.peso.forte },
    total: { borderTopWidth: 1, borderTopColor: t.cores.borda, paddingTop: 10 },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 12, lineHeight: 19 },
  });
