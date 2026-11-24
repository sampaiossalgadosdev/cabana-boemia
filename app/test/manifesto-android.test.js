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
