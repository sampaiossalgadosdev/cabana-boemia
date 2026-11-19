import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useEstilos } from '../tema/tema.js';

const DURACAO_MS = 4000;
const AvisosContext = createContext(null);

/** Avisos curtos (ex.: "o preço do X-Bacon mudou"). Vários na fila, um por vez. */
export function AvisosProvider({ children }) {
  const [fila, setFila] = useState([]);
  const id = useRef(0);
  const avisar = useCallback((texto) => {
    id.current += 1;
    setFila((f) => [...f, { id: id.current, texto }]);
  }, []);
  const dispensar = useCallback((idAviso) => setFila((f) => f.filter((a) => a.id !== idAviso)), []);
  const valor = useMemo(() => ({ fila, avisar, dispensar }), [fila, avisar, dispensar]);
  return <AvisosContext.Provider value={valor}>{children}</AvisosContext.Provider>;
}

export function useAvisos() {
  const ctx = useContext(AvisosContext);
  if (!ctx) throw new Error('useAvisos fora do AvisosProvider');
  return ctx;
}

/**
 * Mostra o aviso da vez. Cada tela que pode ficar por cima (abas, sacola,
 * produto) monta o seu: só o da tela em foco aparece (um modal nativo
 * cobriria o aviso da tela de baixo, como o <dialog> no site).
 */
export function AvisosNaTela({ distanciaDoFim = 16 }) {
  const { fila, dispensar } = useAvisos();
  const emFoco = useIsFocused();
  const s = useEstilos(criarEstilos);
  const atual = emFoco ? fila[0] : null;
  const opacidade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!atual) return undefined;
    opacidade.setValue(0);
    Animated.timing(opacidade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const t = setTimeout(() => dispensar(atual.id), DURACAO_MS);
    return () => clearTimeout(t);
  }, [atual, dispensar, opacidade]);

  if (!atual) return null;
  return (
    <View pointerEvents="none" style={[s.camada, { bottom: distanciaDoFim }]}>
      <Animated.View style={[s.aviso, { opacity: opacidade }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Text style={s.texto}>{atual.texto}</Text>
      </Animated.View>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    camada: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
    aviso: {
      backgroundColor: t.cores.texto,
      borderRadius: t.raio.pequeno,
      paddingVertical: 12,
      paddingHorizontal: 16,
      maxWidth: 480,
      elevation: 6,
      shadowColor: t.cores.sombra,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    texto: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.normal, fontFamily: t.fontes.base },
  });
