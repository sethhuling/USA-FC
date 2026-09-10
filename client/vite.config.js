import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
    // The client imports the shared server/config/coverage.json, which sits
    // outside the client root — allow the dev server to serve it.
    fs: { allow: ['..'] },
  },
});
