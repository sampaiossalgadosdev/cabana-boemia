// Recursos de hardware que o Google Play deduz do manifesto e que o app NÃO exige.
// Sem isto, o Play trata como obrigatórios e esconde o app de aparelhos sem eles:
// - android.hardware.screen.portrait: deduzido do screenOrientation="portrait"
//   da activity (a orientação retrato continua: só deixa de ser exigência).
// - android.hardware.wifi: deduzido da permissão ACCESS_WIFI_STATE que o
//   @react-native-community/netinfo declara (o app funciona com dados móveis).
// Puro (objeto do manifesto no formato xml2js do Expo); usado pelo app.config.js.

export const RECURSOS_OPCIONAIS = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

/**
 * Garante `<uses-feature android:name="…" android:required="false" />` para cada
 * recurso (acerta o que já existir com outro valor, sem repetir).
 * @param {{ manifest: Record<string, any> }} manifesto
 */
export function marcarRecursosOpcionais(manifesto, recursos = RECURSOS_OPCIONAIS) {
  const raiz = manifesto.manifest;
  raiz.$ = raiz.$ ?? {};
  const lista = (raiz['uses-feature'] = raiz['uses-feature'] ?? []);
  for (const nome of recursos) {
    const existente = lista.find((f) => f?.$?.['android:name'] === nome);
    if (existente) existente.$['android:required'] = 'false';
    else lista.push({ $: { 'android:name': nome, 'android:required': 'false' } });
  }
  return manifesto;
}
