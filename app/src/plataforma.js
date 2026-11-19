/**
 * Liga a lógica pura (src/logica, sem React Native, testada no Node) aos
 * recursos do aparelho. Importado uma vez, no topo do layout raiz.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { usarArmazenamento, usarCofre } from './logica/armazenamento.js';
import { usarGeradorUuid } from './logica/uuid.js';

usarArmazenamento(AsyncStorage);

// Tokens só no cofre do sistema (Keychain/Keystore). Depois do primeiro
// desbloqueio: o app abre e renova a sessão mesmo com a tela bloqueada.
usarCofre({
  getItem: (chave) => SecureStore.getItemAsync(chave),
  setItem: (chave, valor) => SecureStore.setItemAsync(chave, valor, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  removeItem: (chave) => SecureStore.deleteItemAsync(chave),
});

usarGeradorUuid(() => Crypto.randomUUID());
