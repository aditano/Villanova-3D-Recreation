import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/Villanova-3D-Recreation/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1600,
  },
}));
