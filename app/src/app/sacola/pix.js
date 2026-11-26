import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCliente } from '../../estado/Cliente.js';
import { useCarrinho } from '../../estado/Carrinho.js';
import { useUltimoPedido } from '../../estado/UltimoPedido.js';
import * as api from '../../lib/api.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import {
  INTERVALO_CONSULTA_MS,
  MENSAGEM_PAGO_TARDE,
  MENSAGEM_PIX_EXPIRADO,
  apagarPixPendente,
  estadoDoPix,
  lerPixPendente,
  tempoRestante,
} from '../../logica/pagamento.js';
import { Botao } from '../../componentes/basicos.js';
import { TextoErro } from '../../componentes/formulario.js';
import { useEstilos, useTema } from '../../tema/tema.js';

/** Copia para a área de transferência (módulo nativo carregado só aqui). */
async function copiar(texto) {
  const Clipboard = require('expo-clipboard');
  await Clipboard.setStringAsync(texto);
}

/**
 * Pagar com Pix (Etapa 4 do pagamento online): QR code, "Copiar código Pix", contagem de 15
 * minutos e a consulta da NOSSA API a cada 5 s (nunca o Mercado Pago direto). Aprovado: a sacola
 * esvazia e vai para "Pedido nº N recebido". Expirado: avisa e volta para a sacola, que continua
 * guardada. O Pix pendente fica no aparelho: fechar e reabrir o app volta para esta tela.
 */
export default function TelaPix() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom } = useSafeAreaInsets();
  const { chamar } = useCliente();
  const { substituir } = useCarrinho();
  const { setPedidoEnviado, recarregar: recarregarUltimo } = useUltimoPedido();
  const navegacao = useNavigation();
  const [pix, setPix] = useState(null); // o guardado no aparelho
  const [estado, setEstado] = useState('carregando'); // carregando | aguardando | aprovado | expirado | pago_tarde | sem_pix
  const [agora, setAgora] = useState(Date.now());
  const [copiado, setCopiado] = useState(false);
  const [erroRede, setErroRede] = useState('');
  const resolvido = useRef(false);

  useEffect(() => {
    lerPixPendente().then((dados) => {
      setPix(dados);
      setEstado(dados ? 'aguardando' : 'sem_pix');
    });
  }, []);

  const terminar = useCallback(
    async (r) => {
      const novo = estadoDoPix(r.pagamento);
      if (novo === 'aguardando' || resolvido.current) return;
      resolvido.current = true;
      await apagarPixPendente();
      if (novo === 'aprovado') {
        // Pago: o pedido foi para a loja (com número). Agora a sacola esvazia.
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
    if (!pix || resolvido.current) return;
    try {
      const r = await chamar((token) => api.situacaoDoPagamento(token, pix.pedidoId));
      setErroRede('');
      await terminar(r);
    } catch (e) {
      if (e?.status === 404) {
        // O pedido não existe mais para esta conta: nada a retomar.
        resolvido.current = true;
        await apagarPixPendente();
        setEstado('sem_pix');
        return;
      }
      setErroRede(e?.status ? e.message : 'Sem conexão. Continuamos tentando…');
    }
  }, [pix, chamar, terminar]);

  // Consulta a cada 5 s, o relógio a cada 1 s e uma consulta ao voltar para o app.
  useEffect(() => {
    if (estado !== 'aguardando') return undefined;
    consultar();
    const consulta = setInterval(consultar, INTERVALO_CONSULTA_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    const app = AppState.addEventListener('change', (e) => e === 'active' && consultar());
    return () => {
      clearInterval(consulta);
      clearInterval(relogio);
      app.remove();
    };
  }, [estado, consultar]);

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

  if (estado === 'sem_pix') {
    return (
      <View style={[s.tela, s.centro, s.conteudo]}>
        <Text style={s.texto}>Nenhum Pix aguardando pagamento.</Text>
        <Botao titulo="Voltar à sacola" onPress={voltarParaSacola} estilo={{ marginTop: 16 }} />
      </View>
    );
  }

  if (estado === 'expirado' || estado === 'pago_tarde') {
    return (
      <View style={[s.tela, s.centro, s.conteudo]}>
        <Ionicons name="time-outline" size={48} color={tema.cores.erro} />
        <Text style={s.titulo} accessibilityRole="header">
          {estado === 'pago_tarde' ? 'Pagamento fora do prazo' : 'O Pix expirou'}
        </Text>
        <Text style={s.texto}>{estado === 'pago_tarde' ? MENSAGEM_PAGO_TARDE : MENSAGEM_PIX_EXPIRADO}</Text>
        <Botao titulo="Voltar à sacola" onPress={voltarParaSacola} bloco estilo={{ marginTop: 20 }} />
      </View>
    );
  }

  const tempo = tempoRestante(pix.expiraEm, agora);
  return (
    <ScrollView style={s.tela} contentContainerStyle={[s.conteudo, { paddingBottom: bottom + 24 }]}>
      <Text style={s.titulo} accessibilityRole="header">Pague com Pix</Text>
      {pix.loja?.nome ? <Text style={s.texto}>{`Pedido em ${pix.loja.nome}`}</Text> : null}
      <Text style={s.valor}>{formatarPreco(pix.valorCentavos)}</Text>

      <View style={s.cartaoTempo} accessibilityLiveRegion="polite">
        <Text style={s.rotulo}>{tempo.acabou ? 'Prazo encerrado. Conferindo o pagamento…' : 'Pague em até'}</Text>
        {!tempo.acabou && <Text style={s.tempo} accessibilityLabel={`${Math.floor(tempo.segundos / 60)} minutos e ${tempo.segundos % 60} segundos`}>{tempo.texto}</Text>}
      </View>

      {pix.qrCodeBase64 ? (
        <Image
          source={{ uri: `data:image/png;base64,${pix.qrCodeBase64}` }}
          style={s.qr}
          resizeMode="contain"
          accessibilityLabel="QR code do Pix"
        />
      ) : null}

      <Text style={s.passos}>No app do seu banco, escolha Pix › Pagar com QR code, ou copie o código abaixo e use o Pix copia e cola.</Text>
      <Text style={s.codigo} numberOfLines={3} selectable>
        {pix.qrCode}
      </Text>
      <Botao
        titulo={copiado ? 'Código copiado' : 'Copiar código Pix'}
        onPress={async () => {
          await copiar(pix.qrCode);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 3000);
        }}
        bloco
        estilo={{ marginTop: 12 }}
      />

      <View style={s.aguardando}>
        <ActivityIndicator color={tema.cores.acao} />
        <Text style={s.nota}>Aguardando o pagamento. O pedido vai para a loja assim que o Pix for aprovado.</Text>
      </View>
      <TextoErro>{erroRede}</TextoErro>

      <Botao
        titulo="Fechar e voltar depois"
        variante="texto"
        onPress={fecharTudo}
        bloco
        estilo={{ marginTop: 8 }}
        rotuloAcessivel="Fechar esta tela. O Pix continua valendo até o fim do prazo; ao abrir o app de novo, esta tela volta."
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
    qr: { width: 240, height: 240, alignSelf: 'center', marginVertical: 8, backgroundColor: '#FFFFFF' },
    passos: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, textAlign: 'center' },
    codigo: {
      fontSize: t.fontes.tamanho.pequeno,
      color: t.cores.texto,
      padding: 10,
      borderRadius: t.raio.pequeno,
      borderWidth: 1,
      borderColor: t.cores.borda,
      backgroundColor: t.cores.superficie,
    },
    aguardando: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
    nota: { flex: 1, fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
  });
