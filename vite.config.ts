import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径：GitHub Pages 的子目录部署、Capacitor 的本地加载都能直接用
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // 门槛压低一点，方便尽早发现体积失控
    chunkSizeWarningLimit: 300,
  },
  server: {
    host: true, // 让同一网络下的手机能打开
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
