import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
// 固定開發伺服器 port，避免因為自動遞增導致 localStorage(origin) 變動而造成資料看起來"不見"。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true, // 若 5174 被占用直接報錯，而不是改用其他 port。
  },
});
