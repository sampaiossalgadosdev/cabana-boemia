import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useIsFocused } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCarrinho } from '../../estado/Carrinho.js';
import { useCardapio } from '../../estado/Cardapio.js';
import { AvisosNaTela, useAvisos } from '../../estado/Avisos.js';
import { useCliente } from '../../estado/Cliente.js';
import * as api from '../../lib/api.js';
import { subtotal } from '../../logica/carrinho.js';
import {
  enderecoDaTaxa,
  limiteDaLinha,
  produtosDoCardapio,
  resumoDaSacola,
  rotuloItens,
  sugestoes as listarSugestoes,
} from '../../logica/sacola.js';
import { formatarPreco } from '../../logica/dinheiro.js';
import { quandoAbre } from '../../logica/horario.js';
import { Botao, ImagemProduto, Quantidade } from '../../componentes/basicos.js';
import { LinhaFreteGratis } from '../../componentes/BarraSacola.js';
import { useEstilos, useTema } from '../../tema/tema.js';
import { LogoLoja } from '../../componentes/Loja.js';
import { taxaNaLoja } from '../../logica/lojas.js';

function ItemSacola({ item, produto, limite, onEditar, onMudar, onRemover }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const noLimite = item.quantidade >= limite;
  const detalhe = item.observacao || produto?.descricao || '';
  return (
    <View style={s.item}>
      <Pressable onPress={onEditar} accessibilityRole="button" accessibilityLabel={`Editar ${item.nome}`} style={s.miniatura}>
        <ImagemProduto url={produto?.imagemUrl} estilo={s.miniaturaFoto} tamanhoIcone={22} />
        <View style={s.lapis}>
          <Ionicons name="pencil" size={12} color={tema.cores.textoAcao} />
        </View>
      </Pressable>
      <View style={s.itemInfo}>
        <Text style={s.itemNome} numberOfLines={2}>
          {item.nome}
        </Text>
        {detalhe ? (
          <Text style={[s.itemDetalhe, item.observacao && s.itemObs]} numberOfLines={2}>
            {detalhe}
          </Text>
        ) : null}
        <Text style={s.itemPreco}>{formatarPreco(subtotal(item))}</Text>
      </View>
      <View style={s.itemLado}>
        {item.quantidade === 1 ? (
          <View style={s.qtdComLixeira}>
            <Pressable onPress={onRemover} accessibilityRole="button" accessibilityLabel={`Remover ${item.nome}`} hitSlop={8} style={s.lixeira}>
              <Ionicons name="trash-outline" size={18} color={tema.cores.acao} />
            </Pressable>
            <Text style={s.qtdUm}>1</Text>
            <Pressable
              onPress={() => onMudar(2)}
              disabled={noLimite}
              accessibilityRole="button"
              accessibilityLabel="Aumentar"
              hitSlop={8}
              style={s.lixeira}
            >
              <Ionicons name="add" size={18} color={noLimite ? tema.cores.textoDesabilitado : tema.cores.acao} />
            </Pressable>
          </View>
        ) : (
          <Quantidade valor={item.quantidade} maximo={limite} onMudar={onMudar} compacto rotulo={`Quantidade de ${item.nome}`} />
        )}
        {noLimite && limite > 0 && <Text style={s.max}>Máx. disponível</Text>}
      </View>
    </View>
  );
}

/**
 * Taxa DESTA LOJA para o endereço principal (logado), pela área de entrega
 * dela; null se ainda não dá para saber ou se ela não entrega lá (o checkout explica).
 */
function useTaxaDoCliente(emFoco, slug) {
  const { status, chamar } = useCliente();
  const [taxa, setTaxa] = useState(null);
  useEffect(() => {
    if (status !== 'logado' || !slug) {
      setTaxa(null);
      return undefined;
    }
    if (!emFoco) return undefined;
    let vivo = true;
    Promise.all([chamar((token) => api.listarEnderecos(token)), api.buscarBairrosDaLoja(slug)])
      .then(([{ enderecos }, { bairros }]) => vivo && setTaxa(taxaNaLoja(enderecoDaTaxa(enderecos), bairros)))
      .catch(() => vivo && setTaxa(null));
    return () => {
      vivo = false;
    };
  }, [status, chamar, emFoco, slug]);
  return taxa;
}

function CartaoSugestao({ produto, adicionado, onAdicionar }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  return (
    <View style={s.sugestao}>
      <View>
        <ImagemProduto url={produto.imagemUrl} estilo={s.sugestaoFoto} tamanhoIcone={24} />
        <Pressable
          onPress={() => onAdicionar(produto)}
          disabled={adicionado}
          accessibilityRole="button"
          accessibilityLabel={adicionado ? `${produto.nome} adicionado` : `Adicionar ${produto.nome}`}
          style={[s.sugestaoMais, adicionado && s.sugestaoOk]}
          hitSlop={6}
        >
          <Ionicons name={adicionado ? 'checkmark' : 'add'} size={18} color={adicionado ? tema.cores.textoAcao : tema.cores.acao} />
        </Pressable>
      </View>
      <Text style={s.sugestaoPreco}>{formatarPreco(produto.precoCentavos)}</Text>
      <Text style={s.sugestaoNome} numberOfLines={2}>
        {produto.nome}
      </Text>
    </View>
  );
}

/**
 * Sacola: itens (lápis edita no modal do produto), "Peça também", resumo e
 * "Continuar" (abre o checkout no mesmo modal). Valores são prévia: a API
 * recalcula no envio. Sem login (ou sem endereço) a taxa fica "Calculada no
 * próximo passo"; logado, é a do bairro do endereço principal.
 */
export default function TelaSacola() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom } = useSafeAreaInsets();
  const emFoco = useIsFocused();
  const { itens, totalItens, adicionar, editar, remover, substituir, carregado } = useCarrinho();
  const { dados, podePedir, slug, loja } = useCardapio();
  const { avisar } = useAvisos();
  const [recem, setRecem] = useState(() => new Set());

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Sacola esvaziou (último item removido, "Limpar", conciliação): fecha.
  useEffect(() => {
    if (emFoco && carregado && itens.length === 0) fechar();
  }, [emFoco, carregado, itens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const produtos = useMemo(() => produtosDoCardapio(dados?.categorias), [dados]);
  const freteGratis = dados?.freteGratis ?? null;
  const taxaBairro = useTaxaDoCliente(emFoco, slug);
  const resumo = resumoDaSacola(itens, { taxaBairroCentavos: taxaBairro, freteGratis });
  const listaSugestoes = podePedir ? listarSugestoes(dados, itens, recem) : [];

  const limpar = () =>
    Alert.alert('Limpar sacola', 'Remover todos os itens da sacola?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover tudo', style: 'destructive', onPress: () => substituir([]) },
    ]);

  const adicionarSugestao = (produto) => {
    adicionar(produto, 1, '', { slug, nome: loja?.nome || slug });
    avisar(`${produto.nome} foi para a sacola`);
    setRecem((r) => new Set(r).add(produto.id));
    setTimeout(
      () =>
        setRecem((r) => {
          const n = new Set(r);
          n.delete(produto.id);
          return n;
        }),
      1200,
    );
  };

  const fechado = dados ? !dados.aberto : false;
  return (
    <View style={s.tela}>
      <Stack.Screen
        options={{
          title: 'Sacola',
          headerLeft: () => (
            <Pressable onPress={fechar} accessibilityRole="button" accessibilityLabel="Fechar sacola" hitSlop={10}>
              <Ionicons name="chevron-down" size={26} color={tema.cores.textoInverso} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={limpar} accessibilityRole="button" hitSlop={10}>
              <Text style={s.limpar}>Limpar</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={s.conteudo}>
        <View style={s.restaurante}>
          <LogoLoja nome={tema.nome} logoUrl={loja?.logoUrl} tamanho={52} />
          <View>
            <Text style={s.restauranteNome}>{tema.nome}</Text>
            <Pressable onPress={fechar} accessibilityRole="button" hitSlop={6}>
              <Text style={s.link}>Adicionar mais itens</Text>
            </Pressable>
          </View>
        </View>

        <Text style={s.secao} accessibilityRole="header">
          Itens adicionados
        </Text>
        <View style={s.bloco}>
          {itens.map((item, i) => (
            <View key={item.id}>
              {i > 0 && <View style={s.divisoria} />}
              <ItemSacola
                item={item}
                produto={produtos.get(item.produtoId)}
                limite={limiteDaLinha(item, itens, produtos.get(item.produtoId))}
                onEditar={() => router.push({ pathname: '/produto', params: { id: item.produtoId, linha: item.id } })}
                onMudar={(quantidade) => editar(item.id, { quantidade, observacao: item.observacao })}
                onRemover={() => remover(item.id)}
              />
            </View>
          ))}
        </View>

        {listaSugestoes.length > 0 && (
          <>
            <Text style={s.secao} accessibilityRole="header">
              Peça também
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sugestoes}>
              {listaSugestoes.map((p) => (
                <CartaoSugestao key={p.id} produto={p} adicionado={recem.has(p.id)} onAdicionar={adicionarSugestao} />
              ))}
            </ScrollView>
          </>
        )}

        <Text style={s.secao} accessibilityRole="header">
          Resumo de valores
        </Text>
        <View style={[s.bloco, s.resumo]}>
          {resumo.progresso && !resumo.progresso.atingido && (
            <LinhaFreteGratis subtotalCentavos={resumo.subtotalCentavos} freteGratis={freteGratis} />
          )}
          <View style={s.linhaResumo}>
            <Text style={s.resumoRotulo}>Total dos itens</Text>
            <Text style={s.resumoValor}>{formatarPreco(resumo.subtotalCentavos)}</Text>
          </View>
          <View style={s.linhaResumo}>
            <Text style={s.resumoRotulo}>Taxa de entrega</Text>
            <Text style={[s.resumoValor, resumo.gratis ? s.gratis : resumo.taxaEntregaCentavos == null && s.depois]}>
              {resumo.gratis
                ? 'Grátis'
                : resumo.taxaEntregaCentavos == null
                  ? 'Calculada no próximo passo'
                  : formatarPreco(resumo.taxaEntregaCentavos)}
            </Text>
          </View>
          <View style={[s.linhaResumo, s.linhaTotal]}>
            <Text style={s.totalRotulo}>Total</Text>
            <Text style={s.totalValor}>{formatarPreco(resumo.totalCentavos)}</Text>
          </View>
          <Text style={s.nota}>Valores de prévia: o total final é conferido ao enviar o pedido.</Text>
        </View>
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: bottom + 12 }]}>
        <View style={s.rodapeTotal}>
          <Text style={s.rodapeRotulo}>{resumo.rotuloTotal}</Text>
          <Text style={s.rodapeValor}>
            {formatarPreco(resumo.totalCentavos)}
            <Text style={s.rodapeItens}> / {rotuloItens(totalItens)}</Text>
          </Text>
        </View>
        <View style={s.rodapeAcao}>
          <Botao titulo="Continuar" desabilitado={!podePedir} onPress={() => router.push('/sacola/checkout')} />
          <Text style={s.rodapeNota} numberOfLines={2}>
            {fechado
              ? `Fechado no momento${dados?.proximaAbertura ? ` · abre ${quandoAbre(dados.proximaAbertura.em)}` : ''}`
              : !podePedir
                ? 'Conecte-se à internet para pedir'
                : ''}
          </Text>
        </View>
      </View>
      <AvisosNaTela distanciaDoFim={bottom + 100} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { padding: 16, paddingBottom: 32 },
    limpar: {
      color: t.cores.textoInverso,
      fontWeight: t.fontes.peso.forte,
      fontSize: t.fontes.tamanho.normal,
      paddingHorizontal: 8,
    },
    restaurante: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
    logoFundo: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: t.cores.superficie,
      borderWidth: 1,
      borderColor: t.cores.borda,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logo: { width: 46, height: 30 },
    restauranteNome: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    link: { color: t.cores.acao, fontWeight: t.fontes.peso.medio, fontSize: t.fontes.tamanho.normal, marginTop: 2 },
    secao: {
      fontSize: t.fontes.tamanho.medio,
      fontWeight: t.fontes.peso.pesado,
      color: t.cores.texto,
      marginTop: 20,
      marginBottom: 8,
    },
    bloco: { backgroundColor: t.cores.superficie, borderRadius: t.raio.normal, borderWidth: 1, borderColor: t.cores.borda },
    divisoria: { height: 1, backgroundColor: t.cores.borda, marginLeft: 12 },
    item: { flexDirection: 'row', padding: 12, gap: 12, alignItems: 'center' },
    miniatura: { width: 60, height: 60 },
    miniaturaFoto: { width: 60, height: 60, borderRadius: t.raio.pequeno },
    lapis: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: t.cores.acao,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: t.cores.superficie,
    },
    itemInfo: { flex: 1, gap: 2 },
    itemNome: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    itemDetalhe: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    itemObs: { fontStyle: 'italic' },
    itemPreco: { fontSize: t.fontes.tamanho.normal, color: t.cores.preco, fontWeight: t.fontes.peso.forte, marginTop: 2 },
    itemLado: { alignItems: 'center', gap: 4 },
    qtdComLixeira: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pilula,
    },
    lixeira: { padding: 10 },
    qtdUm: { minWidth: 22, textAlign: 'center', fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    max: { fontSize: 11, color: t.cores.aviso, fontWeight: t.fontes.peso.medio },
    sugestoes: { gap: 12, paddingRight: 16 },
    sugestao: { width: 112 },
    sugestaoFoto: { width: 112, height: 112, borderRadius: t.raio.pequeno },
    sugestaoMais: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: t.cores.superficie,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 2,
      shadowColor: t.cores.sombra,
      shadowOpacity: 0.15,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    sugestaoOk: { backgroundColor: t.cores.sucesso },
    sugestaoPreco: { marginTop: 6, fontWeight: t.fontes.peso.forte, color: t.cores.texto, fontSize: t.fontes.tamanho.normal },
    sugestaoNome: { color: t.cores.textoSuave, fontSize: t.fontes.tamanho.pequeno },
    resumo: { padding: 12, gap: 10 },
    linhaResumo: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    resumoRotulo: { color: t.cores.textoSuave, fontSize: t.fontes.tamanho.normal },
    resumoValor: { color: t.cores.texto, fontSize: t.fontes.tamanho.normal, flexShrink: 1, textAlign: 'right' },
    gratis: { color: t.cores.sucesso, fontWeight: t.fontes.peso.forte },
    depois: { color: t.cores.textoSuave, fontStyle: 'italic' },
    linhaTotal: { borderTopWidth: 1, borderTopColor: t.cores.borda, paddingTop: 10 },
    totalRotulo: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    totalValor: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
    nota: { fontSize: 12, color: t.cores.textoSuave },
    rodape: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 12,
      backgroundColor: t.cores.superficie,
      borderTopWidth: 1,
      borderTopColor: t.cores.borda,
    },
    rodapeTotal: { flexShrink: 1 },
    rodapeRotulo: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    rodapeValor: { fontSize: t.fontes.tamanho.grande, fontWeight: t.fontes.peso.pesado, color: t.cores.texto },
    rodapeItens: { fontSize: t.fontes.tamanho.normal, fontWeight: t.fontes.peso.normal, color: t.cores.textoSuave },
    rodapeAcao: { alignItems: 'flex-end', maxWidth: 190, gap: 4 },
    rodapeNota: { fontSize: 12, color: t.cores.textoSuave, textAlign: 'right' },
  });
