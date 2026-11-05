import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // GitHub Pages served di subpath /PolyHorde/ — WAJIB ada, aset tidak 404
  base: '/PolyHorde/',
  publicDir: false, // tidak ada aset statis — semuanya prosedural
  server: {
    port: 5173,
    open: true
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        }
      }
    }
  }
});
