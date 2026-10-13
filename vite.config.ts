import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Relative base so the same build works from a web host, from Electron's app:// protocol and inside the Android WebView.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  server: { host: true },
});
