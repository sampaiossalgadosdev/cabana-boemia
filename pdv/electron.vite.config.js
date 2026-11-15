import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * CSP do renderer. Em dev o React Refresh injeta um script inline e o Vite
 * usa WebSocket para o HMR; em produção só 'self'. O renderer não fala com
 * a API (quem fala é o main), então connect-src fica fechado em produção.
 */
function csp() {
  return {
    name: 'pdv-csp',
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server);
      const politica = [
        "default-src 'self'",
        `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self'${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${politica}" />`);
    },
  };
}

export default defineConfig({
  main: {
    // socket.io-client fica em node_modules (empacotado pelo electron-builder).
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        // Preload com sandbox precisa ser CommonJS (.cjs, porque o pacote é "type": "module").
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), csp()],
  },
});
