import { defineConfig } from 'vite';

// El widget se distribuye como UN solo archivo iife (dist/ledesma-agent.js) que el backend
// sirve en /widget/. Sin css aparte: los estilos viven en el <style> del Shadow DOM.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['iife'],
      name: 'LedesmaAgent',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'ledesma-agent.js',
        assetFileNames: 'ledesma-agent.[ext]',
      },
    },
  },
});
