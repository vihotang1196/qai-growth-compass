import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // 本地开发时把 /api 打到 Vercel dev 或线上,保持与生产同源(D1)
    proxy: process.env.VITE_API_PROXY
      ? { '/api': { target: process.env.VITE_API_PROXY, changeOrigin: true } }
      : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // 不外泄源码结构
  },
});
