import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // Em desenvolvimento, redireciona chamadas /api para o servidor Express
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  // Em produção, gera os arquivos na pasta dist/
  build: {
    outDir: 'dist',
  },
});
