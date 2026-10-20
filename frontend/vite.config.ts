import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_DEV_API ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/uploads': api,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
