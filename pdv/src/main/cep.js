/**
 * Consulta de CEP no ViaCEP (https://viacep.com.br), feita no main: o
 * renderer não tem rede. Só o CEP sai da máquina. Devolve o endereço para
 * pré-preencher o cadastro; o bairro é só uma sugestão (a taxa vem do
 * bairro cadastrado na retaguarda, escolhido na lista).
 */

/** UF → nome do estado (o cadastro mostra "Paraná", não "PR"). */
export const ESTADOS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

const erro = (mensagem, codigo, status) => Object.assign(new Error(mensagem), { codigo, status });

/**
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [opcoes]
 * @returns {(cep: string) => Promise<{ cep: string, rua: string, bairro: string, cidade: string, estado: string }>}
 */
export function criarConsultaCep({ fetch: buscar = globalThis.fetch, timeoutMs = 6000 } = {}) {
  return async function consultarCep(cep) {
    const digitos = String(cep ?? '').replace(/\D/g, '');
    if (digitos.length !== 8) throw erro('CEP com 8 números', 'VALIDACAO', 400);
    let resposta;
    try {
      resposta = await buscar(`https://viacep.com.br/ws/${digitos}/json/`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw erro('Não foi possível consultar o CEP agora. Preencha o endereço à mão.', 'CEP_INDISPONIVEL', 503);
    }
    if (!resposta.ok) {
      throw erro('Não foi possível consultar o CEP agora. Preencha o endereço à mão.', 'CEP_INDISPONIVEL', 503);
    }
    const j = await resposta.json().catch(() => null);
    if (!j || j.erro) throw erro('CEP não encontrado', 'CEP_NAO_ENCONTRADO', 404);
    return {
      cep: digitos,
      rua: String(j.logradouro ?? ''),
      bairro: String(j.bairro ?? ''),
      cidade: String(j.localidade ?? ''),
      estado: ESTADOS[j.uf] ?? String(j.uf ?? ''),
    };
  };
}
