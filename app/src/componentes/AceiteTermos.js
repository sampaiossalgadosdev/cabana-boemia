import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCliente } from '../estado/Cliente.js';
import { precisaAceitar } from '../logica/plataforma.js';
import { ERRO_GENERICO } from '../logica/checkout.js';
import { useEstilos } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { CaixaAceite } from './EntrarCom.js';
import { TextoErro } from './formulario.js';

/**
 * Logado sem o aceite da versão atual dos termos e da política (conta de
 * antes desta tela, entrou sem rede para buscar a versão, ou os textos
 * mudaram): por cima de tudo, até aceitar ou sair da conta.
 */
export function AceiteTermos() {
  const s = useEstilos(criarEstilos);
  const { top, bottom } = useSafeAreaInsets();
  const { status, cliente, aceitarTermos, sair } = useCliente();
  const [marcada, setMarcada] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const aberto = precisaAceitar(status, cliente);
  const jaAceitouAntes = Boolean(cliente?.termosVersao);

  const aceitar = async () => {
    if (!marcada) return setErro('Marque que leu e aceita para continuar.');
    setOcupado(true);
    setErro('');
    try {
      await aceitarTermos();
      setMarcada(false);
    } catch (e) {
      setErro(e?.status ? e.message : ERRO_GENERICO);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal visible={aberto} animationType="slide" onRequestClose={() => {}} statusBarTranslucent>
      <ScrollView style={s.tela} contentContainerStyle={[s.conteudo, { paddingTop: top + 24, paddingBottom: bottom + 24 }]}>
        <Text style={s.titulo} accessibilityRole="header">
          {jaAceitouAntes ? 'Atualizamos os termos' : 'Antes de continuar'}
        </Text>
        <Text style={s.texto}>
          {jaAceitouAntes
            ? 'Os Termos de uso e a Política de privacidade do Delivery do Batiá mudaram. Leia a versão nova e aceite para continuar usando sua conta.'
            : 'Para usar sua conta no Delivery do Batiá, leia e aceite os Termos de uso e a Política de privacidade.'}
        </Text>
        <Text style={s.texto}>
          Toque nos nomes abaixo para ler. Receber ofertas é outra escolha, opcional, em Perfil › Comunicações.
        </Text>
        <View style={{ marginTop: 16 }}>
          <CaixaAceite
            marcada={marcada}
            onMudar={(v) => {
              setMarcada(v);
              if (v) setErro('');
            }}
          />
        </View>
        <TextoErro>{erro}</TextoErro>
        <Botao titulo="Aceitar e continuar" onPress={aceitar} carregando={ocupado} bloco estilo={{ marginTop: 20 }} />
        <Botao titulo="Não aceito, sair da conta" variante="texto" onPress={sair} desabilitado={ocupado} bloco estilo={{ marginTop: 8 }} />
      </ScrollView>
    </Modal>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { paddingHorizontal: 20 },
    titulo: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado, color: t.cores.texto, marginBottom: 12 },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, lineHeight: 22, marginTop: 8 },
  });
