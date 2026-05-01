import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Backend URL can be overridden via environment variable
// This allows dynamic port discovery when the server allocates ports automatically
const backendUrl = process.env.LOXIA_BACKEND_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.{test,spec}.{js,jsx}']
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true
      },
      // Also proxy WebSocket connections
      '/ws': {
        target: backendUrl.replace('http://', 'ws://').replace('https://', 'wss://'),
        ws: true
      }
    }
  },
  build: {
    outDir: 'build',
    assetsDir: 'static'
  }
});