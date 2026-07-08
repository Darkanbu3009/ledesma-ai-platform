/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tema claro de la consola, alineado con la landing publica.
        cream: '#F5F4EF', // fondo de pagina
        sidebar: '#FCFBF8', // fondo del sidebar
        surface: '#FFFFFF', // tarjetas y superficies
        field: '#FBFAF7', // campos (inputs, selects, textarea)
        line: { DEFAULT: '#E4E2DB', soft: '#EFEEE8' }, // bordes
        ink: { DEFAULT: '#1F1E1C', soft: '#46443F' }, // texto principal
        muted: { DEFAULT: '#6B6A66', soft: '#8A8984' }, // texto secundario / terciario
        brasa: {
          DEFAULT: '#E5511E',
          hover: '#C94317',
          active: '#B23E14', // brasa oscuro: estado presionado de los botones planos
          soft: 'rgba(229,81,30,0.10)',
          line: 'rgba(229,81,30,0.26)',
        },
        ok: '#3F9D54',
        // Acentos por proveedor (badges / iconos / barra de tarjeta).
        anthropic: { DEFAULT: '#C2570C', soft: 'rgba(194,87,12,0.10)', line: 'rgba(194,87,12,0.26)' },
        openai: { DEFAULT: '#10806A', soft: 'rgba(16,128,106,0.10)', line: 'rgba(16,128,106,0.26)' },
        oss: { DEFAULT: '#5E8A50', soft: 'rgba(94,138,80,0.12)', line: 'rgba(94,138,80,0.30)' },

        // Tokens heredados re-mapeados al tema claro. Las vistas que aun no se
        // rediseñaron (Playground, Conectar, Uso, Login y dialogos) los usan y
        // asi quedan legibles sobre el fondo claro sin tocar su markup.
        carbon: '#F5F4EF',
        grafito: { DEFAULT: '#FFFFFF', border: '#E4E2DB' },
        hueso: { DEFAULT: '#1F1E1C', muted: '#6B6A66' },

        // Tokens de la landing publica (portada del showroom). Expuestos como canales RGB en
        // custom properties (ver src/index.css) para que `rgb(var(--x) / <alpha-value>)`
        // conserve el modificador de opacidad de Tailwind (bg-accent/10, etc.). La consola es
        // light-only: las --ll-* solo tienen el valor del tema claro. Aditivo: no toca los
        // tokens de arriba (cream, brasa, ink, etc.) que usa el resto de la consola.
        background: {
          DEFAULT: 'rgb(var(--ll-bg) / <alpha-value>)',
          secondary: 'rgb(var(--ll-bg-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--ll-bg-tertiary) / <alpha-value>)',
        },
        foreground: {
          DEFAULT: 'rgb(var(--ll-fg) / <alpha-value>)',
          secondary: 'rgb(var(--ll-fg-secondary) / <alpha-value>)',
        },
        border: 'rgb(var(--ll-border) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--ll-accent) / <alpha-value>)',
          hover: 'rgb(var(--ll-accent-hover) / <alpha-value>)',
        },
        success: 'rgb(var(--ll-success) / <alpha-value>)',
        ring: 'rgb(var(--ll-accent) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Archivo', 'sans-serif'],
        sans: ['"Hanken Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        // Alias de fuente de la landing (aditivos): cuerpo en Hanken Grotesk y
        // eyebrows/codigo en JetBrains Mono. Los headings reusan `display` (Archivo).
        grotesk: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        jetbrains: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,30,28,0.04)',
        'card-hover': '0 14px 32px rgba(31,30,28,0.10)',
        brasa: '0 6px 16px rgba(229,81,30,0.20)',
      },
    },
  },
  plugins: [],
};
