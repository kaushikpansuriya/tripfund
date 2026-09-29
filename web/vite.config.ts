import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs on :4000; the browser only talks to Vite.
    proxy: { '/api': 'http://localhost:4000' },
    // The calculation engine lives in ../packages/engine and is shared with the API.
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: true },
});
