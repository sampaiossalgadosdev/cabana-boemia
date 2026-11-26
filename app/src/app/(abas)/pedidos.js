import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCliente } from '../../estado/Cliente.js';
import { useUltimoPedido } from '../../estado/UltimoPedido.js';
import { AvisosNaTela } from '../../estado/Avisos.js';
import * as api from '../../lib/api.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import { dataDoPedido, resumoItens, rotuloPagamento } from '../../logica/pedido.js';
import { Botao } from '../../componentes/basicos.js';
import { EntrarCom } from '../../componentes/EntrarCom.js';
import { TextoErro } from '../../componentes/formulario.js';
import { TopoAba } from '../../componentes/TopoAba.js';
import { BarraSacola } from '../../componentes/BarraSacola.js';
import { TelaSemInternet } from '../../componentes/TelaSemInternet.js';
import { useEstilos, useTema } from '../../tema/tema.js';
import { LogoLoja } from '../../componentes/Loja.js';
import { LOJA_DA_SACOLA_ANTIGA } from '../../logica/lojas.js';
import { avisoDoPedidoOnline, mensagemDoCancelamento } from '../../logica/pagamento.js';

const ERRO_GENERICO = 'Não foi possível carregar seus pedidos. Confira sua conexão e tente de novo.';

function CartaoPedido({ pedido, onRepetir, onCancelar }) {
  const s = useEstilos(criarEstilos);
  const cancelado = pedido.status === 'CANCELADO';
  const loja = pedido.loja ?? LOJA_DA_SACOLA_ANTIGA;
  // Pago online (Etapa 5): aguardando a loja aceitar, ou estornado (para onde o dinheiro volta).
  const aviso = avisoDoPedidoOnline(pedido, formatarPreco);
  const [cancelando, setCancelando] = useState(false);
  const [erroCancelar, setErroCancelar] = useState('');

  const pedirCancelamento = () =>
    Alert.alert('Cancelar pedido?', `A loja ainda não aceitou o pedido nº ${pedido.numeroDia}. O valor pago volta para você pelo Mercado Pago.`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: async () => {
          setCancelando(true);
          setErroCancelar('');
          try {
            await onCancelar(pedido);
          } catch (e) {
            setErroCancelar(mensagemDoCancelamento(e));
          } finally {
            setCancelando(false);
          }
        },
      },
    ]);
  return (
    <View style={[s.cartao, cancelado && s.cancelado]}>
      <View style={s.lojaLinha}>
        <LogoLoja nome={loja.nome} logoUrl={loja.logoUrl} tamanho={32} />
        <Text style={s.lojaNome} numberOfLines={1}>
          {loja.nome}
        </Text>
      </View>
      <View style={s.topoCartao}>
        <Text style={s.numero}>{`Pedido nº ${pedido.numeroDia}`}</Text>
        <Text style={s.data}>{dataDoPedido(pedido.criadoEm)}</Text>
      </View>
      <Text style={s.itens}>{resumoItens(pedido.itens)}</Text>
      {aviso && <Text style={aviso.tipo === 'estorno' ? s.avisoEstorno : s.avisoAguardando}>{aviso.texto}</Text>}
      {pedido.podeCancelar && (
        <Botao titulo={cancelando ? 'Cancelando…' : 'Cancelar pedido'} variante="texto" carregando={cancelando} onPress={pedirCancelamento} />
      )}
      <TextoErro>{erroCancelar}</TextoErro>
      <View style={s.rodapeCartao}>
        <View style={{ flex: 1 }}>
          <Text style={s.total}>{formatarPreco(pedido.totalCentavos)}</Text>
          <View style={s.linha}>
            <Text style={s.pagamento}>
              {pedido.formaPagamento ? rotuloPagamento(pedido.formaPagamento) : ''}
              {pedido.pagamentoOnline ? ' · pago pelo app' : ''}
            </Text>
            {cancelado && <Text style={s.selo}>Cancelado</Text>}
          </View>
        </View>
        <Botao titulo="Repetir pedido" variante="secundario" desabilitado={pedido.itens.length === 0} onPress={() => onRepetir(pedido)} />
      </View>
    </View>
  );
}

/**
 * Aba Pedidos (como TelaPedidos.jsx do site): histórico do cliente, mais novo
 * primeiro, 20 por vez ("Ver pedidos mais antigos"), de TODAS as lojas, cada
 * um com a loja. "Repetir pedido" abre a loja do pedido e repete lá (fechada:
 * avisa; sacola de outra loja: pergunta se pode esvaziar).
 */
export default function Pedidos() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { status, chamar, tentarDeNovo } = useCliente();
  const { repetir } = useUltimoPedido();
  const [pedidos, setPedidos] = useState(null);
  const [proximo, setProximo] = useState(null);
  const [erro, setErro] = useState('');
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(
    async (antesDeId) => {
      setErro('');
      try {
        const r = await chamar((token) => api.listarPedidos(token, antesDeId));
        setPedidos((atual) => (antesDeId ? [...(atual ?? []), ...r.pedidos] : r.pedidos));
        setProximo(r.proximo);
      } catch (e) {
        if (e?.status !== 401) setErro(ERRO_GENERICO);
      }
    },
    [chamar],
  );

  /** Cancela pelo app (só pago online sem aceite) e troca o pedido na lista. Erro: o cartão mostra. */
  const cancelar = useCallback(
    async (pedido) => {
      const r = await chamar((token) => api.cancelarPedido(token, pedido.id));
      setPedidos((atual) => (atual ?? []).map((p) => (p.id === pedido.id ? { ...p, ...r.pedido } : p)));
    },
    [chamar],
  );

  useEffect(() => {
    if (status === 'logado') carregar();
    else setPedidos(null);
  }, [status, carregar]);

  let corpo;
  if (status === 'carregando') {
    corpo = <ActivityIndicator style={{ marginTop: 32 }} color={tema.cores.acao} />;
  } else if (status === 'erro') {
    corpo = <TelaSemInternet onTentarDeNovo={tentarDeNovo} />;
  } else if (status !== 'logado') {
    corpo = (
      <ScrollView contentContainerStyle={s.conteudo}>
        <EntrarCom marca titulo="Entre para ver seus pedidos" texto="Com sua conta você vê os pedidos que já fez e repete qualquer um com um toque." />
      </ScrollView>
    );
  } else if (pedidos === null) {
    corpo = erro ? (
      <View style={s.conteudo}>
        <TextoErro>{erro}</TextoErro>
        <Botao titulo="Tentar de novo" variante="secundario" onPress={() => carregar()} estilo={{ marginTop: 12 }} />
      </View>
    ) : (
      <ActivityIndicator style={{ marginTop: 32 }} color={tema.cores.acao} accessibilityLabel="Carregando seus pedidos" />
    );
  } else {
    corpo = (
      <FlatList
        data={pedidos}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={s.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={async () => {
              setAtualizando(true);
              await carregar();
              setAtualizando(false);
            }}
          />
        }
        ListEmptyComponent={<Text style={s.vazio}>Você ainda não fez nenhum pedido.</Text>}
        renderItem={({ item }) => <CartaoPedido pedido={item} onRepetir={repetir} onCancelar={cancelar} />}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListFooterComponent={
          <View style={{ paddingBottom: 24 }}>
            <TextoErro>{erro}</TextoErro>
            {proximo ? (
              <Botao
                titulo={carregandoMais ? 'Carregando…' : 'Ver pedidos mais antigos'}
                variante="texto"
                carregando={carregandoMais}
                onPress={async () => {
                  setCarregandoMais(true);
                  await carregar(proximo);
                  setCarregandoMais(false);
                }}
                bloco
                estilo={{ marginTop: 12 }}
              />
            ) : null}
          </View>
        }
      />
    );
  }

  return (
    <View style={s.tela}>
      <TopoAba titulo="Pedidos" />
      <View style={{ flex: 1 }}>{corpo}</View>
      <BarraSacola />
      <AvisosNaTela distanciaDoFim={90} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { padding: 16 },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginBottom: 12 },
    vazio: { textAlign: 'center', color: t.cores.textoSuave, padding: 32, fontSize: t.fontes.tamanho.normal },
    cartao: { backgroundColor: t.cores.superficie, borderRadius: t.raio.normal, borderWidth: 1, borderColor: t.cores.borda, padding: 14, gap: 8 },
    cancelado: { opacity: 0.75 },
    topoCartao: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    lojaLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    lojaNome: { flex: 1, fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    numero: { fontWeight: t.fontes.peso.forte, color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    data: { color: t.cores.textoSuave, fontSize: t.fontes.tamanho.pequeno },
    itens: { color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    rodapeCartao: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    total: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.preco },
    linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pagamento: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    avisoAguardando: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.acaoTexto, fontWeight: t.fontes.peso.forte },
    avisoEstorno: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.texto, backgroundColor: t.cores.avisoFundo, padding: 8, borderRadius: t.raio.pequeno, overflow: 'hidden' },
    selo: {
      fontSize: 11,
      fontWeight: t.fontes.peso.forte,
      color: t.cores.erro,
      backgroundColor: t.cores.avisoFundo,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: t.raio.pequeno,
      overflow: 'hidden',
    },
  });
