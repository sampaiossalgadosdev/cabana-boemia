import '../plataforma.js';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { TemaProvider, temaPadrao, useTema } from '../tema/tema.js';
import { LojasProvider, useLojas } from '../estado/Lojas.js';
import { AvisosProvider } from '../estado/Avisos.js';
import { CarrinhoProvider, useCarrinho } from '../estado/Carrinho.js';
import { CardapioProvider } from '../estado/Cardapio.js';
import { ClienteProvider } from '../estado/Cliente.js';
import { UltimoPedidoProvider } from '../estado/UltimoPedido.js';
import { TelaSemInternet } from '../componentes/TelaSemInternet.js';
import { AceiteTermos } from '../componentes/AceiteTermos.js';
import { PedirNome } from '../componentes/PedirNome.js';
import { RetomarPix } from '../componentes/RetomarPix.js';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Erro inesperado em qualquer tela: tela própria do app (nunca a do sistema). */
export function ErrorBoundary({ error, retry }) {
  return (
    <TemaProvider tema={temaPadrao}>
      <TelaSemInternet variante="erro" detalhe={__DEV__ ? error?.message : undefined} onTentarDeNovo={retry} />
    </TemaProvider>
  );
}

/** Some a splash quando a sacola foi lida e já há o que mostrar (lista de lojas salva ou a primeira resposta/falha da rede). */
function EsconderSplash() {
  const { carregado } = useCarrinho();
  const { lojas, primeiraTentativa } = useLojas();
  const pronto = carregado && (Boolean(lojas) || primeiraTentativa);
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
        <Stack.Screen name="loja/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="produto" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sacola" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="sobre" options={{ title: 'Sobre' }} />
        {/* Volta do Checkout Pro (cartão): só retorna à tela do cartão. */}
        <Stack.Screen name="cartao-retorno" options={{ headerShown: false, animation: 'none' }} />
      </Stack>
      <AceiteTermos />
      <PedirNome />
      <RetomarPix />
    </>
  );
}

export default function LayoutRaiz() {
  return (
    <TemaProvider tema={temaPadrao}>
      <AvisosProvider>
        <LojasProvider>
          <CarrinhoProvider>
            <CardapioProvider>
              <ClienteProvider>
                <UltimoPedidoProvider>
                  <Navegacao />
                </UltimoPedidoProvider>
              </ClienteProvider>
            </CardapioProvider>
          </CarrinhoProvider>
        </LojasProvider>
      </AvisosProvider>
    </TemaProvider>
  );
}
