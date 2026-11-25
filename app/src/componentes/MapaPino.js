import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { pinValido } from '@restaurante/shared/mapa';
import { mapaDisponivel, mensagemDaBusca, mensagemDaLocalizacao, regiaoDoMapa } from '../logica/mapa.js';
import { useEstilos, useTema } from '../tema/tema.js';
import { Botao } from './basicos.js';

/** Módulos nativos carregados sob demanda: sem eles (web, build antigo), o endereço segue sem mapa. */
function carregarMapas() {
  try {
    return require('react-native-maps');
  } catch {
    return null;
  }
}
function carregarLocalizacao() {
  try {
    return require('expo-location');
  } catch {
    return null;
  }
}

/** Este aparelho/build tem mapa? (chave do Maps SDK no build ou Expo Go) */
export function temMapa() {
  return (
    mapaDisponivel({
      plataforma: Platform.OS,
      extra: Constants.expoConfig?.extra,
      emExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    }) && Boolean(carregarMapas())
  );
}

/**
 * Mapa com o pino do endereço: "Buscar no mapa" (pelo servidor, com o texto
 * digitado), "Usar minha localização" (GPS só com o app em uso) e arrastar o
 * pino ou tocar no mapa. Nada aqui mexe no texto do endereço.
 *
 * @param {{ pino: { latitude: number, longitude: number } | null, aoMudar: (p) => void,
 *           aoBuscar?: () => Promise<{ pin, aproximado, motivo }>, buscarAoAbrir?: boolean }} props
 *   `aoBuscar` lança com a mensagem a mostrar (ex.: "Informe a rua") quando falta algo.
 */
export function MapaPino({ pino, aoMudar, aoBuscar, buscarAoAbrir = false }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const Mapas = carregarMapas();
  const mapa = useRef(null);
  const [mensagem, setMensagem] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [localizando, setLocalizando] = useState(false);

  const irPara = (p, opcoes) => mapa.current?.animateToRegion?.(regiaoDoMapa(p, opcoes), 400);

  async function buscar() {
    if (!aoBuscar) return;
    setBuscando(true);
    setMensagem(null);
    try {
      const r = await aoBuscar();
      setMensagem(mensagemDaBusca(r));
      if (r.pin) {
        aoMudar(r.pin);
        irPara(r.pin, { aproximado: r.aproximado });
      }
    } catch (erro) {
      setMensagem({ tipo: 'aviso', texto: erro?.message || mensagemDaBusca({ pin: null }).texto });
    } finally {
      setBuscando(false);
    }
  }

  async function usarMinhaLocalizacao() {
    const Location = carregarLocalizacao();
    if (!Location) return setMensagem({ tipo: 'aviso', texto: mensagemDaLocalizacao('erro') });
    setLocalizando(true);
    setMensagem(null);
    try {
      // Só "com o app em uso": o app nunca pede localização em segundo plano.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setMensagem({ tipo: 'aviso', texto: mensagemDaLocalizacao('negada') });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      aoMudar(p);
      irPara(p);
      setMensagem({ tipo: 'ok', texto: 'Confira o pino e, se precisar, arraste até a sua porta.' });
    } catch {
      setMensagem({ tipo: 'aviso', texto: mensagemDaLocalizacao('erro') });
    } finally {
      setLocalizando(false);
    }
  }

  // Confirmação no checkout: já abre buscando pelo texto do endereço.
  useEffect(() => {
    if (buscarAoAbrir && !pinValido(pino)) buscar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!Mapas) return null;
  const { default: MapView, Marker, PROVIDER_GOOGLE } = Mapas;
  const mover = (e) => aoMudar(e.nativeEvent.coordinate);

  return (
    <View style={s.caixa}>
      <View style={s.mapa}>
        <MapView
          ref={mapa}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          initialRegion={regiaoDoMapa(pino)}
          onPress={mover}
          toolbarEnabled={false}
          showsPointsOfInterest={false}
          accessibilityLabel="Mapa: toque onde fica a sua porta ou arraste o pino"
        >
          {pinValido(pino) && <Marker coordinate={pino} draggable onDragEnd={mover} pinColor={tema.cores.acao} />}
        </MapView>
      </View>
      <Text style={[s.mensagem, mensagem?.tipo === 'aviso' && s.aviso]}>
        {mensagem?.texto ?? (pinValido(pino) ? 'Arraste o pino até a sua porta, se precisar.' : 'Toque no mapa onde fica a sua porta.')}
      </Text>
      <View style={s.botoes}>
        {aoBuscar && <Botao titulo={buscando ? 'Buscando…' : 'Buscar no mapa'} variante="secundario" onPress={buscar} carregando={buscando} estilo={s.botao} />}
        <Botao titulo={localizando ? 'Localizando…' : 'Usar minha localização'} variante="secundario" onPress={usarMinhaLocalizacao} carregando={localizando} estilo={s.botao} />
      </View>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    caixa: { marginTop: 12, gap: 8 },
    mapa: {
      height: 240,
      borderRadius: t.raio.normal,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.cores.borda,
      backgroundColor: t.cores.superficie,
    },
    mensagem: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    aviso: { color: t.cores.acaoTexto },
    botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    botao: { flexGrow: 1 },
  });
