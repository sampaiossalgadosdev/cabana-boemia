/** Peças pequenas reaproveitadas pelas telas: botão, imagem do produto, quantidade. */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEstilos, useTema } from '../tema/tema.js';

/**
 * @param {{ titulo: string, onPress: () => void, variante?: 'primario' | 'secundario' | 'texto',
 *           desabilitado?: boolean, carregando?: boolean, bloco?: boolean, estilo?: any, rotuloAcessivel?: string }} props
 */
export function Botao({ titulo, onPress, variante = 'primario', desabilitado, carregando, bloco, estilo, rotuloAcessivel }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const inativo = desabilitado || carregando;
  return (
    <Pressable
      onPress={onPress}
      disabled={inativo}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel}
      accessibilityState={{ disabled: Boolean(inativo), busy: Boolean(carregando) }}
      style={({ pressed }) => [
        s.botao,
        s[`botao_${variante}`],
        bloco && s.bloco,
        pressed && s[`pressionado_${variante}`],
        inativo && s.desabilitado,
        estilo,
      ]}
    >
      {carregando ? (
        <ActivityIndicator color={variante === 'primario' ? tema.cores.textoAcao : tema.cores.acao} />
      ) : (
        <Text style={[s.texto, s[`texto_${variante}`], inativo && s.textoDesabilitado]}>{titulo}</Text>
      )}
    </Pressable>
  );
}

/**
 * Foto do produto (`imagemUrl`, link colado na retaguarda), com cache em disco
 * (aparece sem internet depois de vista uma vez). Sem link ou com erro:
 * placeholder neutro (prato e talheres), como no site.
 */
export function ImagemProduto({ url, estilo, tamanhoIcone = 30 }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) {
    return (
      <View style={[s.semFoto, estilo]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="restaurant-outline" size={tamanhoIcone} color={tema.cores.textoSuave} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={[s.foto, estilo]}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
      onError={() => setFalhou(true)}
      accessible={false}
    />
  );
}

/** − valor + (sem o "−" abaixo de `minimo`; "+" trava no `maximo`). */
export function Quantidade({ valor, minimo = 1, maximo, onMudar, rotulo = 'Quantidade', compacto }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const tam = compacto ? 18 : 22;
  return (
    <View style={[s.qtd, compacto && s.qtdCompacta]} accessibilityLabel={rotulo}>
      <Pressable
        onPress={() => onMudar(valor - 1)}
        disabled={valor <= minimo}
        accessibilityRole="button"
        accessibilityLabel="Diminuir"
        hitSlop={8}
        style={s.qtdBotao}
      >
        <Ionicons name="remove" size={tam} color={valor <= minimo ? tema.cores.textoDesabilitado : tema.cores.acao} />
      </Pressable>
      <Text style={[s.qtdValor, compacto && s.qtdValorCompacto]} accessibilityLiveRegion="polite">
        {valor}
      </Text>
      <Pressable
        onPress={() => onMudar(valor + 1)}
        disabled={valor >= maximo}
        accessibilityRole="button"
        accessibilityLabel="Aumentar"
        hitSlop={8}
        style={s.qtdBotao}
      >
        <Ionicons name="add" size={tam} color={valor >= maximo ? tema.cores.textoDesabilitado : tema.cores.acao} />
      </Pressable>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    botao: {
      minHeight: 48,
      paddingHorizontal: 20,
      borderRadius: t.raio.pequeno,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bloco: { alignSelf: 'stretch' },
    botao_primario: { backgroundColor: t.cores.acao },
    botao_secundario: { backgroundColor: t.cores.superficie, borderWidth: 1.5, borderColor: t.cores.acao },
    botao_texto: { backgroundColor: 'transparent', paddingHorizontal: 8 },
    pressionado_primario: { backgroundColor: t.cores.acaoPressionada },
    pressionado_secundario: { backgroundColor: t.cores.placeholder },
    pressionado_texto: { opacity: 0.6 },
    desabilitado: { backgroundColor: t.cores.desabilitado, borderColor: t.cores.desabilitado },
    texto: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, fontFamily: t.fontes.base },
    texto_primario: { color: t.cores.textoAcao },
    texto_secundario: { color: t.cores.acaoTexto },
    texto_texto: { color: t.cores.acaoTexto },
    textoDesabilitado: { color: t.cores.textoDesabilitado },
    foto: { backgroundColor: t.cores.placeholder },
    semFoto: { backgroundColor: t.cores.placeholder, alignItems: 'center', justifyContent: 'center' },
    qtd: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pequeno,
      backgroundColor: t.cores.superficie,
    },
    qtdCompacta: { borderRadius: t.raio.pilula },
    qtdBotao: { padding: 10 },
    qtdValor: {
      minWidth: 32,
      textAlign: 'center',
      fontSize: t.fontes.tamanho.grande,
      fontWeight: t.fontes.peso.forte,
      color: t.cores.texto,
    },
    qtdValorCompacto: { fontSize: t.fontes.tamanho.medio, minWidth: 22 },
  });
