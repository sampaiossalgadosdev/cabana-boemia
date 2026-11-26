import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatarTelefone, mascararTelefone, normalizarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../estado/Cliente.js';
import * as api from '../lib/api.js';
import {
  MENSAGEM_TELEFONE_INVALIDO,
  REENVIO_SEGUNDOS,
  celularValido,
  codigoCompleto,
  interpretarErroCelular,
  limparCodigo,
  segundosParaReenviar,
  textoReenvio,
} from '../logica/loginCelular.js';
import { TEXTO_CAMPANHA } from '../logica/pagamento.js';
import { useEstilos } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { Campo, TextoErro } from './formulario.js';

/**
 * Faixa do checkout "Verifique seu telefone para ganhar frete grátis na primeira compra"
 * (campanha da plataforma; só vale com o telefone confirmado por código). Mesmo fluxo do
 * login com celular (número → código de 6 números → reenviar depois de 60 s), mas na conta
 * já logada: a API marca o telefone desta conta como verificado. `aoVerificar` recebe o cadastro novo.
 */
export function VerificarTelefone({ aoVerificar }) {
  const s = useEstilos(criarEstilos);
  const { cliente, chamar } = useCliente();
  const [aberto, setAberto] = useState(false);
  const [etapa, setEtapa] = useState('numero'); // 'numero' | 'codigo'
  const [celular, setCelular] = useState(cliente?.telefone ? formatarTelefone(cliente.telefone) : '');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [liberaEm, setLiberaEm] = useState(0);
  const [, setTique] = useState(0);
  const segundos = segundosParaReenviar(liberaEm);

  useEffect(() => {
    if (!segundos) return undefined;
    const t = setInterval(() => setTique((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [segundos > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async () => {
    setErro('');
    if (!celularValido(celular)) return setErro(MENSAGEM_TELEFONE_INVALIDO);
    setOcupado(true);
    try {
      const r = await chamar((token) => api.enviarCodigoDaConta(token, normalizarTelefone(celular)));
      setLiberaEm(Date.now() + (r?.reenviarEmSegundos ?? REENVIO_SEGUNDOS) * 1000);
      setEtapa('codigo');
    } catch (e) {
      const r = interpretarErroCelular(e);
      if (r.segundos) setLiberaEm(Date.now() + r.segundos * 1000);
      setErro(r.mensagem);
    } finally {
      setOcupado(false);
    }
  };

  const verificar = async (valor = codigo) => {
    if (!codigoCompleto(valor)) return setErro('O código tem 6 números.');
    setErro('');
    setOcupado(true);
    try {
      const r = await chamar((token) => api.verificarTelefoneDaConta(token, { telefone: normalizarTelefone(celular), codigo: valor }));
      aoVerificar?.(r.cliente);
    } catch (e) {
      setErro(e?.codigo === 'TELEFONE_EM_USO' ? e.message : interpretarErroCelular(e).mensagem);
      setOcupado(false);
    }
  };

  if (!aberto) {
    return (
      <View style={s.faixa}>
        <Text style={s.texto}>{TEXTO_CAMPANHA}</Text>
        <Botao titulo="Verificar" variante="secundario" onPress={() => setAberto(true)} />
      </View>
    );
  }

  return (
    <View style={s.faixa}>
      <Text style={s.texto}>{TEXTO_CAMPANHA}</Text>
      {etapa === 'numero' ? (
        <>
          <Campo
            rotulo="Celular"
            value={celular}
            onChangeText={(t) => setCelular(mascararTelefone(t))}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="(43) 99999-0000"
          />
          <TextoErro>{erro}</TextoErro>
          <Botao titulo="Enviar código" onPress={enviar} carregando={ocupado} desabilitado={segundos > 0} bloco estilo={{ marginTop: 8 }} />
        </>
      ) : (
        <>
          <Text style={s.nota}>{`Digite o código enviado para ${celular}.`}</Text>
          <Campo
            rotulo="Código"
            value={codigo}
            onChangeText={(t) => {
              const limpo = limparCodigo(t);
              setCodigo(limpo);
              if (codigoCompleto(limpo)) verificar(limpo);
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
          />
          <TextoErro>{erro}</TextoErro>
          <Botao titulo="Confirmar" onPress={() => verificar()} carregando={ocupado} bloco estilo={{ marginTop: 8 }} />
          <Botao titulo={textoReenvio(segundos)} variante="texto" onPress={enviar} desabilitado={segundos > 0 || ocupado} />
          <Botao titulo="Trocar número" variante="texto" onPress={() => setEtapa('numero')} />
        </>
      )}
      <Botao titulo="Agora não" variante="texto" onPress={() => setAberto(false)} />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    faixa: {
      marginTop: 12,
      padding: 14,
      gap: 8,
      borderRadius: t.raio.normal,
      borderWidth: 1,
      borderColor: t.cores.acao,
      backgroundColor: t.cores.superficie,
    },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.texto, fontWeight: t.fontes.peso.forte },
    nota: { fontSize: t.fontes.tamanho.pequeno, color: t.cores.textoSuave },
  });
