import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // El plugin de React habilita el transform de JSX/TSX para los tests de componentes. Los tests de
  // logica pura siguen en entorno `node`; los de componentes declaran `// @vitest-environment jsdom`.
  plugins: [react()],
  test: {
    environment: 'node',
    passWithNoTests: true,
    // Deja i18next inicializado (y en espanol) antes de cada archivo de tests: ver el propio setup.
    setupFiles: ['./test/setup.i18n.ts'],
  },
});
