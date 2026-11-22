import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatarTelefone, mascararTelefone, normalizarTelefone } from '@restaurante/shared/telefone';
import { useCliente } from '../estado/Cliente.js';
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
import { useEstilos } from '../tema/tema.js';
import { Botao } from './basicos.js';
import { Campo, TextoErro } from './formulario.js';

/**
 * Entrar com celular: número (com máscara) → "Enviar código" → código de 6
 * dígitos (entra sozinho ao completar) → "Reenviar código" só depois de 60 s,
 * com contador. Só componentes do React Native (funciona no Expo Go). Depois
 * de entrar, o fluxo é o mesmo do Google (o pai some; o aceite e o nome vêm
 * por cima, se faltarem).
 * `podeContinuar()`: confere o aceite dos termos (a caixa da tela de entrada);
 * devolve false e mostra o aviso lá se não estiver marcada.
 */
export function EntrarComCelular({ podeContinuar, onVoltar }) {
  const s = useEstilos(criarEstilos);
  const { enviarCodigoTelefone, entrarComTelefone } = useCliente();
  const [etapa, setEtapa] = useState('numero'); // 'numero' | 'codigo'
  const [celular, setCelular] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erros, setErros] = useState({}); // { celular, codigo, geral }
  const [ocupado, setOcupado] = useState(null); // 'enviar' | 'entrar'
  const [liberaEm, setLiberaEm] = useState(0); // instante em que o reenvio libera
  const [, setTique] = useState(0);
  const campoCodigo = useRef(null);
  const segundos = segundosParaReenviar(liberaEm);

  // Contador do reenvio: redesenha a cada segundo enquanto falta tempo.
  useEffect(() => {
    if (segundos <= 0) return undefined;
    const t = setInterval(() => setTique((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [segundos > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (etapa === 'codigo') campoCodigo.current?.focus();
  }, [etapa]);

  const mostrarErro = (erro) => {
    const r = interpretarErroCelular(erro);
    if (r.esperarSegundos) setLiberaEm(Date.now() + r.esperarSegundos * 1000);
    setErros({ [r.campo]: r.mensagem });
    return r;
  };

  const enviar = async () => {
    if (ocupado || !podeContinuar()) return;
    if (!celularValido(celular)) return setErros({ celular: MENSAGEM_TELEFONE_INVALIDO });
    setErros({});
    setOcupado('enviar');
    try {
      const r = await enviarCodigoTelefone(normalizarTelefone(celular));
      setLiberaEm(Date.now() + (r?.reenviarEmSegundos ?? REENVIO_SEGUNDOS) * 1000);
      setCodigo('');
      setEtapa('codigo');
    } catch (erro) {
      // Já pediu há pouco (ex.: voltou para trocar o número e é o mesmo): o código de antes vale.
      if (mostrarErro(erro).esperarSegundos && erro?.codigo === 'AGUARDE_REENVIO') setEtapa('codigo');
    } finally {
      setOcupado(null);
    }
  };

  const entrar = async (valor = codigo) => {
    if (ocupado || !podeContinuar()) return;
    if (!codigoCompleto(valor)) return setErros({ codigo: 'Digite os 6 números do código.' });
    setErros({});
    setOcupado('entrar');
    try {
      await entrarComTelefone(normalizarTelefone(celular), valor);
      // sucesso: a tela de login some (status 'logado')
    } catch (erro) {
      if (mostrarErro(erro).campo === 'codigo') setCodigo('');
    } finally {
      setOcupado(null);
    }
  };

  const mudarCodigo = (texto) => {
    const limpo = limparCodigo(texto);
    setCodigo(limpo);
    if (erros.codigo) setErros({});
    if (codigoCompleto(limpo)) entrar(limpo);
  };

  if (etapa === 'numero') {
    return (
      <View style={s.bloco}>
        <Campo
          rotulo="Celular com DDD"
          value={celular}
          onChangeText={(t) => {
            setCelular(mascararTelefone(t));
            if (erros.celular) setErros({});
          }}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="(43) 99999-0000"
          erro={erros.celular}
          returnKeyType="send"
          onSubmitEditing={enviar}
          autoFocus
        />
        <TextoErro>{erros.geral}</TextoErro>
        <Botao titulo="Enviar código" onPress={enviar} carregando={ocupado === 'enviar'} bloco estilo={{ marginTop: 12 }} />
        <Botao titulo="Entrar de outro jeito" variante="texto" onPress={onVoltar} desabilitado={Boolean(ocupado)} bloco />
      </View>
    );
  }

  return (
    <View style={s.bloco}>
      <Text style={s.texto}>
        Digite o código de 6 números enviado para <Text style={s.forte}>{formatarTelefone(normalizarTelefone(celular))}</Text>.
      </Text>
      <Campo
        ref={campoCodigo}
        rotulo="Código"
        value={codigo}
        onChangeText={mudarCodigo}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        placeholder="000000"
        erro={erros.codigo}
        returnKeyType="done"
        onSubmitEditing={() => entrar()}
        editable={ocupado !== 'entrar'}
        estilo={{ marginTop: 4 }}
      />
      <TextoErro>{erros.geral}</TextoErro>
      <Botao titulo={ocupado === 'entrar' ? 'Entrando…' : 'Entrar'} onPress={() => entrar()} carregando={ocupado === 'entrar'} bloco estilo={{ marginTop: 12 }} />
      <Botao
        titulo={ocupado === 'enviar' ? 'Enviando…' : textoReenvio(segundos)}
        variante="secundario"
        onPress={enviar}
        desabilitado={segundos > 0 || Boolean(ocupado)}
        rotuloAcessivel={segundos > 0 ? `Reenviar código, liberado em ${segundos} segundos` : 'Reenviar código'}
        bloco
        estilo={{ marginTop: 8 }}
      />
      <Botao
        titulo="Trocar número"
        variante="texto"
        onPress={() => {
          setEtapa('numero');
          setCodigo('');
          setErros({});
        }}
        desabilitado={Boolean(ocupado)}
        bloco
      />
    </View>
  );
}

const criarEstilos = (t) =>
  StyleSheet.create({
    bloco: { marginTop: 4 },
    texto: { fontSize: t.fontes.tamanho.normal, color: t.cores.textoSuave, lineHeight: 21 },
    forte: { color: t.cores.texto, fontWeight: t.fontes.peso.forte },
  });
