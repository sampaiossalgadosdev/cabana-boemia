import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCardapio } from '../../estado/Cardapio.js';
import { AvisosNaTela } from '../../estado/Avisos.js';
import { useUltimoPedido } from '../../estado/UltimoPedido.js';
import { Botao } from '../../componentes/basicos.js';
import { Cabecalho } from '../../componentes/Cabecalho.js';
import { AvisoFechado, FaixaSemConexao } from '../../componentes/Faixas.js';
import { AbasCategorias, ListaCardapio } from '../../componentes/ListaCardapio.js';
import { BarraSacola } from '../../componentes/BarraSacola.js';
import { TelaSemInternet } from '../../componentes/TelaSemInternet.js';
import { useEstilos, useTema } from '../../tema/tema.js';

/** Início: cardápio do turno ativo (ou a prévia do próximo, com a loja fechada). */
export default function Inicio() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { dados, categorias, podePedir, semConexao, salvoEm, buscando, recarregar } = useCardapio();
  const { ultimoPedido, repetir } = useUltimoPedido();
  const lista = useRef(null);
  const [ativa, setAtiva] = useState(null);
  const [puxou, setPuxou] = useState(false);

  useEffect(() => {
    if (!categorias.some((c) => c.id === ativa)) setAtiva(categorias[0]?.id ?? null);
  }, [categorias, ativa]);
  useEffect(() => {
    if (!buscando) setPuxou(false);
  }, [buscando]);

  const abrirProduto = useCallback((produto) => router.push({ pathname: '/produto', params: { id: produto.id } }), []);
  const irPara = (id) => {
    setAtiva(id);
    lista.current?.irPara(id);
  };

  // Nada para mostrar (primeira abertura sem internet e sem cardápio salvo).
  if (!dados) {
    return (
      <View style={s.tela}>
        <Cabecalho cardapio={null} />
        {semConexao ? (
          <TelaSemInternet onTentarDeNovo={recarregar} tentando={buscando} />
        ) : (
          <View style={s.carregando}>
            <ActivityIndicator size="large" color={tema.cores.acao} accessibilityLabel="Carregando cardápio" />
          </View>
        )}
      </View>
    );
  }

  const fechado = !dados.aberto;
  return (
    <View style={s.tela}>
      <Cabecalho cardapio={dados} />
      {categorias.length > 0 && <AbasCategorias categorias={categorias} ativa={ativa} onSelecionar={irPara} />}
      <ListaCardapio
        ref={lista}
        categorias={categorias}
        desabilitado={!podePedir}
        onAbrir={abrirProduto}
        onCategoriaVisivel={setAtiva}
        atualizando={puxou && buscando}
        onAtualizar={() => {
          setPuxou(true);
          recarregar();
        }}
        cabecalho={
          <>
            {semConexao && <FaixaSemConexao salvoEm={salvoEm} podePedir={podePedir} />}
            {fechado && <AvisoFechado proximaAbertura={dados.proximaAbertura} />}
            {podePedir && ultimoPedido?.itens.length > 0 && categorias.length > 0 && (
              <View style={s.repetir}>
                <Text style={s.repetirTexto}>Bateu a vontade de novo?</Text>
                <Botao titulo="Repetir último pedido" variante="secundario" onPress={() => repetir(ultimoPedido)} />
              </View>
            )}
          </>
        }
      />
      <BarraSacola />
      <AvisosNaTela distanciaDoFim={90} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    carregando: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    repetir: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginHorizontal: 16,
      marginTop: 12,
      padding: 12,
      borderRadius: t.raio.normal,
      backgroundColor: t.cores.superficie,
      borderWidth: 1,
      borderColor: t.cores.borda,
    },
    repetirTexto: { flex: 1, fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.medio, color: t.cores.texto },
  });
