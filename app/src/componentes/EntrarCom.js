import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCliente } from '../estado/Cliente.js';
import { appleDisponivel } from '../login/provedores.js';
import { URL_PRIVACIDADE, URL_TERMOS } from '../lib/links.js';
import { useEstilos, useTema } from '../tema/tema.js';
import { TextoErro, Titulo } from './formulario.js';

function BotaoApple({ onPress, desabilitado }) {
  // Botão oficial (exigência das diretrizes da Apple); carregado só no iOS.
  const A = require('expo-apple-authentication');
  return (
    <View style={{ opacity: desabilitado ? 0.5 : 1 }} pointerEvents={desabilitado ? 'none' : 'auto'}>
      <A.AppleAuthenticationButton
        buttonType={A.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={A.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={10}
        style={{ height: 48, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}

/**
 * Login (checkout, Pedidos, Perfil): Google em todos; Apple só no iOS.
 * Erros do login viram texto na tela; cancelar não mostra nada.
 */
export function EntrarCom({ titulo, texto }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { entrarComGoogle, entrarComApple } = useCliente();
  const [apple, setApple] = useState(false);
  const [ocupado, setOcupado] = useState(null); // 'google' | 'apple'
  const [erro, setErro] = useState('');

  useEffect(() => {
    appleDisponivel().then(setApple);
  }, []);

  const entrar = async (qual) => {
    setErro('');
    setOcupado(qual);
    try {
      await (qual === 'google' ? entrarComGoogle() : entrarComApple());
    } catch (e) {
      if (!e?.cancelado) setErro(e?.status ? e.message : e?.message || 'Não foi possível entrar. Tente de novo.');
    } finally {
      setOcupado(null);
    }
  };

  return (
    <View style={s.bloco}>
      <Titulo subtitulo={texto}>{titulo}</Titulo>
      <Pressable
        onPress={() => entrar('google')}
        disabled={Boolean(ocupado)}
        accessibilityRole="button"
        accessibilityState={{ busy: ocupado === 'google' }}
        style={({ pressed }) => [s.google, pressed && s.googlePressionado, ocupado && s.ocupado]}
      >
        <Ionicons name="logo-google" size={20} color={tema.cores.texto} />
        <Text style={s.googleTexto}>{ocupado === 'google' ? 'Entrando…' : 'Continuar com Google'}</Text>
      </Pressable>
      {apple && <BotaoApple onPress={() => entrar('apple')} desabilitado={Boolean(ocupado)} />}
      <TextoErro>{erro}</TextoErro>
      <Text style={s.legal}>
        Ao entrar você concorda com os{' '}
        <Text style={s.link} onPress={() => Linking.openURL(URL_TERMOS)}>
          termos
        </Text>{' '}
        e a{' '}
        <Text style={s.link} onPress={() => Linking.openURL(URL_PRIVACIDADE)}>
          política de privacidade
        </Text>
        .
      </Text>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    bloco: { gap: 12 },
    google: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      borderRadius: t.raio.pequeno,
      borderWidth: 1,
      borderColor: t.cores.borda,
      backgroundColor: t.cores.superficie,
      marginTop: 8,
    },
    googlePressionado: { backgroundColor: t.cores.placeholder },
    ocupado: { opacity: 0.6 },
    googleTexto: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.medio, color: t.cores.texto },
    legal: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, textAlign: 'center' },
    link: { color: t.cores.acao, textDecorationLine: 'underline' },
  });
