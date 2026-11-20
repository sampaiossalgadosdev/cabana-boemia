import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { obterDadosDoApp } from '../lib/config.js';
import { SERVIDOR } from '../lib/links.js';
import { PLATAFORMA_PADRAO } from '../logica/plataforma.js';
import { useEstilos, useTema } from '../tema/tema.js';

function Link({ icone, titulo, detalhe, onPress }) {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icone} size={22} color={tema.cores.acao} />
      <View style={{ flex: 1 }}>
        <Text style={s.linkTitulo}>{titulo}</Text>
        {detalhe ? <Text style={s.nota}>{detalhe}</Text> : null}
      </View>
      <Ionicons name="open-outline" size={18} color={tema.cores.textoSuave} />
    </Pressable>
  );
}

/**
 * Sobre: quem é a plataforma (responsável, documento, cidade), o canal de
 * contato do titular e os links legais. Dados de GET /publico/app; sem rede,
 * os links continuam (são páginas do servidor).
 */
export default function Sobre() {
  const s = useEstilos(criarEstilos);
  const tema = useTema();
  const [dados, setDados] = useState(null);
  const [semRede, setSemRede] = useState(false);

  const carregar = useCallback(() => {
    setSemRede(false);
    obterDadosDoApp()
      .then(setDados)
      .catch(() => {
        setDados(PLATAFORMA_PADRAO);
        setSemRede(true);
      });
  }, []);
  useEffect(carregar, [carregar]);

  const abrir = (caminho) => Linking.openURL(`${SERVIDOR}${caminho}`);
  const versao = Constants.expoConfig?.version;

  return (
    <ScrollView style={s.tela} contentContainerStyle={s.conteudo}>
      <Text style={s.marca} accessibilityRole="header">
        Delivery Abatiá
      </Text>
      <Text style={s.nota}>Pedidos das lojas de Abatiá-PR.{versao ? ` Versão ${versao}.` : ''}</Text>

      {!dados ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={tema.cores.acao} />
      ) : (
        <>
          <View style={s.cartao}>
            <Text style={s.tituloCartao}>Responsável pela plataforma</Text>
            {dados.plataforma.responsavel ? (
              <>
                <Text style={s.valor}>{dados.plataforma.responsavel}</Text>
                {dados.plataforma.documento ? <Text style={s.nota}>{dados.plataforma.documento}</Text> : null}
                <Text style={s.nota}>{dados.plataforma.cidade}</Text>
              </>
            ) : (
              <Text style={s.nota}>{semRede ? 'Sem conexão: não foi possível carregar agora.' : '—'}</Text>
            )}
            <Text style={[s.nota, { marginTop: 8 }]}>
              Cada loja é responsável pelos produtos, preços, preparo, entrega e documentos fiscais dos pedidos feitos a ela.
            </Text>
          </View>

          <View style={s.cartao}>
            <Text style={s.tituloCartao}>Fale com a gente</Text>
            <Text style={s.nota}>Dúvidas sobre seus dados pessoais e sobre o app. Dúvidas sobre um pedido são com a loja, pelo WhatsApp da tela do pedido.</Text>
            {dados.contato.email ? (
              <Link icone="mail-outline" titulo={dados.contato.email} onPress={() => Linking.openURL(`mailto:${dados.contato.email}`)} />
            ) : null}
            <Link icone="document-text-outline" titulo="Formulário de contato e exclusão de conta" onPress={() => abrir(dados.contato.formulario)} />
          </View>

          <View style={s.cartao}>
            <Text style={s.tituloCartao}>Documentos</Text>
            <Link
              icone="shield-checkmark-outline"
              titulo="Política de privacidade"
              detalhe={dados.documentos.vigencia ? `Vigente desde ${dados.documentos.vigencia}` : null}
              onPress={() => abrir(dados.documentos.privacidade)}
            />
            <Link icone="reader-outline" titulo="Termos de uso" onPress={() => abrir(dados.documentos.termos)} />
            <Link icone="trash-outline" titulo="Como excluir sua conta" onPress={() => abrir(dados.documentos.excluirConta)} />
          </View>
          {semRede ? (
            <Pressable onPress={carregar} accessibilityRole="button">
              <Text style={[s.linkTitulo, { textAlign: 'center' }]}>Tentar de novo</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: t.cores.fundo },
    conteudo: { padding: 16, paddingBottom: 40 },
    marca: { fontSize: t.fontes.tamanho.titulo, fontWeight: t.fontes.peso.pesado, color: t.cores.cabecalho },
    cartao: { backgroundColor: t.cores.superficie, borderRadius: t.raio.normal, borderWidth: 1, borderColor: t.cores.borda, padding: 14, marginTop: 16, gap: 2 },
    tituloCartao: { fontSize: t.fontes.tamanho.medio, fontWeight: t.fontes.peso.pesado, color: t.cores.texto, marginBottom: 4 },
    valor: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, fontWeight: t.fontes.peso.medio },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave, lineHeight: 19 },
    link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.cores.borda, marginTop: 8 },
    linkTitulo: { fontSize: t.fontes.tamanho.normal, color: t.cores.acao, fontWeight: t.fontes.peso.forte },
  });
