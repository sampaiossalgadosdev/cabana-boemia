import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { quandoAbre } from '../logica/horario.js';
import { textoCardapioSalvo } from '../logica/cardapio.js';
import { useEstilos, useTema } from '../tema/tema.js';

/** Loja fechada: o cardápio aparece como prévia, sem permitir pedido. */
export function AvisoFechado({ proximaAbertura }) {
  const s = useEstilos(criarEstilos);
  return (
    <View style={s.faixa} accessibilityRole="text">
      <Text style={s.titulo}>Estamos fechados agora.</Text>
      <Text style={s.texto}>
        {proximaAbertura
          ? `Dá uma olhada no cardápio: os pedidos abrem ${quandoAbre(proximaAbertura.em)}.`
          : 'Os pedidos voltam assim que abrirmos.'}
      </Text>
    </View>
  );
}

/** Sem internet (ou a API não respondeu): o cardápio mostrado é o último que chegou. */
export function FaixaSemConexao({ salvoEm, podePedir }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  return (
    <View style={[s.faixa, s.conexao]} accessibilityLiveRegion="polite">
      <View style={s.linha}>
        <Ionicons name="cloud-offline-outline" size={18} color={tema.cores.aviso} />
        <Text style={s.titulo}> Sem conexão.</Text>
      </View>
      <Text style={s.texto}>
        {salvoEm ? `${textoCardapioSalvo(salvoEm)} ` : ''}
        {podePedir || !salvoEm ? 'Tentando de novo…' : 'Conecte-se à internet para pedir.'}
      </Text>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    faixa: {
      backgroundColor: t.cores.avisoFundo,
      borderLeftWidth: 4,
      borderLeftColor: t.cores.aviso,
      borderRadius: t.raio.pequeno,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginHorizontal: 16,
      marginTop: 12,
    },
    conexao: { backgroundColor: t.cores.superficie },
    linha: { flexDirection: 'row', alignItems: 'center' },
    titulo: { fontWeight: t.fontes.peso.forte, color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    texto: { color: t.cores.texto, fontSize: t.fontes.tamanho.normal, marginTop: 2 },
  });
