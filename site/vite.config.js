import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev, /publico e /cliente vão para a API local pelo proxy (sem CORS).
// Em produção, VITE_API_URL aponta para a API (ver .env.example).
const API_LOCAL = process.env.API_LOCAL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/publico': API_LOCAL, '/cliente': API_LOCAL },
  },
});
