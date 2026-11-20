import { createContext, useContext, useEffect, useState } from 'react';
import { temaDaLoja } from '../lib/tema.js';

/** Loja em que o PDV trabalha (identidade vinda do main, com a logo em data:). */
export const LojaContexto = createContext(null);
export const useLoja = () => useContext(LojaContexto);

/**
 * Logo da loja; sem logo (ou se a imagem falhar), o nome em texto. Sem loja
 * (login, ADMIN escolhendo): o nome da plataforma.
 */
export function Logo({ className = '' }) {
  const tema = temaDaLoja(useLoja());
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [tema.logo]);
  if (!tema.logo || falhou) return <span className={`logo logo--texto ${className}`}>{tema.nome}</span>;
  return <img className={`logo ${className}`} src={tema.logo} alt={tema.nome} onError={() => setFalhou(true)} />;
}
