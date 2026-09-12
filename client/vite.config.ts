import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devTarget = process.env.DEV_SERVER_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/socket.io': { target: devTarget, ws: true },
      '/api': { target: devTarget, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/socket.io': { target: devTarget, ws: true },
      '/api': { target: devTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
