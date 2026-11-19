import { EmBreve } from '../../componentes/EmBreve.js';

// Histórico (GET /cliente/pedidos) e "Repetir pedido" entram com o login, no próximo passo.
export default function Pedidos() {
  return <EmBreve titulo="Pedidos" icone="receipt-outline" texto="Seus pedidos vão aparecer aqui depois que você entrar com sua conta." />;
}
