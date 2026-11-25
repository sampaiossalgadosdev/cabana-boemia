import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { pinValido } from '@restaurante/shared/mapa';
import { useCliente } from '../estado/Cliente.js';
import * as api from '../lib/api.js';
import { formatarPreco } from '../logica/dinheiro.js';
import { errosPorCampo, validarEndereco } from '../logica/checkout.js';
import { corpoDoEndereco, mudouOLugar, pinDoEndereco } from '../logica/mapa.js';
import { Botao } from './basicos.js';
import { Campo, Opcao, TextoErro, Titulo } from './formulario.js';
import { MapaPino, temMapa } from './MapaPino.js';

/**
 * Endereço novo (POST) ou edição (`endereco` presente → PUT, sem mexer no
 * "principal"). Usado no checkout (bairros onde a loja entrega, com a taxa
 * dela) e no Perfil (bairros da cidade, sem taxa: o endereço vale para qualquer loja).
 *
 * Pino no mapa (quando o build tem mapa): o texto é obrigatório e é o que a pessoa
 * escreveu; o pino é a posição exata. Mudar rua, número ou bairro apaga o pino
 * marcado (apontaria para o lugar antigo). Salvar sem pino busca uma vez e pede
 * para conferir, sem bloquear ("Salvar sem marcar no mapa").
 */
export function FormEndereco({ bairros, endereco = null, titulo, onSalvo, onCancelar }) {
  const { chamar } = useCliente();
  const comMapa = useMemo(() => temMapa(), []);
  const bairroAtivo = endereco && bairros.some((b) => b.id === endereco.bairro.id);
  const [dados, setDados] = useState({
    rua: endereco?.rua ?? '',
    numero: endereco?.numero ?? '',
    complemento: endereco?.complemento ?? '',
    referencia: endereco?.referencia ?? '',
    bairroId: bairroAtivo ? endereco.bairro.id : null,
  });
  const [pino, setPino] = useState(pinDoEndereco(endereco));
  // Rua/número/bairro de quando o pino foi marcado (mudou = o pino deixa de valer).
  const [lugarDoPino, setLugarDoPino] = useState(pinDoEndereco(endereco) ? { ...dados } : null);
  const [conferindoPino, setConferindoPino] = useState(false);
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);

  const mudar = (campo) => (valor) => {
    const novos = { ...dados, [campo]: valor };
    setDados(novos);
    if (pino && mudouOLugar(lugarDoPino, novos)) {
      setPino(null);
      setLugarDoPino(null);
    }
  };
  const marcarPino = (p) => {
    setPino(p);
    setLugarDoPino(p ? { ...dados } : null);
  };

  /** Busca do texto digitado no mapa (o bairro vai pelo id; a cidade, pelo servidor). */
  const buscarNoMapa = async () => {
    const faltando = validarEndereco(dados);
    if (Object.keys(faltando).length) {
      setErros(faltando);
      throw new Error('Preencha a rua, o número e o bairro para buscar no mapa.');
    }
    return chamar((token) => api.geocodificarEndereco(token, dados));
  };

  const salvar = async ({ semPino = false } = {}) => {
    const novos = validarEndereco(dados);
    setErros(novos);
    if (Object.keys(novos).length) return;
    // Sem pino e com mapa: primeiro pede para conferir no mapa (uma vez; não bloqueia).
    if (comMapa && !pinValido(pino) && !semPino && !conferindoPino) {
      setConferindoPino(true);
      return;
    }
    setSalvando(true);
    try {
      const corpo = corpoDoEndereco(dados, pino);
      const r = endereco
        ? await chamar((token) => api.atualizarEndereco(token, endereco.id, corpo))
        : await chamar((token) => api.criarEndereco(token, corpo));
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
      {bairros.length === 0 && <TextoErro>Nenhum bairro disponível no momento.</TextoErro>}
      {bairros.map((b) => (
        <Opcao
          key={b.id}
          titulo={b.nome}
          detalhe={Number.isInteger(b.taxaCentavos) ? `Entrega ${formatarPreco(b.taxaCentavos)}` : undefined}
          marcada={dados.bairroId === b.id}
          onPress={() => mudar('bairroId')(b.id)}
        />
      ))}
      {endereco && !bairroAtivo && <TextoErro>{`O bairro ${endereco.bairro.nome} não está disponível. Escolha outro bairro.`}</TextoErro>}
      <TextoErro>{erros.bairroId}</TextoErro>
      <Campo rotulo="Complemento (opcional)" value={dados.complemento} onChangeText={mudar('complemento')} maxLength={120} />
      <Campo rotulo="Ponto de referência (opcional)" value={dados.referencia} onChangeText={mudar('referencia')} maxLength={200} />

      {comMapa && (
        <>
          <Text style={{ marginTop: 16, fontWeight: '700' }}>Onde fica no mapa</Text>
          {conferindoPino && !pinValido(pino) ? (
            <TextoErro>Marque no mapa onde fica a sua porta: ajuda a entrega a chegar certinho.</TextoErro>
          ) : null}
          <MapaPino key={conferindoPino ? 'conferir' : 'mapa'} pino={pino} aoMudar={marcarPino} aoBuscar={buscarNoMapa} buscarAoAbrir={conferindoPino} />
        </>
      )}

      <TextoErro>{erros.geral ?? erros.latitude}</TextoErro>
      <Botao titulo={salvando ? 'Salvando…' : 'Salvar endereço'} onPress={() => salvar()} carregando={salvando} bloco estilo={{ marginTop: 16 }} />
      {conferindoPino && !pinValido(pino) && (
        <Botao titulo="Salvar sem marcar no mapa" variante="texto" onPress={() => salvar({ semPino: true })} bloco estilo={{ marginTop: 4 }} />
      )}
      {onCancelar && <Botao titulo="Cancelar" variante="texto" onPress={onCancelar} bloco estilo={{ marginTop: 4 }} />}
    </View>
  );
}
