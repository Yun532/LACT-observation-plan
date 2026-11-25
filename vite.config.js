import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// 网站根目录的 index.html 是新版公开页（public/index.html，由 LACT 工作台 build.py --public 生成，原样复制）。
// 旧版观测规划台从 plan.html 构建。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { input: { plan: fileURLToPath(new URL('./plan.html', import.meta.url)) } },
  },
});
