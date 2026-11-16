import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A API serve o build em /admin (mesmo domínio: sem CORS). Em dev, as rotas
// usadas pela retaguarda vão para a API local pelo proxy.
const API_LOCAL = process.env.API_LOCAL ?? 'http://localhost:3000';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/auth': API_LOCAL, '/usuarios': API_LOCAL, '/retaguarda': API_LOCAL },
  },
});
