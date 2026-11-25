// Configuração do app "Taaki Delivery" (Expo), multi-loja: vitrine de lojas,
// página de cada loja no tema dela (cor e logo da API). Pastas android/ e ios/
// são geradas pelo prebuild (CNG) e não vão para o git: tudo nativo se configura aqui.

import configPlugins from 'expo/config-plugins';
import { marcarRecursosOpcionais } from './plugins/recursosOpcionais.js';

const { withAndroidManifest } = configPlugins;

// Tela retrato e Wi-Fi como recursos NÃO obrigatórios no Google Play (ver plugins/recursosOpcionais.js).
const comRecursosOpcionais = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults = marcarRecursosOpcionais(c.modResults);
    return c;
  });

// Pacote Android / bundle iOS: PERMANENTE depois da publicação (não mudar).
const ID_APP = 'br.com.taaki.app';

// Login com Google no iOS: esquema de URL = o "iOS URL scheme" do cliente OAuth iOS
// (com.googleusercontent.apps.<...>). O plugin do Google Sign-In só mexe no iOS
// e exige esse valor: sem ele (build só Android), o plugin fica de fora.
const ESQUEMA_GOOGLE_IOS = process.env.GOOGLE_IOS_URL_SCHEME;

// Chaves do Maps SDK (só o mapa no aparelho; a busca e as rotas vão pelo servidor).
// Vêm do ambiente do build (variáveis do EAS), nunca do código: a do Android é restrita
// ao pacote br.com.taaki.app e aos SHA-1 de assinatura; a do iOS, ao bundle. Sem a chave,
// o app mostra o endereço sem mapa (o pino fica para depois). Ver app/CONFIGURACAO_MAPAS.md.
const CHAVE_MAPA_ANDROID = process.env.GOOGLE_MAPS_ANDROID_KEY || '';
const CHAVE_MAPA_IOS = process.env.GOOGLE_MAPS_IOS_KEY || '';

// Texto do pedido de permissão (iOS; o Android usa o texto do sistema).
const TEXTO_LOCALIZACAO =
  'O Taaki Delivery usa a sua localização só quando você toca em "Usar minha localização", para marcar no mapa o endereço de entrega.';

// Projeto no EAS (expo.dev, conta sampaio040826), criado pelo `eas init`. Público.
const EAS_PROJECT_ID = '77cc3648-5ee3-4448-a147-6c213d3a69ea';

/** @type {import("expo/config").ExpoConfig} */
export default {
  // Nome curto, embaixo do ícone. Nos textos o produto é "Taaki Delivery".
  name: 'Taaki',
  slug: 'delivery-abatia',
  scheme: 'deliveryabatia',
  version: '0.3.0',
  orientation: 'portrait',
  icon: './assets/icone.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F5F7FA',
  ios: {
    bundleIdentifier: ID_APP,
    supportsTablet: false,
    // "Entrar com Apple" (exigido pela App Store quando há login com Google).
    usesAppleSignIn: true,
    buildNumber: '5',
    infoPlist: {
      // Sem criptografia própria (só HTTPS do sistema): dispensa a pergunta da App Store.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ID_APP,
    // Aumentar a cada envio ao Google Play (appVersionSource: local no eas.json).
    versionCode: 5,
    adaptiveIcon: {
      foregroundImage: './assets/icone-android-frente.png',
      monochromeImage: './assets/icone-android-monocromatico.png',
      backgroundColor: '#0A1428',
    },
    // Só o que o app usa: rede (fetch), estado da rede (NetInfo) e a localização com o app
    // em uso ("Usar minha localização" no endereço; nunca em segundo plano).
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
    // AD_ID: o app não usa o ID de publicidade (anúncios sem medição nem perfil);
    // bloqueada caso alguma dependência a traga pelo merge do manifesto.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'com.google.android.gms.permission.AD_ID',
      // Localização só com o app aberto: nada em segundo plano nem serviço em primeiro plano.
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
  },
  plugins: [
    'expo-router',
    // Tokens do cliente no Keychain/Keystore. Sem biometria: nada de permissão de Face ID.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-apple-authentication',
    // Mapa do endereço (Google Maps no Android e no iOS). Chave pelo ambiente do build.
    [
      'react-native-maps',
      {
        ...(CHAVE_MAPA_ANDROID && { androidGoogleMapsApiKey: CHAVE_MAPA_ANDROID }),
        ...(CHAVE_MAPA_IOS && { iosGoogleMapsApiKey: CHAVE_MAPA_IOS }),
      },
    ],
    // "Usar minha localização": só com o app em uso. Sem "sempre", sem segundo plano,
    // sem sensor de movimento e sem o pedido extra de precisão total.
    [
      'expo-location',
      {
        locationWhenInUsePermission: TEXTO_LOCALIZACAO,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        locationFullAccuracyPermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isAndroidMotionActivityEnabled: false,
      },
    ],
    ...(ESQUEMA_GOOGLE_IOS ? [['@react-native-google-signin/google-signin', { iosUrlScheme: ESQUEMA_GOOGLE_IOS }]] : []),
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 240,
        resizeMode: 'contain',
        backgroundColor: '#0A1428',
      },
    ],
    [
      'expo-build-properties',
      {
        // Exigência atual do Google Play: target API 36 (já é o padrão do RN 0.88;
        // fica explícito para não mudar sozinho numa atualização). compileSdk: o padrão (37).
        android: { targetSdkVersion: 36 },
      },
    ],
    comRecursosOpcionais,
  ],
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
    // Há mapa neste build? (sem a chave, o Google Maps não abre: o app mostra o endereço sem mapa)
    mapa: { android: Boolean(CHAVE_MAPA_ANDROID), ios: Boolean(CHAVE_MAPA_IOS) },
  },
  owner: 'sampaio040826',
  experiments: {
    typedRoutes: false,
  },
};
