import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read VITE_* vars (Supabase URL + anon key) from the project-root .env —
  // only VITE_-prefixed vars reach the bundle; server secrets never do.
  envDir: '..',
  server: {
    proxy: { '/api': 'http://localhost:8787' },
    // The client imports the shared server/config/coverage.json, which sits
    // outside the client root — allow the dev server to serve it.
    fs: { allow: ['..'] },
  },
});
