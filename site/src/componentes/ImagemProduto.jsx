import { useState } from 'react';

/** Placeholder neutro: fundo claro com um ícone de prato e talheres. */
function SemFoto({ className }) {
  return (
    <span className={`${className} imagem-produto--vazia`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="5.5" />
        <path d="M3 4v4.5a1.5 1.5 0 0 0 3 0V4M4.5 4v16M21 4c-1.7 0-2.5 2-2.5 5s.8 3.5 2.5 3.5V20" />
      </svg>
    </span>
  );
}

function Foto({ src, className, carregamento, semFoto }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return semFoto;
  return (
    <img className={className} src={src} alt="" loading={carregamento} decoding="async" onError={() => setFalhou(true)} />
  );
}

/**
 * Foto do produto (`imagemUrl`, editável na retaguarda). Sem link ou se a
 * imagem falhar: placeholder (`placeholder={false}` não mostra nada). Decorativa
 * (alt vazio): o nome do produto já está ao lado.
 */
export function ImagemProduto({ src, className, carregamento = 'lazy', placeholder = true }) {
  const semFoto = placeholder ? <SemFoto className={className} /> : null;
  if (!src) return semFoto;
  // key: link novo (cardápio recarregado) tenta carregar de novo.
  return <Foto key={src} src={src} className={className} carregamento={carregamento} semFoto={semFoto} />;
}
