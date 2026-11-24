import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCliente } from '../estado/Cliente.js';
import { precisaPedirNome } from '../logica/plataforma.js';
import { errosPorCampo } from '../logica/checkout.js';
import { useEstilos } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { Campo, TextoErro } from './formulario.js';
import { MarcaTaaki } from './MarcaTaaki.js';

/**
 * Entrou pelo celular numa conta nova (sem nome): por cima de tudo, depois do
 * aceite dos termos, até informar o nome (a loja precisa dele para entregar).
 * Grava com o telefone que já está na conta (o verificado; não muda aqui).
 */
export function PedirNome() {
  const s = useEstilos(criarEstilos);
  const { top, bottom } = useSafeAreaInsets();
  const { status, cliente, atualizarPerfil, sair } = useCliente();
  const [nome, setNome] = useState('');
  const [erros, setErros] = useState({});
  const [ocupado, setOcupado] = useState(false);
  const aberto = precisaPedirNome(status, cliente);

  const salvar = async () => {
    if (!nome.trim()) return setErros({ nome: 'Informe seu nome' });
    setOcupado(true);
    setErros({});
    try {
      await atualizarPerfil({ nome: nome.trim(), telefone: cliente.telefone });
      setNome('');
    } catch (e) {
      setErros(errosPorCampo(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal visible={aberto} animationType="slide" onRequestClose={() => {}} statusBarTranslucent>
      <ScrollView
        style={s.tela}
        contentContainerStyle={[s.conteudo, { paddingTop: top + 24, paddingBottom: bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <MarcaTaaki tamanho={72} estilo={s.marca} />
        <Text style={s.titulo} accessibilityRole="header">
          Como podemos te chamar?
        </Text>
        <Text style={s.texto}>A loja usa seu nome para identificar o pedido na entrega.</Text>
        <Campo
          rotulo="Nome"
          value={nome}
          onChangeText={(t) => {
            setNome(t);
            if (erros.nome) setErros({});
          }}
          maxLength={100}
          autoComplete="name"
          textContentType="name"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={salvar}
          erro={erros.nome}
          estilo={{ marginTop: 16 }}
        />
        <TextoErro>{erros.geral || erros.telefone}</TextoErro>
        <Botao titulo="Continuar" onPress={salvar} carregando={ocupado} bloco estilo={{ marginTop: 20 }} />
        <Botao titulo="Sair da conta" variante="texto" onPress={sair} desabilitado={ocupado} bloco estilo={{ marginTop: 8 }} />
      </ScrollView>
    </Modal>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { paddingHorizontal: 20 },
    marca: { alignSelf: 'center', marginBottom: 20 },
    titulo: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado, color: t.cores.texto, marginBottom: 12 },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, lineHeight: 22, marginTop: 8 },
  });
