import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, /api vai para a API local pelo proxy (sem CORS). Em produção a
// própria API serve o build em / (mesmo domínio; ver .env.example).
const API_LOCAL = process.env.API_LOCAL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': API_LOCAL },
  },
});
