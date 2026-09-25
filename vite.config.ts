import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the bundle works both on the web and inside the Capacitor WebView.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
} as never);
