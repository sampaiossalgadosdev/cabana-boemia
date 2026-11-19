// Configuração do app "Delivery Abatiá" (Expo). Nesta etapa só a Cabana Boemia
// (a API atual); o multi-loja vem depois. Pastas android/ e ios/ são geradas
// pelo prebuild (CNG) e não vão para o git: tudo nativo se configura aqui.

const ID_APP = 'br.com.deliveryabatia.app';

/** @type {import("expo/config").ExpoConfig} */
export default {
  name: 'Delivery Abatiá',
  slug: 'delivery-abatia',
  scheme: 'deliveryabatia',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icone.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#FBF3E8',
  ios: {
    bundleIdentifier: ID_APP,
    supportsTablet: false,
    buildNumber: '1',
    infoPlist: {
      // Sem criptografia própria (só HTTPS do sistema): dispensa a pergunta da App Store.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ID_APP,
    versionCode: 1,
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
  experiments: {
    typedRoutes: false,
  },
};
