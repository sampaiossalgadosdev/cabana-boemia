import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../../estado/Cliente.js';
import { AvisosNaTela, useAvisos } from '../../estado/Avisos.js';
import * as api from '../../lib/api.js';
import { ERRO_GENERICO, textoEndereco } from '../../logica/checkout.js';
import { Botao } from '../../componentes/basicos.js';
import { EntrarCom } from '../../componentes/EntrarCom.js';
import { URL_PRIVACIDADE, URL_TERMOS } from '../../lib/links.js';
import { PassoTelefone } from '../../componentes/PassoTelefone.js';
import { FormEndereco } from '../../componentes/FormEndereco.js';
import { TextoErro } from '../../componentes/formulario.js';
import { TopoAba } from '../../componentes/TopoAba.js';
import { TelaSemInternet } from '../../componentes/TelaSemInternet.js';
import { useEstilos, useTema } from '../../tema/tema.js';

const TEXTO_EXCLUSAO =
  'Isso apaga sua conta de vez: nome, e-mail, telefone, endereços salvos e o acesso pelo Google ou pela Apple, ' +
  'em todos os aparelhos.\n\nOs pedidos já feitos ficam com o restaurante como registro fiscal (valores e itens), ' +
  'mas sem seu nome, telefone e endereço. Se um pedido seu ainda está em andamento, a exclusão fica liberada ' +
  'quando ele for entregue ou 3 horas depois do pedido.\n\nNão dá para desfazer.';

function Endereco({ endereco, ocupado, onEditar, onPrincipal, onRemover }) {
  const s = useEstilos(criarEstilos);
  const { bairro } = endereco;
  return (
    <View style={s.endereco}>
      <View style={s.linha}>
        <Text style={[s.valor, { flex: 1 }]}>{textoEndereco(endereco)}</Text>
        {endereco.principal && <Text style={s.selo}>Principal</Text>}
      </View>
      <Text style={s.nota}>
        {bairro.nome}
        {endereco.referencia ? ` · ${endereco.referencia}` : ''}
        {!bairro.ativo ? ' · não entregamos mais aqui' : ''}
      </Text>
      <View style={s.acoes}>
        <Botao titulo="Editar" variante="texto" onPress={onEditar} desabilitado={ocupado} />
        {!endereco.principal && bairro.ativo && <Botao titulo="Tornar principal" variante="texto" onPress={onPrincipal} desabilitado={ocupado} />}
        <Botao
          titulo="Remover"
          variante="texto"
          desabilitado={ocupado}
          onPress={() =>
            Alert.alert('Remover endereço', `Remover ${textoEndereco(endereco)}?`, [
              { text: 'Não', style: 'cancel' },
              { text: 'Sim, remover', style: 'destructive', onPress: onRemover },
            ])
          }
        />
      </View>
    </View>
  );
}

/**
 * Aba Perfil (como TelaPerfil.jsx do site): dados, telefone, endereços, Sair
 * e "Excluir minha conta" (exigência do Google Play e da App Store).
 */
export default function Perfil() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { status, cliente, provedor, chamar, sair, excluirConta, definirMarketing, tentarDeNovo } = useCliente();
  const { avisar } = useAvisos();
  const [enderecos, setEnderecos] = useState(null);
  const [bairros, setBairros] = useState([]);
  const [editando, setEditando] = useState(null); // null | 'telefone' | 'novo' | endereço
  const [ocupado, setOcupado] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState('');
  const [salvandoMarketing, setSalvandoMarketing] = useState(false);
  const [erroMarketing, setErroMarketing] = useState('');

  const mudarMarketing = async (aceito) => {
    setSalvandoMarketing(true);
    setErroMarketing('');
    try {
      await definirMarketing(aceito);
      avisar(aceito ? 'Pronto: você vai receber ofertas e novidades.' : 'Pronto: você não vai mais receber ofertas.');
    } catch (e) {
      if (e?.status !== 401) setErroMarketing(e?.status ? e.message : ERRO_GENERICO);
    } finally {
      setSalvandoMarketing(false);
    }
  };

  const tratarErro = useCallback((e) => {
    if (e?.status !== 401) setErro(e?.status ? e.message : ERRO_GENERICO);
  }, []);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [{ enderecos: lista }, { bairros: b }] = await Promise.all([chamar((token) => api.listarEnderecos(token)), api.buscarBairrosDaCidade()]);
      setEnderecos(lista);
      setBairros(b);
    } catch (e) {
      tratarErro(e);
    }
  }, [chamar, tratarErro]);

  useEffect(() => {
    if (status === 'logado') carregar();
    else {
      setEnderecos(null);
      setEditando(null);
    }
  }, [status, carregar]);

  const acao = async (fn) => {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      await carregar();
    } catch (e) {
      tratarErro(e);
    } finally {
      setOcupado(false);
    }
  };

  const confirmarExclusao = () =>
    Alert.alert('Excluir minha conta', provedor === 'apple' ? `${TEXTO_EXCLUSAO}\n\nA Apple vai pedir sua confirmação.` : TEXTO_EXCLUSAO, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir conta',
        style: 'destructive',
        onPress: async () => {
          setExcluindo(true);
          setErro('');
          try {
            await excluirConta();
            avisar('Sua conta foi excluída.');
          } catch (e) {
            tratarErro(e);
          } finally {
            setExcluindo(false);
          }
        },
      },
    ]);

  const links = (
    <View style={s.links}>
      <Botao titulo="Política de privacidade" variante="texto" onPress={() => Linking.openURL(URL_PRIVACIDADE)} />
      <Botao titulo="Termos de uso" variante="texto" onPress={() => Linking.openURL(URL_TERMOS)} />
      <Botao titulo="Sobre o Táqui Delivery" variante="texto" onPress={() => router.push('/sobre')} />
    </View>
  );

  let corpo;
  if (status === 'carregando') {
    corpo = <ActivityIndicator style={{ marginTop: 32 }} color={tema.cores.acao} />;
  } else if (status === 'erro') {
    return (
      <View style={s.tela}>
        <TopoAba titulo="Perfil" />
        <TelaSemInternet onTentarDeNovo={tentarDeNovo} />
      </View>
    );
  } else if (status !== 'logado') {
    corpo = (
      <>
        <EntrarCom titulo="Entre na sua conta" texto="Com sua conta seus dados de entrega ficam salvos para os próximos pedidos." />
        {links}
      </>
    );
  } else if (editando === 'telefone' || !cliente.telefone) {
    corpo = (
      <PassoTelefone
        titulo="Nome e telefone"
        texto="O telefone é por onde falamos com você sobre o pedido."
        rotuloBotao="Salvar"
        onSalvo={() => setEditando(null)}
        onCancelar={cliente.telefone ? () => setEditando(null) : null}
      />
    );
  } else if (editando) {
    const novo = editando === 'novo';
    corpo = (
      <FormEndereco
        bairros={bairros}
        endereco={novo ? null : editando}
        titulo={novo ? 'Novo endereço' : 'Editar endereço'}
        onCancelar={() => setEditando(null)}
        onSalvo={async () => {
          setEditando(null);
          await carregar();
        }}
      />
    );
  } else {
    corpo = (
      <>
        <View style={s.cartao}>
          <Text style={s.tituloCartao}>Seus dados</Text>
          <Text style={s.rotulo}>Nome</Text>
          <Text style={s.valor}>{cliente.nome}</Text>
          <Text style={s.rotulo}>{provedor === 'apple' ? 'E-mail (Apple)' : provedor === 'google' ? 'E-mail (Google)' : 'E-mail'}</Text>
          <Text style={s.valor}>{cliente.email ?? '—'}</Text>
          <Text style={s.rotulo}>Telefone</Text>
          <Text style={s.valor}>{formatarTelefone(cliente.telefone)}</Text>
          <Botao titulo="Alterar nome ou telefone" variante="texto" onPress={() => setEditando('telefone')} estilo={s.alinharEsquerda} />
        </View>

        <View style={s.cartao}>
          <Text style={s.tituloCartao}>Endereços</Text>
          {enderecos === null ? (
            !erro && <ActivityIndicator color={tema.cores.acao} accessibilityLabel="Carregando seus endereços" />
          ) : enderecos.length === 0 ? (
            <Text style={s.nota}>Nenhum endereço salvo ainda.</Text>
          ) : (
            enderecos.map((e) => (
              <Endereco
                key={e.id}
                endereco={e}
                ocupado={ocupado}
                onEditar={() => setEditando(e)}
                onPrincipal={() =>
                  acao(() =>
                    chamar((token) =>
                      api.atualizarEndereco(token, e.id, {
                        rua: e.rua,
                        numero: e.numero,
                        complemento: e.complemento,
                        referencia: e.referencia,
                        bairroId: e.bairro.id,
                        principal: true,
                      }),
                    ),
                  )
                }
                onRemover={() => acao(() => chamar((token) => api.removerEndereco(token, e.id)))}
              />
            ))
          )}
          <TextoErro>{erro}</TextoErro>
          {enderecos !== null && enderecos.length < 10 && (
            <Botao titulo="+ Novo endereço" variante="texto" onPress={() => setEditando('novo')} desabilitado={ocupado} estilo={s.alinharEsquerda} />
          )}
        </View>

        <View style={s.cartao}>
          <Text style={s.tituloCartao}>Comunicações</Text>
          <View style={s.linhaSwitch}>
            <Text style={[s.valor, { flex: 1 }]} nativeID="rotuloMarketing">
              Quero receber ofertas e novidades das lojas e do Táqui Delivery
            </Text>
            <Switch
              value={Boolean(cliente.marketing)}
              onValueChange={mudarMarketing}
              disabled={salvandoMarketing}
              accessibilityLabel="Quero receber ofertas e novidades"
              trackColor={{ true: tema.cores.acao, false: tema.cores.desabilitado }}
              thumbColor={tema.cores.superficie}
            />
          </View>
          <Text style={s.nota}>
            Opcional. Você pode desligar quando quiser; seus pedidos não mudam. Avisos sobre um pedido seu (pelo WhatsApp da loja) não dependem desta opção.
          </Text>
          <TextoErro>{erroMarketing}</TextoErro>
        </View>

        <Botao titulo="Sair" variante="secundario" onPress={sair} bloco estilo={{ marginTop: 16 }} />
        {links}
        <Botao
          titulo={excluindo ? 'Excluindo…' : 'Excluir minha conta'}
          variante="texto"
          onPress={confirmarExclusao}
          carregando={excluindo}
          bloco
          estilo={{ marginTop: 8 }}
        />
      </>
    );
  }

  return (
    <View style={s.tela}>
      <TopoAba titulo="Perfil" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
          {corpo}
        </ScrollView>
      </KeyboardAvoidingView>
      <AvisosNaTela distanciaDoFim={24} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { padding: 16, paddingBottom: 40 },
    cartao: { backgroundColor: t.cores.superficie, borderRadius: t.raio.normal, borderWidth: 1, borderColor: t.cores.borda, padding: 14, marginBottom: 16 },
    tituloCartao: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.pesado, color: t.cores.texto, marginBottom: 4 },
    rotulo: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 10 },
    valor: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, fontWeight: t.fontes.peso.medio },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, marginTop: 2 },
    endereco: { borderTopWidth: 1, borderTopColor: t.cores.borda, paddingTop: 10, marginTop: 10 },
    linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    selo: {
      fontSize: 11,
      fontWeight: t.fontes.peso.forte,
      color: t.cores.textoAcao,
      backgroundColor: t.cores.destaque,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: t.raio.pequeno,
      overflow: 'hidden',
    },
    acoes: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -8 },
    alinharEsquerda: { alignSelf: 'flex-start', marginLeft: -8 },
    links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 },
    linhaSwitch: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 6 },
  });
