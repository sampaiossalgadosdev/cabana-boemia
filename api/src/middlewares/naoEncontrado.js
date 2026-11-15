export function naoEncontrado(req, res) {
  res.status(404).json({ erro: { mensagem: 'Rota não encontrada', codigo: 'NAO_ENCONTRADO' } });
}
