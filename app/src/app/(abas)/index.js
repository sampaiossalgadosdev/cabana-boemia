import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLojas } from '../../estado/Lojas.js';
import { useCarrinho } from '../../estado/Carrinho.js';
import { AvisosNaTela } from '../../estado/Avisos.js';
import { FaixaSemConexao } from '../../componentes/Faixas.js';
import { TelaSemInternet } from '../../componentes/TelaSemInternet.js';
import { LogoLoja } from '../../componentes/Loja.js';
import { CarrosselAnuncios } from '../../componentes/Anuncios.js';
import { filtrarLojas, situacaoDaLoja } from '../../logica/lojas.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import { rotuloItens } from '../../logica/sacola.js';
import { useEstilos, useTema } from '../../tema/tema.js';

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const textoListaSalva = (salvoEm) => `Mostrando a lista das ${hora.format(new Date(salvoEm))}.`;

function CartaoLoja({ loja }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const situacao = situacaoDaLoja(loja);
  return (
    <Pressable
      onPress={() => router.push(`/loja/${loja.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={`${loja.nome}, ${situacao}`}
      style={({ pressed }) => [s.cartao, pressed && s.pressionado]}
    >
      <LogoLoja nome={loja.nome} logoUrl={loja.logoUrl} cor={loja.corPrimaria ?? undefined} tamanho={60} />
      <View style={s.textos}>
        <Text style={s.nome} numberOfLines={1}>
          {loja.nome}
        </Text>
        {loja.descricao ? (
          <Text style={s.descricao} numberOfLines={2}>
            {loja.descricao}
          </Text>
        ) : null}
        <View style={s.linha}>
          <View style={[s.bolinha, loja.aberta ? s.aberta : s.fechada]} />
          <Text style={[s.situacao, loja.aberta && s.situacaoAberta]} numberOfLines={1}>
            {situacao}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={tema.cores.textoSuave} />
    </Pressable>
  );
}

/** Sacola de alguma loja (fora da página dela): volta para a loja. */
function BarraSacolaDaLoja() {
  const s = useEstilos(criarEstilos);
  const { loja, totalItens, totalCentavos } = useCarrinho();
  if (!loja || !totalItens) return null;
  return (
    <Pressable onPress={() => router.push(`/loja/${loja.slug}`)} accessibilityRole="button" style={s.sacola}>
      <View style={{ flex: 1 }}>
        <Text style={s.sacolaLoja} numberOfLines={1}>{`Sua sacola em ${loja.nome}`}</Text>
        <Text style={s.sacolaResumo}>{`${formatarPreco(totalCentavos)} / ${rotuloItens(totalItens)}`}</Text>
      </View>
      <Text style={s.sacolaAcao}>Ver loja</Text>
    </Pressable>
  );
}

/** Início: as lojas do Taaki Delivery (logo, nome, aberta/fechada, próxima abertura), com busca. */
export default function Vitrine() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { top } = useSafeAreaInsets();
  const { lojas, semConexao, salvoEm, buscando, recarregar } = useLojas();
  const [busca, setBusca] = useState('');
  const [puxou, setPuxou] = useState(false);
  const anuncios = useRef(null);
  const visiveis = useMemo(() => filtrarLojas(lojas, busca), [lojas, busca]);

  const topo = (
    <View style={[s.topo, { paddingTop: top + 12 }]}>
      <Text style={s.titulo} accessibilityRole="header">
        Taaki Delivery
      </Text>
      <View style={s.busca}>
        <Ionicons name="search" size={18} color={tema.cores.textoSuave} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar loja"
          placeholderTextColor={tema.cores.textoDesabilitado}
          style={s.buscaCampo}
          returnKeyType="search"
          accessibilityLabel="Buscar loja"
        />
        {busca ? (
          <Pressable onPress={() => setBusca('')} accessibilityRole="button" accessibilityLabel="Limpar busca" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={tema.cores.textoSuave} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (!lojas) {
    return (
      <View style={s.tela}>
        {topo}
        {semConexao ? (
          <TelaSemInternet onTentarDeNovo={recarregar} tentando={buscando} />
        ) : (
          <ActivityIndicator style={{ marginTop: 32 }} size="large" color={tema.cores.acao} accessibilityLabel="Carregando lojas" />
        )}
      </View>
    );
  }

  return (
    <View style={s.tela}>
      {topo}
      <FlatList
        data={visiveis}
        keyExtractor={(l) => l.slug}
        contentContainerStyle={s.lista}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={puxou && buscando}
            onRefresh={() => {
              setPuxou(true);
              recarregar();
              anuncios.current?.recarregar();
            }}
          />
        }
        ListHeaderComponent={
          <>
            {semConexao ? <FaixaSemConexao salvoEm={salvoEm} podePedir textoSalvo={textoListaSalva} /> : null}
            {/* Some durante a busca (a lista filtrada fica no topo); continua montado para não buscar de novo. */}
            <View style={busca ? { display: 'none' } : null}>
              <CarrosselAnuncios ref={anuncios} />
            </View>
          </>
        }
        ListEmptyComponent={
          <Text style={s.vazio}>{busca ? `Nenhuma loja encontrada para "${busca}".` : 'Nenhuma loja disponível no momento.'}</Text>
        }
        renderItem={({ item }) => <CartaoLoja loja={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
      <BarraSacolaDaLoja />
      <AvisosNaTela distanciaDoFim={80} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    topo: { backgroundColor: t.cores.cabecalho, paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
    titulo: { color: t.cores.textoInverso, fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado },
    busca: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.cores.superficie,
      borderRadius: t.raio.pilula,
      paddingHorizontal: 14,
    },
    buscaCampo: { flex: 1, paddingVertical: 10, fontSize: t.fontes.tamanho.normal, color: t.cores.texto },
    lista: { padding: 16, paddingBottom: 32 },
    cartao: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: t.raio.normal,
      backgroundColor: t.cores.superficie,
      borderWidth: 1,
      borderColor: t.cores.borda,
    },
    pressionado: { opacity: 0.85 },
    textos: { flex: 1, gap: 2 },
    nome: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    descricao: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    linha: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    bolinha: { width: 8, height: 8, borderRadius: 4 },
    aberta: { backgroundColor: t.cores.sucesso },
    fechada: { backgroundColor: t.cores.textoDesabilitado },
    situacao: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, flexShrink: 1 },
    situacaoAberta: { color: t.cores.sucesso, fontWeight: t.fontes.peso.forte },
    vazio: { marginTop: 32, textAlign: 'center', color: t.cores.textoSuave, fontSize: t.fontes.tamanho.normal },
    sacola: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: t.cores.superficie,
      borderTopWidth: 1,
      borderTopColor: t.cores.borda,
    },
    sacolaLoja: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    sacolaResumo: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    sacolaAcao: { color: t.cores.acao, fontWeight: t.fontes.peso.forte, fontSize: t.fontes.tamanho.normal },
  });
