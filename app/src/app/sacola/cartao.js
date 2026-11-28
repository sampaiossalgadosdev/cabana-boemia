import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCliente } from '../../estado/Cliente.js';
import { useCarrinho } from '../../estado/Carrinho.js';
import { useUltimoPedido } from '../../estado/UltimoPedido.js';
import * as api from '../../lib/api.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import {
  INTERVALO_CONSULTA_MS,
  MENSAGEM_CARTAO_EXPIRADO,
  MENSAGEM_CARTAO_PAGO_TARDE,
  apagarCartaoPendente,
  checkoutSeguro,
  estadoDoCartao,
  lerCartaoPendente,
  salvarCartaoPendente,
  tempoRestante,
} from '../../logica/pagamento.js';
import { Botao } from '../../componentes/basicos.js';
import { TextoErro } from '../../componentes/formulario.js';
import { useEstilos, useTema } from '../../tema/tema.js';

/**
 * Abre o Checkout Pro no navegador do app (módulos nativos carregados só aqui). Volta quando o
 * cliente fecha o navegador ou quando a página de volta da API manda para `cartao-retorno`.
 */
async function abrirNavegador(url) {
  const WebBrowser = require('expo-web-browser');
  const Linking = require('expo-linking');
  return WebBrowser.openAuthSessionAsync(url, Linking.createURL('cartao-retorno'));
}

/**
 * Pagar com cartão (Etapa 7 do pagamento online): o Checkout Pro do Mercado Pago no navegador
 * do app. A volta do navegador NUNCA aprova nada: a tela consulta a NOSSA API (a cada 5 s, ao
 * voltar do navegador e ao voltar para o app). Aprovado: a sacola esvazia e vai para "Pedido nº N
 * recebido". Recusado: o motivo, "Tentar de novo" (o mesmo checkout) e "Escolher outra forma de
 * pagamento" (desiste do pedido e volta ao checkout). Expirado: aviso e volta à sacola guardada.
 * O cartão pendente fica no aparelho: fechar e reabrir o app volta para esta tela.
 */
export default function TelaCartao() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom } = useSafeAreaInsets();
  const { abrir } = useLocalSearchParams();
  const { chamar } = useCliente();
  const { substituir } = useCarrinho();
  const { setPedidoEnviado, recarregar: recarregarUltimo } = useUltimoPedido();
  const navegacao = useNavigation();
  const [cartao, setCartao] = useState(null);
  // carregando | aguardando | recusado | aprovado | expirado | pago_tarde | sem_cartao
  const [estado, setEstado] = useState('carregando');
  const [recusa, setRecusa] = useState('');
  const [agora, setAgora] = useState(Date.now());
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const resolvido = useRef(false);
  const abriuSozinho = useRef(false);

  useEffect(() => {
    lerCartaoPendente().then((dados) => {
      setCartao(dados);
      setEstado(dados ? 'aguardando' : 'sem_cartao');
    });
  }, []);

  const terminar = useCallback(
    async (r) => {
      if (resolvido.current) return;
      const novo = estadoDoCartao(r.pagamento);
      if (novo === 'aguardando' || novo === 'recusado') {
        setEstado(novo);
        setRecusa(r.pagamento?.recusa?.mensagem ?? '');
        // O link do checkout pode ter mudado (reenvio): guarda o mais novo.
        if (r.pagamento?.checkoutUrl) setCartao((c) => (c && c.checkoutUrl !== r.pagamento.checkoutUrl ? { ...c, checkoutUrl: r.pagamento.checkoutUrl } : c));
        return;
      }
      resolvido.current = true;
      await apagarCartaoPendente();
      if (novo === 'aprovado') {
        setPedidoEnviado(r.pedido);
        substituir([]);
        recarregarUltimo();
        router.replace('/sacola/enviado');
        return;
      }
      setEstado(novo);
    },
    [setPedidoEnviado, substituir, recarregarUltimo],
  );

  const consultar = useCallback(async () => {
    if (!cartao || resolvido.current) return;
    try {
      const r = await chamar((token) => api.situacaoDoPagamento(token, cartao.pedidoId));
      setErro('');
      await terminar(r);
    } catch (e) {
      if (e?.status === 404) {
        resolvido.current = true;
        await apagarCartaoPendente();
        setEstado('sem_cartao');
        return;
      }
      setErro(e?.status ? e.message : 'Sem conexão. Continuamos tentando…');
    }
  }, [cartao, chamar, terminar]);

  const abrirCheckout = useCallback(async () => {
    const url = checkoutSeguro(cartao?.checkoutUrl);
    if (!url) return setErro('Não foi possível abrir o pagamento. Escolha outra forma de pagamento.');
    setErro('');
    try {
      await abrirNavegador(url);
    } catch {
      setErro('Não foi possível abrir o navegador. Tente de novo.');
    }
    // Voltou do navegador (pagou, desistiu ou fechou): quem decide é a nossa API.
    consultar();
  }, [cartao, consultar]);

  // Vindo do checkout: abre o pagamento uma vez, sozinho.
  useEffect(() => {
    if (estado === 'aguardando' && abrir === '1' && cartao && !abriuSozinho.current) {
      abriuSozinho.current = true;
      abrirCheckout();
    }
  }, [estado, abrir, cartao, abrirCheckout]);

  // Consulta a cada 5 s, o relógio a cada 1 s e uma consulta ao voltar para o app.
  const esperando = estado === 'aguardando' || estado === 'recusado';
  useEffect(() => {
    if (!esperando) return undefined;
    consultar();
    const consulta = setInterval(consultar, INTERVALO_CONSULTA_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    const app = AppState.addEventListener('change', (e) => e === 'active' && consultar());
    return () => {
      clearInterval(consulta);
      clearInterval(relogio);
      app.remove();
    };
  }, [esperando, consultar]);

  useEffect(() => {
    if (cartao) salvarCartaoPendente(cartao);
  }, [cartao]);

  /** "Escolher outra forma de pagamento": desiste deste pedido e volta ao checkout (Decisão 11). */
  const outraForma = async () => {
    setOcupado(true);
    setErro('');
    try {
      const r = await chamar((token) => api.desistirDoPagamento(token, cartao.pedidoId));
      if (estadoDoCartao(r.pagamento) === 'aprovado') return terminar(r); // pago no último segundo
      resolvido.current = true;
      await apagarCartaoPendente();
      router.replace('/sacola/checkout');
    } catch (e) {
      setErro(e?.status ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const voltarParaSacola = () => router.replace('/sacola');
  const fecharTudo = () => {
    const raiz = navegacao.getParent();
    if (raiz?.canGoBack()) raiz.goBack();
    else router.replace('/');
  };

  if (estado === 'carregando') {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator color={tema.cores.acao} />
      </View>
    );
  }

  if (estado === 'sem_cartao') {
    return (
      <View style={[s.tela, s.centro, s.conteudo]}>
        <Text style={s.texto}>Nenhum pagamento com cartão aguardando.</Text>
        <Botao titulo="Voltar à sacola" onPress={voltarParaSacola} estilo={{ marginTop: 16 }} />
      </View>
    );
  }

  if (estado === 'expirado' || estado === 'pago_tarde') {
    return (
      <View style={[s.tela, s.centro, s.conteudo]}>
        <Ionicons name="time-outline" size={48} color={tema.cores.erro} />
        <Text style={s.titulo} accessibilityRole="header">
          {estado === 'pago_tarde' ? 'Pagamento fora do prazo' : 'O prazo para pagar acabou'}
        </Text>
        <Text style={s.texto}>{estado === 'pago_tarde' ? MENSAGEM_CARTAO_PAGO_TARDE : MENSAGEM_CARTAO_EXPIRADO}</Text>
        <Botao titulo="Voltar à sacola" onPress={voltarParaSacola} bloco estilo={{ marginTop: 20 }} />
      </View>
    );
  }

  const tempo = tempoRestante(cartao.expiraEm, agora);
  const recusado = estado === 'recusado';
  return (
    <ScrollView style={s.tela} contentContainerStyle={[s.conteudo, { paddingBottom: bottom + 24 }]}>
      <Text style={s.titulo} accessibilityRole="header">
        {recusado ? 'Pagamento recusado' : 'Pague com cartão'}
      </Text>
      {cartao.loja?.nome ? <Text style={s.texto}>{`Pedido em ${cartao.loja.nome}`}</Text> : null}
      <Text style={s.valor}>{formatarPreco(cartao.valorCentavos)}</Text>

      <View style={s.cartaoTempo} accessibilityLiveRegion="polite">
        <Text style={s.rotulo}>{tempo.acabou ? 'Prazo encerrado. Conferindo o pagamento…' : 'Pague em até'}</Text>
        {!tempo.acabou && (
          <Text style={s.tempo} accessibilityLabel={`${Math.floor(tempo.segundos / 60)} minutos e ${tempo.segundos % 60} segundos`}>
            {tempo.texto}
          </Text>
        )}
      </View>

      {recusado ? (
        <View style={s.aviso} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={22} color={tema.cores.erro} />
          <Text style={s.textoAviso}>{recusa || 'O pagamento foi recusado.'} O pedido ainda não foi enviado.</Text>
        </View>
      ) : (
        <Text style={s.passos}>
          O pagamento abre na página segura do Mercado Pago, aqui dentro do app. Crédito à vista ou débito. O pedido vai para a loja
          assim que o pagamento for aprovado.
        </Text>
      )}

      <Botao
        titulo={recusado ? 'Tentar de novo' : 'Abrir pagamento'}
        onPress={abrirCheckout}
        desabilitado={tempo.acabou || ocupado}
        bloco
        estilo={{ marginTop: 12 }}
      />
      <Botao
        titulo="Escolher outra forma de pagamento"
        variante="secundario"
        onPress={outraForma}
        carregando={ocupado}
        desabilitado={ocupado}
        bloco
        estilo={{ marginTop: 8 }}
      />

      {!recusado && (
        <View style={s.aguardando}>
          <ActivityIndicator color={tema.cores.acao} />
          <Text style={s.nota}>Aguardando a confirmação do Mercado Pago.</Text>
        </View>
      )}
      <TextoErro>{erro}</TextoErro>

      <Botao
        titulo="Fechar e voltar depois"
        variante="texto"
        onPress={fecharTudo}
        bloco
        estilo={{ marginTop: 8 }}
        rotuloAcessivel="Fechar esta tela. O pagamento continua valendo até o fim do prazo; ao abrir o app de novo, esta tela volta."
      />
    </ScrollView>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    centro: { alignItems: 'center', justifyContent: 'center' },
    conteudo: { padding: 20, gap: 8 },
    titulo: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.forte, color: t.cores.texto, textAlign: 'center', marginTop: 8 },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, textAlign: 'center' },
    valor: { fontSize: 28, fontWeight: t.fontes.peso.forte, color: t.cores.texto, textAlign: 'center' },
    cartaoTempo: {
      alignItems: 'center',
      padding: 12,
      borderRadius: t.raio.normal,
      backgroundColor: t.cores.superficie,
      borderWidth: 1,
      borderColor: t.cores.borda,
    },
    rotulo: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    tempo: { fontSize: 32, fontWeight: t.fontes.peso.forte, color: t.cores.acaoTexto, fontVariant: ['tabular-nums'] },
    passos: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, textAlign: 'center' },
    aviso: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'flex-start',
      padding: 12,
      borderRadius: t.raio.normal,
      borderWidth: 1,
      borderColor: t.cores.erro,
      backgroundColor: t.cores.superficie,
    },
    textoAviso: { flex: 1, fontSize: t.fontes.tamanho.normal, color: t.cores.texto },
    aguardando: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
    nota: { flex: 1, fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
  });
