import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
