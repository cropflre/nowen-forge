import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const WEB_DEV_PORT = 18666;
const API_DEV_PORT = 18667;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: WEB_DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_DEV_PORT}`,
        changeOrigin: true
      }
    }
  }
});
