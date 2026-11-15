/**
 * Erro de negócio com status HTTP. Lance em services/controllers e o
 * middleware central de erro transforma em resposta JSON.
 */
export class ErroHttp extends Error {
  /**
   * @param {number} status
   * @param {string} mensagem
   * @param {{ codigo?: string, detalhes?: unknown }} [extra]
   */
  constructor(status, mensagem, { codigo, detalhes } = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}
