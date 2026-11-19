import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCliente } from '../../estado/Cliente.js';
import { useCardapio } from '../../estado/Cardapio.js';
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

const ERRO_GENERICO = 'Não foi possível carregar seus pedidos. Confira sua conexão e tente de novo.';

function CartaoPedido({ pedido, podeRepetir, onRepetir }) {
  const s = useEstilos(criarEstilos);
  const cancelado = pedido.status === 'CANCELADO';
  return (
    <View style={[s.cartao, cancelado && s.cancelado]}>
      <View style={s.topoCartao}>
        <Text style={s.numero}>{`Pedido nº ${pedido.numeroDia}`}</Text>
        <Text style={s.data}>{dataDoPedido(pedido.criadoEm)}</Text>
      </View>
      <Text style={s.itens}>{resumoItens(pedido.itens)}</Text>
      <View style={s.rodapeCartao}>
        <View style={{ flex: 1 }}>
          <Text style={s.total}>{formatarPreco(pedido.totalCentavos)}</Text>
          <View style={s.linha}>
            <Text style={s.pagamento}>{pedido.formaPagamento ? rotuloPagamento(pedido.formaPagamento) : ''}</Text>
            {cancelado && <Text style={s.selo}>Cancelado</Text>}
          </View>
        </View>
        <Botao titulo="Repetir pedido" variante="secundario" desabilitado={!podeRepetir || pedido.itens.length === 0} onPress={() => onRepetir(pedido)} />
      </View>
    </View>
  );
}

/**
 * Aba Pedidos (como TelaPedidos.jsx do site): histórico do cliente, mais novo
 * primeiro, 20 por vez ("Ver pedidos mais antigos"), com "Repetir pedido".
 */
export default function Pedidos() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { status, chamar, tentarDeNovo } = useCliente();
  const { podePedir } = useCardapio();
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
        <EntrarCom titulo="Entre para ver seus pedidos" texto="Com sua conta você vê os pedidos que já fez e repete qualquer um com um toque." />
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
        ListHeaderComponent={
          !podePedir && pedidos.length > 0 ? <Text style={s.nota}>Estamos fechados agora: dá para repetir um pedido quando abrirmos.</Text> : null
        }
        ListEmptyComponent={<Text style={s.vazio}>Você ainda não fez nenhum pedido.</Text>}
        renderItem={({ item }) => <CartaoPedido pedido={item} podeRepetir={podePedir} onRepetir={repetir} />}
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
    numero: { fontWeight: t.fontes.peso.forte, color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    data: { color: t.cores.textoSuave, fontSize: t.fontes.tamanho.pequeno },
    itens: { color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    rodapeCartao: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    total: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.preco },
    linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pagamento: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    selo: {
      fontSize: 11,
      fontWeight: t.fontes.peso.forte,
      color: t.cores.acaoPressionada,
      backgroundColor: t.cores.avisoFundo,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: t.raio.pequeno,
      overflow: 'hidden',
    },
  });
