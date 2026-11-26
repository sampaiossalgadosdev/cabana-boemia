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
import { corpoDoPedido, novaChavePedido, resumoDoPedido, textoTaxa } from '../logica/pedido.js';
import {
  PIX_ONLINE,
  emailValido,
  interpretarErroDoPix,
  opcoesDePagamento,
  pixParaGuardar,
  salvarPixPendente,
} from '../logica/pagamento.js';
import { VerificarTelefone } from './VerificarTelefone.js';
import { ERRO_GENERICO, interpretarErroDoEnvio, textoEndereco, trocoDoCheckout } from '../logica/checkout.js';
import { enderecoInicialNaLoja, taxaNaLoja } from '../logica/lojas.js';
import { useEstilos, useTema } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { Campo, Opcao, TextoErro, Titulo } from './formulario.js';
import { FormEndereco } from './FormEndereco.js';
import { MapaPino, temMapa } from './MapaPino.js';
import { corpoDoEndereco, precisaConfirmarPino } from '../logica/mapa.js';

/**
 * Depois do login e do telefone (como Finalizacao.jsx do site): endereço
 * (lista ou novo), confirmar dados (um toque), pagamento na entrega, resumo e
 * envio com chave de idempotência. O total aqui é prévia; vale o da API.
 * Multi-loja: a taxa é a da ÁREA DE ENTREGA DA LOJA da sacola
 * (/publico/lojas/:slug/bairros); endereço em bairro onde ela não entrega
 * aparece desabilitado com o motivo, e o 422 BAIRRO_FORA_DA_AREA da API
 * mostra a mensagem e leva à troca de endereço.
 * Endereço sem pino (antigo ou salvo sem mapa): depois de "Confirmar dados" pede
 * para confirmar no mapa, sem bloquear ("Agora não" segue sem pino).
 * Pagamento (Etapa 4 do pagamento online): a PRÉVIA da API (/cliente/pedidos/previa) dá a taxa
 * (por km na loja com entregadores do Taaki), o frete grátis (da loja ou da primeira compra) e as
 * formas da loja; sem ela (API antiga, sem rede), fica a prévia local de antes. "Pix pelo app"
 * cria o pedido aguardando o pagamento e abre a tela do Pix (a sacola só esvazia na aprovação).
 */
export function Finalizacao({ onEditarTelefone }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { cliente, chamar, sair, aplicarCliente } = useCliente();
  const { itens, substituir } = useCarrinho();
  const { dados: cardapio, podePedir, recarregar: recarregarCardapio, slug, loja } = useCardapio();
  const nomeLoja = loja?.nome || 'A loja';
  const { recarregar: recarregarUltimo, setPedidoEnviado } = useUltimoPedido();

  const [enderecos, setEnderecos] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [enderecoId, setEnderecoId] = useState(null);
  const [modoEndereco, setModoEndereco] = useState(null); // null | 'escolher' | 'novo'
  const [etapa, setEtapa] = useState('confirmar'); // 'confirmar' | 'pino' | 'pagamento'
  // Endereços em que a pessoa tocou "Agora não" no pino (só neste checkout).
  const [pinoPulado, setPinoPulado] = useState(() => new Set());
  const comMapa = useMemo(() => temMapa(), []);
  const [forma, setForma] = useState('');
  const [precisaTroco, setPrecisaTroco] = useState(false);
  const [trocoTexto, setTrocoTexto] = useState('');
  const [erro, setErro] = useState('');
  // Aviso por cima da lista de endereços (ex.: a loja não entrega no bairro).
  const [avisoEndereco, setAvisoEndereco] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Frete grátis vigente mandado pela API num 409 PRECO_ALTERADO (antes da recarga do cardápio).
  const [freteDaApi, setFreteDaApi] = useState(null);
  const chave = useRef(novaChavePedido());
  const [tentativa, setTentativa] = useState(0);
  // Prévia da API (taxa, frete grátis, campanha e formas da loja); null = usa a local.
  const [previa, setPrevia] = useState(null);
  const [versaoPrevia, setVersaoPrevia] = useState(0);
  const [emailTexto, setEmailTexto] = useState('');
  const [pedirEmail, setPedirEmail] = useState(false);

  useEffect(() => {
    let vivo = true;
    setErro('');
    Promise.all([chamar((token) => api.listarEnderecos(token)), api.buscarBairrosDaLoja(slug)])
      .then(([{ enderecos: lista }, { bairros: b }]) => {
        if (!vivo) return;
        setEnderecos(lista);
        setBairros(b);
        const inicial = enderecoInicialNaLoja(lista, b);
        setEnderecoId(inicial?.id ?? null);
        // Sem endereço nenhum: cadastra. Com endereços, mas nenhum onde a loja entrega: a lista com o motivo.
        if (!lista.length) setModoEndereco('novo');
        else if (!inicial) {
          setAvisoEndereco(`${nomeLoja} não entrega nos seus endereços salvos. Cadastre um endereço num bairro atendido.`);
          setModoEndereco('escolher');
        }
      })
      .catch((e) => vivo && e?.status !== 401 && setErro(ERRO_GENERICO));
    return () => {
      vivo = false;
    };
  }, [chamar, tentativa, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const freteGratis = freteDaApi ? freteDaApi.valor : (cardapio?.freteGratis ?? null);
  const endereco = enderecos?.find((e) => e.id === enderecoId) ?? null;
  const taxaBairro = taxaNaLoja(endereco, bairros) ?? 0;
  const resumoLocal = useMemo(() => resumoDoPedido(itens, taxaBairro, freteGratis), [itens, taxaBairro, freteGratis]);
  const resumo = previa
    ? { subtotalCentavos: previa.subtotalCentavos, taxaEntregaCentavos: previa.taxaEntregaCentavos, totalCentavos: previa.totalCentavos }
    : resumoLocal;
  const opcoes = opcoesDePagamento(previa?.formasPagamento ?? null);
  const troco = trocoDoCheckout({ forma, precisaTroco, texto: trocoTexto, totalCentavos: resumo.totalCentavos });

  // Prévia da API ao chegar no pagamento (e a cada mudança de endereço, itens ou campanha).
  const chaveItens = itens.map((i) => `${i.produtoId}x${i.quantidade}`).join(',');
  useEffect(() => {
    if (etapa !== 'pagamento' || !endereco) return undefined;
    let vivo = true;
    chamar((token) => api.buscarPrevia(token, { itens, enderecoId: endereco.id, lojaSlug: slug }))
      .then(({ previa: p }) => vivo && setPrevia(p))
      .catch((e) => {
        if (!vivo) return;
        setPrevia(null);
        // Recusa da loja (fechada, fora da área, sem pino...): mostra já, antes do envio.
        if (e?.status && e.status !== 401 && e.status !== 404) setErro(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [etapa, endereco?.id, chaveItens, slug, versaoPrevia]); // eslint-disable-line react-hooks/exhaustive-deps

  // A forma escolhida saiu das opções da loja (ex.: a loja desligou o Pix pelo app): escolher de novo.
  useEffect(() => {
    if (forma && !opcoes.some((o) => o.valor === forma)) setForma('');
  }, [forma, opcoes.map((o) => o.valor).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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
        titulo={`Endereço de entrega (${nomeLoja} entrega nestes bairros)`}
        onCancelar={enderecos.length ? () => setModoEndereco(enderecoInicialNaLoja(enderecos, bairros) ? null : 'escolher') : null}
        onSalvo={(novo) => {
          setEnderecos((lista) => [novo, ...lista.map((e) => (novo.principal ? { ...e, principal: false } : e))]);
          setEnderecoId(novo.id);
          setAvisoEndereco('');
          setModoEndereco(null);
        }}
      />
    );
  }

  if (modoEndereco === 'escolher') {
    return (
      <View>
        <Titulo>Entregar em</Titulo>
        {avisoEndereco ? <TextoErro>{avisoEndereco}</TextoErro> : null}
        {enderecos.map((e) => {
          const taxa = taxaNaLoja(e, bairros);
          return (
            <Opcao
              key={e.id}
              titulo={textoEndereco(e)}
              detalhe={`${e.bairro.nome}${taxa != null ? ` · entrega ${formatarPreco(taxa)}` : ` · ${nomeLoja} não entrega neste bairro`}`}
              marcada={e.id === enderecoId}
              desabilitada={taxa == null}
              onPress={() => {
                setEnderecoId(e.id);
                setAvisoEndereco('');
                setErro('');
                setModoEndereco(null);
              }}
            />
          );
        })}
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
        <Botao
          titulo="Confirmar dados"
          onPress={() => setEtapa(comMapa && precisaConfirmarPino(endereco) && !pinoPulado.has(endereco.id) ? 'pino' : 'pagamento')}
          bloco
          estilo={{ marginTop: 16 }}
        />
        <Botao titulo="Não é você? Sair" variante="texto" onPress={sair} bloco estilo={{ marginTop: 4 }} />
      </View>
    );
  }

  if (etapa === 'pino') {
    return (
      <ConfirmarPino
        endereco={endereco}
        chamar={chamar}
        aoConfirmar={(atualizado) => {
          setEnderecos((lista) => lista.map((e) => (e.id === atualizado.id ? atualizado : e)));
          setEtapa('pagamento');
        }}
        aoPular={() => {
          setPinoPulado((p) => new Set(p).add(endereco.id));
          setEtapa('pagamento');
        }}
      />
    );
  }

  const pixOnline = forma === PIX_ONLINE;
  const precisaEmail = pixOnline && (!cliente.email || pedirEmail);

  const enviar = async () => {
    setErro('');
    if (!forma) return setErro('Escolha a forma de pagamento.');
    if (troco.erro) return setErro(troco.erro);
    if (!podePedir) return setErro('Estamos fechados ou sem conexão agora: não dá para enviar o pedido.');
    if (precisaEmail && !emailValido(emailTexto)) return setErro('Informe um e-mail válido para pagar com Pix.');
    setEnviando(true);
    let criado = false;
    try {
      // E-mail do pagador (Decisão 13): pedido uma vez e salvo no cadastro.
      if (precisaEmail) {
        const { cliente: novo } = await chamar((token) => api.salvarEmail(token, emailTexto.trim()));
        aplicarCliente(novo);
        setPedirEmail(false);
      }
      const corpo = corpoDoPedido(itens, {
        enderecoId,
        formaPagamento: forma,
        trocoParaCentavos: troco.trocoParaCentavos,
        chaveIdempotencia: chave.current,
        totalEsperadoCentavos: resumo.totalCentavos,
        lojaSlug: slug,
      });
      const r = await chamar((token) => api.enviarPedido(token, corpo));
      criado = true;
      if (r.pagamento) {
        // Pix: a tela do Pix acompanha o pagamento; a sacola fica até a aprovação.
        await salvarPixPendente(pixParaGuardar(r, loja ? { slug, nome: loja.nome } : null));
        router.replace('/sacola/pix');
        return;
      }
      const { pedido } = r;
      setPedidoEnviado(pedido);
      router.replace('/sacola/enviado');
      substituir([]); // o pedido já existe: a sacola esvazia na hora
      recarregarUltimo();
    } catch (e) {
      const pix = interpretarErroDoPix(e);
      if (pix) {
        // O pedido anterior foi encerrado (Pix não gerado ou expirado): o próximo é outro.
        if (pix.acao === 'novaChave' || pix.novaChave) chave.current = novaChavePedido();
        if (pix.acao === 'email') {
          // E-mail recusado pelo Mercado Pago: o campo volta preenchido para o cliente corrigir.
          if (pix.novaChave) setEmailTexto(cliente.email ?? '');
          setPedirEmail(true);
        }
        if (pix.acao === 'formas') setVersaoPrevia((n) => n + 1);
        return setErro(pix.mensagem);
      }
      const r = interpretarErroDoEnvio(e, {
        itens,
        taxaBairroCentavos: taxaBairro,
        taxaEntregaCentavos: resumo.taxaEntregaCentavos,
      });
      if (r.acao === 'sair') return; // a sessão já foi encerrada: a tela volta para o login
      if (r.acao === 'endereco') {
        // A loja não entrega no bairro (a área mudou no meio): mensagem clara e a lista para trocar.
        setBairros((b) => b.filter((x) => x.id !== endereco.bairro.id));
        setAvisoEndereco(r.mensagem);
        setEnderecoId(null);
        setEtapa('confirmar');
        setModoEndereco('escolher');
        return;
      }
      if (r.acao === 'preco') {
        // Nada foi criado nem baixado: atualiza a sacola, a taxa e a regra de frete; a mesma chave vale.
        if (r.itens) substituir(r.itens);
        if (r.taxaBairroCentavos != null) {
          setBairros((b) => b.map((x) => (x.id === endereco.bairro.id ? { ...x, taxaCentavos: r.taxaBairroCentavos } : x)));
        }
        if (r.freteGratis) setFreteDaApi(r.freteGratis);
        recarregarCardapio();
        setVersaoPrevia((n) => n + 1);
      }
      if (r.acao === 'cardapio') recarregarCardapio();
      setErro(r.mensagem);
    } finally {
      if (!criado) setEnviando(false);
    }
  };

  return (
    <View>
      <Titulo subtitulo={opcoes.some((o) => o.agora) ? 'Pague agora pelo app ou na entrega.' : 'Pagamento na entrega.'}>Forma de pagamento</Titulo>
      {opcoes.map((f, i) => (
        <View key={f.valor}>
          {!f.agora && i > 0 && opcoes[i - 1].agora && <Text style={[s.rotulo, s.grupo]}>Pagar na entrega</Text>}
          <Opcao titulo={f.rotulo} detalhe={f.agora ? 'Pix com QR code ou copia e cola; o pedido vai para a loja quando o pagamento for aprovado.' : undefined} marcada={forma === f.valor} onPress={() => setForma(f.valor)} />
        </View>
      ))}

      {precisaEmail && (
        <Campo
          rotulo="Seu e-mail (o Mercado Pago pede para o Pix)"
          value={emailTexto}
          onChangeText={setEmailTexto}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="voce@exemplo.com"
        />
      )}

      {previa?.campanha?.disponivelSeVerificar && (
        <VerificarTelefone
          aoVerificar={(novo) => {
            aplicarCliente(novo);
            setVersaoPrevia((n) => n + 1);
          }}
        />
      )}

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
        {previa?.origemFreteGratis === 'CAMPANHA' && <Text style={[s.nota, s.gratis]}>Frete grátis da primeira compra 🎉</Text>}
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
        titulo={enviando ? 'Enviando…' : `${pixOnline ? 'Gerar Pix' : 'Enviar pedido'} · ${formatarPreco(resumo.totalCentavos)}`}
        onPress={enviar}
        carregando={enviando}
        desabilitado={itens.length === 0}
        bloco
        estilo={{ marginTop: 16 }}
      />
    </View>
  );
}

/**
 * Endereço sem pino: abre o mapa já buscando pelo texto salvo. "Confirmar local"
 * grava o pino no endereço (o texto não muda); "Agora não" segue sem pino.
 */
function ConfirmarPino({ endereco, chamar, aoConfirmar, aoPular }) {
  const [pino, setPino] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const campos = {
    rua: endereco.rua,
    numero: endereco.numero,
    complemento: endereco.complemento ?? '',
    referencia: endereco.referencia ?? '',
    bairroId: endereco.bairro.id,
  };

  const confirmar = async () => {
    setSalvando(true);
    setErro('');
    try {
      const { endereco: atualizado } = await chamar((token) => api.atualizarEndereco(token, endereco.id, corpoDoEndereco(campos, pino)));
      aoConfirmar(atualizado);
    } catch (e) {
      setErro(e?.status ? e.message : ERRO_GENERICO);
      setSalvando(false);
    }
  };

  return (
    <View>
      <Titulo subtitulo={`${textoEndereco(endereco)} · ${endereco.bairro.nome}`}>Confirme no mapa onde entregar</Titulo>
      <MapaPino
        pino={pino}
        aoMudar={setPino}
        aoBuscar={() => chamar((token) => api.geocodificarEndereco(token, campos))}
        buscarAoAbrir
      />
      <TextoErro>{erro}</TextoErro>
      <Botao titulo={salvando ? 'Salvando…' : 'Confirmar local'} onPress={confirmar} carregando={salvando} desabilitado={!pino} bloco estilo={{ marginTop: 16 }} />
      <Botao titulo="Agora não" variante="texto" onPress={aoPular} bloco estilo={{ marginTop: 4 }} />
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
    grupo: { marginTop: 12, marginBottom: 4 },
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
