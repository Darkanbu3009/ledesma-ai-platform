import { defineConfig } from 'vite';

// Libreria ESM (futuro paquete npm). React es peer dependency: react y react/jsx-runtime quedan
// external y el bundle solo contiene el wrapper. El script del widget (ledesma-agent.js, servido
// por la plataforma) se carga aparte: este paquete no lo incluye.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime'],
    },
  },
});
