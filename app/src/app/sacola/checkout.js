import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCliente } from '../../estado/Cliente.js';
import { AvisosNaTela } from '../../estado/Avisos.js';
import { etapaCheckout } from '../../logica/sessao.js';
import { EntrarCom } from '../../componentes/EntrarCom.js';
import { PassoTelefone } from '../../componentes/PassoTelefone.js';
import { Finalizacao } from '../../componentes/Finalizacao.js';
import { TelaSemInternet } from '../../componentes/TelaSemInternet.js';
import { useEstilos, useTema } from '../../tema/tema.js';

/** Checkout (como o do site): login → telefone obrigatório → endereço → confirmar → pagamento → envio. */
export default function TelaCheckout() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const { bottom } = useSafeAreaInsets();
  const sessao = useCliente();
  const [editandoTelefone, setEditandoTelefone] = useState(false);
  const etapa = etapaCheckout(sessao);

  if (etapa === 'carregando') {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator size="large" color={tema.cores.acao} accessibilityLabel="Carregando seus dados" />
      </View>
    );
  }
  if (etapa === 'erro') return <TelaSemInternet onTentarDeNovo={sessao.tentarDeNovo} />;

  return (
    <KeyboardAvoidingView style={s.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
      <ScrollView contentContainerStyle={[s.conteudo, { paddingBottom: bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {etapa === 'login' ? (
          <EntrarCom titulo="Entre para finalizar" texto="Usamos sua conta só para identificar você. Sua sacola continua aqui." />
        ) : etapa === 'telefone' || editandoTelefone ? (
          <PassoTelefone
            key={sessao.cliente.id}
            onSalvo={() => setEditandoTelefone(false)}
            onCancelar={etapa === 'telefone' ? null : () => setEditandoTelefone(false)}
          />
        ) : (
          <Finalizacao key={sessao.cliente.id} onEditarTelefone={() => setEditandoTelefone(true)} />
        )}
      </ScrollView>
      <AvisosNaTela distanciaDoFim={bottom + 16} />
    </KeyboardAvoidingView>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    centro: { alignItems: 'center', justifyContent: 'center' },
    conteudo: { padding: 16 },
  });
