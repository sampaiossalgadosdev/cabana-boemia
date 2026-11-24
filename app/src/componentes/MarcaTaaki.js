import { Image } from 'expo-image';
import { LOGO_TAAKI } from '../tema/tema.js';

/**
 * Logo do Taaki Delivery, sempre recortado em círculo (o JPEG tem os cantos
 * pretos). Só nas telas da plataforma (vitrine, login, aceite, nome, Sobre);
 * dentro de uma loja vale a logo dela.
 */
export function MarcaTaaki({ tamanho = 64, estilo }) {
  return (
    <Image
      source={LOGO_TAAKI}
      style={[{ width: tamanho, height: tamanho, borderRadius: tamanho / 2 }, estilo]}
      contentFit="cover"
      accessibilityLabel="Taaki Delivery"
    />
  );
}
