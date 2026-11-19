import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../estado/Cliente.js';
import { useCarrinho } from '../estado/Carrinho.js';
import { useCardapio } from '../estado/Cardapio.js';
import { useUltimoPedido } from '../estado/UltimoPedido.js';
import * as api from '../lib/api.js';
import { formatarPreco } from '../logica/dinheiro.js';
import { FORMAS_PAGAMENTO, corpoDoPedido, novaChavePedido, resumoDoPedido, textoTaxa } from '../logica/pedido.js';
import { ERRO_GENERICO, enderecoInicial, interpretarErroDoEnvio, textoEndereco, trocoDoCheckout } from '../logica/checkout.js';
import { useEstilos, useTema } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { Campo, Opcao, TextoErro, Titulo } from './formulario.js';
import { FormEndereco } from './FormEndereco.js';

/**
 * Depois do login e do telefone (como Finalizacao.jsx do site): endereço
 * (lista ou novo), confirmar dados (um toque), pagamento na entrega, resumo e
 * envio com chave de idempotência. O total aqui é prévia; vale o da API.
 */
export function Finalizacao({ onEditarTelefone }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { cliente, chamar, sair } = useCliente();
  const { itens, substituir } = useCarrinho();
  const { dados: cardapio, podePedir, recarregar: recarregarCardapio } = useCardapio();
  const { recarregar: recarregarUltimo, setPedidoEnviado } = useUltimoPedido();

  const [enderecos, setEnderecos] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [enderecoId, setEnderecoId] = useState(null);
  const [modoEndereco, setModoEndereco] = useState(null); // null | 'escolher' | 'novo'
  const [etapa, setEtapa] = useState('confirmar'); // 'confirmar' | 'pagamento'
  const [forma, setForma] = useState('');
  const [precisaTroco, setPrecisaTroco] = useState(false);
  const [trocoTexto, setTrocoTexto] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Frete grátis vigente mandado pela API num 409 PRECO_ALTERADO (antes da recarga do cardápio).
  const [freteDaApi, setFreteDaApi] = useState(null);
  const chave = useRef(novaChavePedido());
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErro('');
    Promise.all([chamar((token) => api.listarEnderecos(token)), api.buscarBairros()])
      .then(([{ enderecos: lista }, { bairros: b }]) => {
        if (!vivo) return;
        setEnderecos(lista);
        setBairros(b);
        const inicial = enderecoInicial(lista);
        setEnderecoId(inicial?.id ?? null);
        if (!inicial) setModoEndereco('novo');
      })
      .catch((e) => vivo && e?.status !== 401 && setErro(ERRO_GENERICO));
    return () => {
      vivo = false;
    };
  }, [chamar, tentativa]);

  const freteGratis = freteDaApi ? freteDaApi.valor : (cardapio?.freteGratis ?? null);
  const endereco = enderecos?.find((e) => e.id === enderecoId) ?? null;
  const resumo = useMemo(
    () => resumoDoPedido(itens, endereco?.bairro.taxaCentavos ?? 0, freteGratis),
    [itens, endereco, freteGratis],
  );
  const troco = trocoDoCheckout({ forma, precisaTroco, texto: trocoTexto, totalCentavos: resumo.totalCentavos });

  if (!enderecos) {
    return erro ? (
      <View>
        <TextoErro>{erro}</TextoErro>
        <Botao titulo="Tentar de novo" variante="secundario" onPress={() => setTentativa((n) => n + 1)} estilo={{ marginTop: 12 }} />
      </View>
    ) : (
      <View style={s.carregando}>
        <ActivityIndicator color={tema.cores.acao} />
        <Text style={s.nota}>Carregando seus endereços…</Text>
      </View>
    );
  }

  if (modoEndereco === 'novo' || (!endereco && modoEndereco !== 'escolher')) {
    return (
      <FormEndereco
        bairros={bairros}
        onCancelar={enderecos.some((e) => e.bairro.ativo) ? () => setModoEndereco(null) : null}
        onSalvo={(novo) => {
          setEnderecos((lista) => [novo, ...lista.map((e) => (novo.principal ? { ...e, principal: false } : e))]);
          setEnderecoId(novo.id);
          setModoEndereco(null);
        }}
      />
    );
  }

  if (modoEndereco === 'escolher') {
    return (
      <View>
        <Titulo>Entregar em</Titulo>
        {enderecos.map((e) => (
          <Opcao
            key={e.id}
            titulo={textoEndereco(e)}
            detalhe={`${e.bairro.nome}${e.bairro.ativo ? ` · entrega ${formatarPreco(e.bairro.taxaCentavos)}` : ' · não entregamos mais aqui'}`}
            marcada={e.id === enderecoId}
            desabilitada={!e.bairro.ativo}
            onPress={() => {
              setEnderecoId(e.id);
              setModoEndereco(null);
            }}
          />
        ))}
        {enderecos.length < 10 && <Botao titulo="+ Novo endereço" variante="texto" onPress={() => setModoEndereco('novo')} estilo={{ marginTop: 8 }} />}
      </View>
    );
  }

  const cartaoDados = (
    <View style={s.cartao}>
      <View style={s.linhaDado}>
        <View style={s.dado}>
          <Text style={s.rotulo}>Telefone</Text>
          <Text style={s.valor}>{formatarTelefone(cliente.telefone)}</Text>
        </View>
        <Botao titulo="Alterar" variante="texto" onPress={onEditarTelefone} />
      </View>
      <View style={[s.linhaDado, s.divisoria]}>
        <View style={s.dado}>
          <Text style={s.rotulo}>Entregar em</Text>
          <Text style={s.valor}>{textoEndereco(endereco)}</Text>
          <Text style={s.nota}>
            {endereco.bairro.nome}
            {endereco.referencia ? ` · ${endereco.referencia}` : ''}
          </Text>
        </View>
        <Botao titulo="Trocar" variante="texto" onPress={() => setModoEndereco('escolher')} />
      </View>
    </View>
  );

  if (etapa === 'confirmar') {
    return (
      <View>
        <Titulo>{`Confirme seus dados, ${cliente.nome.split(' ')[0]}`}</Titulo>
        {cartaoDados}
        <Botao titulo="Confirmar dados" onPress={() => setEtapa('pagamento')} bloco estilo={{ marginTop: 16 }} />
        <Botao titulo="Não é você? Sair" variante="texto" onPress={sair} bloco estilo={{ marginTop: 4 }} />
      </View>
    );
  }

  const enviar = async () => {
    setErro('');
    if (!forma) return setErro('Escolha a forma de pagamento.');
    if (troco.erro) return setErro(troco.erro);
    if (!podePedir) return setErro('Estamos fechados ou sem conexão agora: não dá para enviar o pedido.');
    setEnviando(true);
    let criado = false;
    try {
      const corpo = corpoDoPedido(itens, {
        enderecoId,
        formaPagamento: forma,
        trocoParaCentavos: troco.trocoParaCentavos,
        chaveIdempotencia: chave.current,
        totalEsperadoCentavos: resumo.totalCentavos,
      });
      const { pedido } = await chamar((token) => api.enviarPedido(token, corpo));
      criado = true;
      setPedidoEnviado(pedido);
      router.replace('/sacola/enviado');
      substituir([]); // o pedido já existe: a sacola esvazia na hora
      recarregarUltimo();
    } catch (e) {
      const r = interpretarErroDoEnvio(e, {
        itens,
        taxaBairroCentavos: endereco.bairro.taxaCentavos,
        taxaEntregaCentavos: resumo.taxaEntregaCentavos,
      });
      if (r.acao === 'sair') return; // a sessão já foi encerrada: a tela volta para o login
      if (r.acao === 'preco') {
        // Nada foi criado nem baixado: atualiza a sacola, a taxa e a regra de frete; a mesma chave vale.
        if (r.itens) substituir(r.itens);
        if (r.taxaBairroCentavos != null) {
          setEnderecos((lista) =>
            lista.map((x) => (x.id === enderecoId ? { ...x, bairro: { ...x.bairro, taxaCentavos: r.taxaBairroCentavos } } : x)),
          );
        }
        if (r.freteGratis) setFreteDaApi(r.freteGratis);
        recarregarCardapio();
      }
      if (r.acao === 'cardapio') recarregarCardapio();
      setErro(r.mensagem);
    } finally {
      if (!criado) setEnviando(false);
    }
  };

  return (
    <View>
      <Titulo subtitulo="Pagamento na entrega.">Forma de pagamento</Titulo>
      {FORMAS_PAGAMENTO.map((f) => (
        <Opcao key={f.valor} titulo={f.rotulo} marcada={forma === f.valor} onPress={() => setForma(f.valor)} />
      ))}

      {forma === 'DINHEIRO' && (
        <View style={s.troco}>
          <Pressable style={s.linhaTroco} onPress={() => setPrecisaTroco((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: precisaTroco }}>
            <Text style={s.valor}>Preciso de troco</Text>
            <Switch value={precisaTroco} onValueChange={setPrecisaTroco} trackColor={{ true: tema.cores.acao }} />
          </Pressable>
          {precisaTroco && (
            <Campo
              rotulo="Troco para quanto? (R$)"
              value={trocoTexto}
              onChangeText={setTrocoTexto}
              keyboardType="decimal-pad"
              placeholder="100"
              erro={trocoTexto ? troco.erro : null}
            />
          )}
        </View>
      )}

      <View style={[s.cartao, { marginTop: 16 }]}>
        <View style={s.linhaResumo}>
          <Text style={s.rotuloResumo}>Itens</Text>
          <Text style={s.valor}>{formatarPreco(resumo.subtotalCentavos)}</Text>
        </View>
        <View style={s.linhaResumo}>
          <Text style={s.rotuloResumo}>{`Taxa de entrega (${endereco.bairro.nome})`}</Text>
          <Text style={[s.valor, resumo.taxaEntregaCentavos === 0 && s.gratis]}>{textoTaxa(resumo.taxaEntregaCentavos)}</Text>
        </View>
        <View style={[s.linhaResumo, s.divisoria]}>
          <Text style={s.total}>Total</Text>
          <Text style={s.total}>{formatarPreco(resumo.totalCentavos)}</Text>
        </View>
      </View>
      <View style={s.linhaDado}>
        <Text style={[s.nota, { flex: 1 }]}>
          {textoEndereco(endereco)} · {formatarTelefone(cliente.telefone)}
        </Text>
        <Botao titulo="Alterar" variante="texto" onPress={() => setEtapa('confirmar')} />
      </View>

      <TextoErro>{erro}</TextoErro>
      <Botao
        titulo={enviando ? 'Enviando…' : `Enviar pedido · ${formatarPreco(resumo.totalCentavos)}`}
        onPress={enviar}
        carregando={enviando}
        desabilitado={itens.length === 0}
        bloco
        estilo={{ marginTop: 16 }}
      />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    carregando: { alignItems: 'center', gap: 8, padding: 24 },
    cartao: {
      backgroundColor: t.cores.superficie,
      borderRadius: t.raio.normal,
      borderWidth: 1,
      borderColor: t.cores.borda,
      paddingHorizontal: 14,
      paddingVertical: 4,
      marginTop: 12,
    },
    linhaDado: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
    divisoria: { borderTopWidth: 1, borderTopColor: t.cores.borda },
    dado: { flex: 1 },
    rotulo: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    valor: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, fontWeight: t.fontes.peso.medio },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
    troco: { marginTop: 8 },
    linhaTroco: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderWidth: 1,
      borderColor: t.cores.borda,
      borderRadius: t.raio.pequeno,
      backgroundColor: t.cores.superficie,
    },
    linhaResumo: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
    rotuloResumo: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, flexShrink: 1 },
    gratis: { color: t.cores.sucesso, fontWeight: t.fontes.peso.forte },
    total: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.forte, color: t.cores.texto },
  });
