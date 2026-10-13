import { defineConfig } from 'vite';

// Relative base so the same build works from a web host, from Electron's app:// protocol and inside the Android WebView.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  server: { host: true },
});
