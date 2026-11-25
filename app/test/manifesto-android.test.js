import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcarRecursosOpcionais, RECURSOS_OPCIONAIS } from '../plugins/recursosOpcionais.js';
import config from '../app.config.js';

/** Manifesto Android: recursos não obrigatórios no Play e permissões bloqueadas. */

const recursos = (m) => m.manifest['uses-feature'].map((f) => [f.$['android:name'], f.$['android:required']]);

test('acrescenta tela retrato e Wi-Fi como required=false', () => {
  const m = marcarRecursosOpcionais({ manifest: { $: {} } });
  assert.deepEqual(recursos(m), [
    ['android.hardware.screen.portrait', 'false'],
    ['android.hardware.wifi', 'false'],
  ]);
});

test('acerta o que já existe, sem repetir, e mantém os outros', () => {
  const m = marcarRecursosOpcionais({
    manifest: {
      'uses-feature': [
        { $: { 'android:name': 'android.hardware.wifi', 'android:required': 'true' } },
        { $: { 'android:name': 'android.hardware.camera', 'android:required': 'true' } },
      ],
    },
  });
  marcarRecursosOpcionais(m); // de novo: idempotente
  assert.deepEqual(recursos(m), [
    ['android.hardware.wifi', 'false'],
    ['android.hardware.camera', 'true'],
    ['android.hardware.screen.portrait', 'false'],
  ]);
  assert.deepEqual(RECURSOS_OPCIONAIS, ['android.hardware.screen.portrait', 'android.hardware.wifi']);
});

test('app.config: retrato mantido, AD_ID bloqueada, plugin ligado', () => {
  assert.equal(config.orientation, 'portrait');
  assert.ok(config.android.blockedPermissions.includes('com.google.android.gms.permission.AD_ID'));
  assert.ok(config.plugins.some((p) => typeof p === 'function'));
});

test('app.config: versionCode 5 e buildNumber "5" (versão de exibição 0.3.0)', () => {
  assert.equal(config.android.versionCode, 5);
  assert.equal(config.ios.buildNumber, '5');
  assert.equal(config.version, '0.3.0');
});

test('app.config: localização só com o app em uso; mapa com a chave só do ambiente', () => {
  const p = config.android.permissions;
  assert.ok(p.includes('android.permission.ACCESS_FINE_LOCATION') && p.includes('android.permission.ACCESS_COARSE_LOCATION'));
  assert.ok(!p.some((x) => /BACKGROUND|FOREGROUND_SERVICE/.test(x)));
  assert.ok(config.android.blockedPermissions.includes('android.permission.ACCESS_BACKGROUND_LOCATION'));
  const plugin = (nome) => config.plugins.find((x) => Array.isArray(x) && x[0] === nome)?.[1];
  const local = plugin('expo-location');
  assert.equal(local.isAndroidBackgroundLocationEnabled, false);
  assert.equal(local.isIosBackgroundLocationEnabled, false);
  assert.equal(local.locationAlwaysPermission, false);
  assert.match(local.locationWhenInUsePermission, /Usar minha localização/);
  // Sem GOOGLE_MAPS_*_KEY no ambiente dos testes: nenhuma chave no config.
  assert.ok(plugin('react-native-maps'));
  assert.equal(plugin('react-native-maps').androidGoogleMapsApiKey, process.env.GOOGLE_MAPS_ANDROID_KEY || undefined);
  assert.deepEqual(config.extra.mapa, { android: Boolean(process.env.GOOGLE_MAPS_ANDROID_KEY), ios: Boolean(process.env.GOOGLE_MAPS_IOS_KEY) });
  assert.doesNotMatch(JSON.stringify(config), /AIza/, 'nenhuma chave do Google escrita no código');
});
