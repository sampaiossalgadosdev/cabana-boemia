// Configuração do app "Delivery do Batiá" (Expo), multi-loja: vitrine de lojas,
// página de cada loja no tema dela (cor e logo da API). Pastas android/ e ios/
// são geradas pelo prebuild (CNG) e não vão para o git: tudo nativo se configura aqui.

const ID_APP = 'br.com.deliveryabatia.app';

// Login com Google no iOS: esquema de URL = o "iOS URL scheme" do cliente OAuth iOS
// (com.googleusercontent.apps.<...>). O plugin do Google Sign-In só mexe no iOS
// e exige esse valor: sem ele (build só Android), o plugin fica de fora.
const ESQUEMA_GOOGLE_IOS = process.env.GOOGLE_IOS_URL_SCHEME;

// Projeto no EAS (expo.dev, conta sampaio040826), criado pelo `eas init`. Público.
const EAS_PROJECT_ID = '77cc3648-5ee3-4448-a147-6c213d3a69ea';

/** @type {import("expo/config").ExpoConfig} */
export default {
  name: 'Delivery do Batiá',
  slug: 'delivery-abatia',
  scheme: 'deliveryabatia',
  version: '0.3.0',
  orientation: 'portrait',
  icon: './assets/icone.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#FBF3E8',
  ios: {
    bundleIdentifier: ID_APP,
    supportsTablet: false,
    // "Entrar com Apple" (exigido pela App Store quando há login com Google).
    usesAppleSignIn: true,
    buildNumber: '3',
    infoPlist: {
      // Sem criptografia própria (só HTTPS do sistema): dispensa a pergunta da App Store.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ID_APP,
    // Aumentar a cada envio ao Google Play (appVersionSource: local no eas.json).
    versionCode: 3,
    adaptiveIcon: {
      foregroundImage: './assets/icone-android-frente.png',
      monochromeImage: './assets/icone-android-monocromatico.png',
      backgroundColor: '#C8102E',
    },
    // Só o que o app usa: rede (fetch) e estado da rede (NetInfo).
    permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
    // Tokens do cliente no Keychain/Keystore. Sem biometria: nada de permissão de Face ID.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-apple-authentication',
    ...(ESQUEMA_GOOGLE_IOS ? [['@react-native-google-signin/google-signin', { iosUrlScheme: ESQUEMA_GOOGLE_IOS }]] : []),
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        imageWidth: 240,
        resizeMode: 'contain',
        backgroundColor: '#C8102E',
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
  ],
  extra: {
    eas: { projectId: EAS_PROJECT_ID },
  },
  owner: 'sampaio040826',
  experiments: {
    typedRoutes: false,
  },
};
