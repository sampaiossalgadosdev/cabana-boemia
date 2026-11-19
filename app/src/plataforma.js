/**
 * Liga a lógica pura (src/logica, sem React Native, testada no Node) aos
 * recursos do aparelho. Importado uma vez, no topo do layout raiz.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { usarArmazenamento } from './logica/armazenamento.js';
import { usarGeradorUuid } from './logica/uuid.js';

usarArmazenamento(AsyncStorage);
usarGeradorUuid(() => Crypto.randomUUID());
