import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 管理后台构建配置：
// - 路径别名 @ -> src；
// - VITE_USE_MOCK=true（默认）时 api 层走内置 mock 适配层，无需后端即可联调页面；
// - 置 false 后所有 /api 请求经代理转发真实后端（架构 §11：admin.linban.xxx → api）。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // echarts 体积大，单独分包避免首屏拖慢
        manualChunks: {
          echarts: ['echarts'],
          antd: ['antd', '@ant-design/icons'],
        },
      },
    },
  },
});
