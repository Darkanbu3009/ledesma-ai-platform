/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: '#0F0F11',
        grafito: { DEFAULT: '#1A1A1F', border: '#2A2A30' },
        hueso: { DEFAULT: '#F2EFE9', muted: '#A8A29A' },
        brasa: { DEFAULT: '#E5562A', hover: '#F2683C' },
      },
      fontFamily: {
        display: ['Archivo', 'sans-serif'],
        sans: ['"Hanken Grotesk"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
