/** Peças da loja: logo redonda (ou a inicial), o tema da loja aberta e a identificação legal. */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useCardapio } from '../estado/Cardapio.js';
import { BASE } from '../lib/api.js';
import { identificacaoLegal, urlDaImagem } from '../logica/lojas.js';
import { TemaProvider, temaDaLoja, useEstilos, useTema } from '../tema/tema.js';

/**
 * Logo da loja num círculo claro, com cache em disco (a rota de imagem da API
 * manda cache de 1 ano: cada logo nova é outro endereço). Sem logo ou com
 * erro: a inicial do nome na cor da loja.
 * @param {{ nome: string, logoUrl?: string | null, cor?: string, tamanho?: number }} props
 */
export function LogoLoja({ nome, logoUrl, cor, tamanho = 56 }) {
  const tema = useTema();
  const [falhou, setFalhou] = useState(false);
  const url = urlDaImagem(logoUrl, BASE);
  const caixa = {
    width: tamanho,
    height: tamanho,
    borderRadius: tamanho / 2,
    backgroundColor: tema.cores.fundo,
    borderWidth: 1,
    borderColor: tema.cores.borda,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
  return (
    <View style={caixa} accessibilityLabel={`Logo de ${nome}`}>
      {url && !falhou ? (
        <Image
          source={{ uri: url }}
          style={{ width: tamanho * 0.88, height: tamanho * 0.62 }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onError={() => setFalhou(true)}
          accessible={false}
        />
      ) : (
        <Text style={{ fontSize: tamanho * 0.42, fontWeight: '800', color: cor ?? tema.cores.acao }}>{(nome || '?').trim()[0]?.toUpperCase()}</Text>
      )}
    </View>
  );
}

/** Telas da loja aberta (página, produto, sacola, checkout): cor e logo dela. */
export function ComTemaDaLoja({ children }) {
  const { loja } = useCardapio();
  return <TemaProvider tema={temaDaLoja(loja?.nome ? loja : null)}>{children}</TemaProvider>;
}

/**
 * Identificação do fornecedor (Decreto 7.962/2013, art. 2º: nome empresarial,
 * CNPJ/CPF e endereço), no fim do cardápio da loja.
 */
export function IdentificacaoLoja({ config }) {
  const s = useEstilos(criarEstilos);
  if (!config) return null;
  return (
    <View style={s.caixa} accessibilityRole="text">
      <Text style={s.titulo}>{config.nome}</Text>
      {identificacaoLegal(config).map((linha) => (
        <Text key={linha} style={s.linha}>
          {linha}
        </Text>
      ))}
      <Text style={s.linha}>Pedido feito pelo app Delivery do Batiá, entregue e cobrado pela loja.</Text>
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    caixa: { marginHorizontal: 16, marginTop: 24, marginBottom: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.cores.borda, gap: 2 },
    titulo: { fontSize: t.fontes.tamanho.pequeno, fontWeight: t.fontes.peso.forte, color: t.cores.textoSuave },
    linha: { fontSize: 12, color: t.cores.textoSuave },
  });
