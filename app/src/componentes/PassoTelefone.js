import { useState } from 'react';
import { View } from 'react-native';
import { mascararTelefone, normalizarTelefone, MENSAGEM_TELEFONE_INVALIDO } from '@restaurante/shared/telefone';
import { useCliente } from '../estado/Cliente.js';
import { errosPorCampo } from '../logica/checkout.js';
import { Botao } from './basicos.js';
import { Campo, TextoErro, Titulo } from './formulario.js';

/**
 * Nome e telefone (obrigatório para pedir). No checkout no primeiro login e no
 * Perfil. `onCancelar` só quando já existe telefone salvo.
 */
export function PassoTelefone({
  onSalvo,
  onCancelar,
  titulo = 'Seu telefone',
  texto = 'Obrigatório para a entrega: é por ele que falamos com você sobre o pedido.',
  rotuloBotao = 'Salvar e continuar',
}) {
  const { cliente, atualizarPerfil } = useCliente();
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [telefone, setTelefone] = useState(mascararTelefone(cliente?.telefone ?? ''));
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const novos = {};
    if (!nome.trim()) novos.nome = 'Informe seu nome';
    if (!normalizarTelefone(telefone)) novos.telefone = MENSAGEM_TELEFONE_INVALIDO;
    setErros(novos);
    if (Object.keys(novos).length) return;
    setSalvando(true);
    try {
      await atualizarPerfil({ nome: nome.trim(), telefone: normalizarTelefone(telefone) });
      onSalvo?.();
    } catch (erro) {
      setErros(errosPorCampo(erro));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <View>
      <Titulo subtitulo={texto}>{titulo}</Titulo>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} maxLength={100} autoComplete="name" textContentType="name" erro={erros.nome} />
      <Campo
        rotulo="Celular com DDD"
        value={telefone}
        onChangeText={(t) => setTelefone(mascararTelefone(t))}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="(43) 99999-0000"
        erro={erros.telefone}
        returnKeyType="done"
        onSubmitEditing={salvar}
      />
      <TextoErro>{erros.geral}</TextoErro>
      <Botao titulo={salvando ? 'Salvando…' : rotuloBotao} onPress={salvar} carregando={salvando} bloco estilo={{ marginTop: 16 }} />
      {onCancelar && <Botao titulo="Cancelar" variante="texto" onPress={onCancelar} bloco estilo={{ marginTop: 4 }} />}
    </View>
  );
}
