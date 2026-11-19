import { useState } from 'react';
import { Text, View } from 'react-native';
import { useCliente } from '../estado/Cliente.js';
import * as api from '../lib/api.js';
import { formatarPreco } from '../logica/dinheiro.js';
import { errosPorCampo, validarEndereco } from '../logica/checkout.js';
import { Botao } from './basicos.js';
import { Campo, Opcao, TextoErro, Titulo } from './formulario.js';

/**
 * Endereço novo (POST) ou edição (`endereco` presente → PUT, sem mexer no
 * "principal"). Usado no checkout e no Perfil. Bairro só dos ativos, com a taxa.
 */
export function FormEndereco({ bairros, endereco = null, titulo, onSalvo, onCancelar }) {
  const { chamar } = useCliente();
  const bairroAtivo = endereco && bairros.some((b) => b.id === endereco.bairro.id);
  const [dados, setDados] = useState({
    rua: endereco?.rua ?? '',
    numero: endereco?.numero ?? '',
    complemento: endereco?.complemento ?? '',
    referencia: endereco?.referencia ?? '',
    bairroId: bairroAtivo ? endereco.bairro.id : null,
  });
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (valor) => setDados((d) => ({ ...d, [campo]: valor }));

  const salvar = async () => {
    const novos = validarEndereco(dados);
    setErros(novos);
    if (Object.keys(novos).length) return;
    setSalvando(true);
    try {
      const r = endereco
        ? await chamar((token) => api.atualizarEndereco(token, endereco.id, dados))
        : await chamar((token) => api.criarEndereco(token, dados));
      onSalvo(r.endereco);
    } catch (erro) {
      setErros(errosPorCampo(erro));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <View>
      <Titulo>{titulo ?? 'Endereço de entrega'}</Titulo>
      <Campo rotulo="Rua" value={dados.rua} onChangeText={mudar('rua')} maxLength={120} autoComplete="street-address" textContentType="streetAddressLine1" erro={erros.rua} />
      <Campo rotulo="Número" value={dados.numero} onChangeText={mudar('numero')} maxLength={20} keyboardType="numbers-and-punctuation" erro={erros.numero} />
      <Text style={{ marginTop: 12, fontWeight: '700' }}>Bairro</Text>
      {bairros.length === 0 && <TextoErro>Nenhum bairro de entrega cadastrado no momento.</TextoErro>}
      {bairros.map((b) => (
        <Opcao
          key={b.id}
          titulo={b.nome}
          detalhe={`Entrega ${formatarPreco(b.taxaCentavos)}`}
          marcada={dados.bairroId === b.id}
          onPress={() => mudar('bairroId')(b.id)}
        />
      ))}
      {endereco && !bairroAtivo && <TextoErro>{`Não entregamos mais em ${endereco.bairro.nome}. Escolha outro bairro.`}</TextoErro>}
      <TextoErro>{erros.bairroId}</TextoErro>
      <Campo rotulo="Complemento (opcional)" value={dados.complemento} onChangeText={mudar('complemento')} maxLength={120} />
      <Campo rotulo="Ponto de referência (opcional)" value={dados.referencia} onChangeText={mudar('referencia')} maxLength={200} />
      <TextoErro>{erros.geral}</TextoErro>
      <Botao titulo={salvando ? 'Salvando…' : 'Salvar endereço'} onPress={salvar} carregando={salvando} bloco estilo={{ marginTop: 16 }} />
      {onCancelar && <Botao titulo="Cancelar" variante="texto" onPress={onCancelar} bloco estilo={{ marginTop: 4 }} />}
    </View>
  );
}
