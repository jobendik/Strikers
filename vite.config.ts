import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /<repo>/.
// Override with BASE_PATH env if the repository name differs.
const base = process.env.BASE_PATH ?? '/strikers/';

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          yuka: ['yuka'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
