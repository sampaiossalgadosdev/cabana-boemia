import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEstilos, useTema } from '../tema/tema.js';
import { Botao } from './basicos.js';

/**
 * Tela própria quando não há o que mostrar: sem internet e sem cardápio salvo
 * no aparelho (primeira abertura offline), ou um erro inesperado do app
 * (`variante="erro"`). Nunca a tela de erro do sistema.
 */
export function TelaSemInternet({ onTentarDeNovo, tentando, variante = 'rede', detalhe }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const rede = variante === 'rede';
  return (
    <View style={s.tela} accessibilityRole="alert">
      <Ionicons name={rede ? 'cloud-offline-outline' : 'alert-circle-outline'} size={64} color={tema.cores.acao} />
      <Text style={s.titulo}>{rede ? 'Sem conexão' : 'Algo deu errado'}</Text>
      <Text style={s.texto}>
        {rede
          ? 'Verifique sua internet para ver o cardápio e fazer o pedido.'
          : 'O app encontrou um problema. Tente de novo; sua sacola continua salva.'}
      </Text>
      {detalhe ? <Text style={s.detalhe}>{detalhe}</Text> : null}
      <Botao titulo="Tentar de novo" onPress={onTentarDeNovo} carregando={tentando} estilo={s.botao} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: t.cores.fundo },
    titulo: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.forte, color: t.cores.texto, marginTop: 16 },
    texto: { fontSize: t.fontes.tamanho.medio, color: t.cores.textoSuave, textAlign: 'center', marginTop: 8, maxWidth: 320 },
    detalhe: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 8 },
    botao: { marginTop: 24, minWidth: 200 },
  });
