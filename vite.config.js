import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' makes asset paths relative so the built files load correctly when
// Electron opens them via file:// in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },
});
