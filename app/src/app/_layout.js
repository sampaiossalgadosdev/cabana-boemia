import '../plataforma.js';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { TemaProvider, temaCabana, useTema } from '../tema/tema.js';
import { AvisosProvider } from '../estado/Avisos.js';
import { CarrinhoProvider, useCarrinho } from '../estado/Carrinho.js';
import { CardapioProvider, useCardapio } from '../estado/Cardapio.js';
import { TelaSemInternet } from '../componentes/TelaSemInternet.js';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Erro inesperado em qualquer tela: tela própria do app (nunca a do sistema). */
export function ErrorBoundary({ error, retry }) {
  return (
    <TemaProvider tema={temaCabana}>
      <TelaSemInternet variante="erro" detalhe={__DEV__ ? error?.message : undefined} onTentarDeNovo={retry} />
    </TemaProvider>
  );
}

/** Some a splash quando a sacola foi lida e já há o que mostrar (cardápio salvo ou a primeira resposta/falha da rede). */
function EsconderSplash() {
  const { carregado } = useCarrinho();
  const { dados, primeiraTentativa } = useCardapio();
  const pronto = carregado && (Boolean(dados) || primeiraTentativa);
  useEffect(() => {
    if (pronto) SplashScreen.hideAsync().catch(() => {});
  }, [pronto]);
  return null;
}

function Navegacao() {
  const tema = useTema();
  return (
    <>
      <StatusBar style="light" />
      <EsconderSplash />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: tema.cores.cabecalho },
          headerTintColor: tema.cores.textoInverso,
          headerTitleStyle: { fontWeight: tema.fontes.peso.forte },
          contentStyle: { backgroundColor: tema.cores.fundo },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="(abas)" options={{ headerShown: false }} />
        <Stack.Screen name="produto" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sacola" options={{ presentation: 'modal', title: 'Sacola' }} />
      </Stack>
    </>
  );
}

export default function LayoutRaiz() {
  return (
    <TemaProvider tema={temaCabana}>
      <AvisosProvider>
        <CarrinhoProvider>
          <CardapioProvider>
            <Navegacao />
          </CardapioProvider>
        </CarrinhoProvider>
      </AvisosProvider>
    </TemaProvider>
  );
}
