/** Peças de formulário: campo de texto com rótulo e erro, opção (rádio/caixa) e textos de erro. */
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEstilos, useTema } from '../tema/tema.js';

export const Campo = forwardRef(function Campo({ rotulo, erro, dica, estilo, ...props }, ref) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  return (
    <View style={[s.campo, estilo]}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={tema.cores.textoDesabilitado}
        style={[s.entrada, erro && s.entradaErro]}
        accessibilityLabel={rotulo}
        {...props}
      />
      {dica && !erro ? <Text style={s.dica}>{dica}</Text> : null}
      {erro ? <Text style={s.erro}>{erro}</Text> : null}
    </View>
  );
});

/** Linha tocável com rádio (`tipo="radio"`) ou caixa (`"caixa"`), título e detalhe. */
export function Opcao({ titulo, detalhe, marcada, onPress, desabilitada, tipo = 'radio' }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const icone = tipo === 'radio' ? (marcada ? 'radio-button-on' : 'radio-button-off') : marcada ? 'checkbox' : 'square-outline';
  return (
    <Pressable
      onPress={onPress}
      disabled={desabilitada}
      accessibilityRole={tipo === 'radio' ? 'radio' : 'checkbox'}
      accessibilityState={{ checked: Boolean(marcada), disabled: Boolean(desabilitada) }}
      style={({ pressed }) => [s.opcao, marcada && s.opcaoMarcada, pressed && s.opcaoPressionada, desabilitada && s.opcaoDesabilitada]}
    >
      <Ionicons name={icone} size={22} color={desabilitada ? tema.cores.textoDesabilitado : tema.cores.acao} />
      <View style={s.opcaoTextos}>
        <Text style={[s.opcaoTitulo, desabilitada && s.textoDesabilitado]}>{titulo}</Text>
        {detalhe ? <Text style={s.opcaoDetalhe}>{detalhe}</Text> : null}
      </View>
    </Pressable>
  );
}

export function TextoErro({ children }) {
  const s = useEstilos(criarEstilos);
  if (!children) return null;
  return (
    <Text style={s.erroGeral} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      {children}
    </Text>
  );
}

export function Titulo({ children, subtitulo }) {
  const s = useEstilos(criarEstilos);
  return (
    <View style={s.tituloBloco}>
      <Text style={s.titulo} accessibilityRole="header">
        {children}
      </Text>
      {subtitulo ? <Text style={s.subtitulo}>{subtitulo}</Text> : null}
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    campo: { marginTop: 12 },
    rotulo: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.forte, color: t.cores.texto, marginBottom: 6 },
    entrada: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pequeno,
      paddingHorizontal: 12,
      fontSize: t.fontes.tamanho.medio,
      color: t.cores.texto,
      backgroundColor: t.cores.superficie,
    },
    entradaErro: { borderColor: t.cores.acao },
    dica: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 4 },
    erro: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.acaoPressionada, marginTop: 4 },
    erroGeral: {
      fontSize: t.fontes.tamanho.normal,
      color: t.cores.acaoPressionada,
      backgroundColor: t.cores.avisoFundo,
      borderRadius: t.raio.pequeno,
      padding: 12,
      marginTop: 12,
    },
    opcao: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pequeno,
      backgroundColor: t.cores.superficie,
      marginTop: 8,
    },
    opcaoMarcada: { borderColor: t.cores.acao, borderWidth: 1.5 },
    opcaoPressionada: { backgroundColor: t.cores.placeholder },
    opcaoDesabilitada: { opacity: 0.6 },
    opcaoTextos: { flex: 1 },
    opcaoTitulo: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.medio, color: t.cores.texto },
    opcaoDetalhe: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 2 },
    textoDesabilitado: { color: t.cores.textoDesabilitado },
    tituloBloco: { marginBottom: 4 },
    titulo: { fontSize: t.fontes.tamanho.grande, fontWeight: t.fontes.peso.pesado, color: t.cores.texto },
    subtitulo: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, marginTop: 4, lineHeight: 21 },
  });
