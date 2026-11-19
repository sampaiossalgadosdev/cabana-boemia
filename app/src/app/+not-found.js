import { Redirect } from 'expo-router';

// Link desconhecido (ex.: deliveryabatia://qualquer): volta ao Início.
export default function NaoEncontrado() {
  return <Redirect href="/" />;
}
