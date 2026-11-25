/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // SPEC-31: base neutra stone + verde root como acento de marca
        // (los nombres de clase se conservan — solo cambian los valores).
        root: { DEFAULT: '#2D5F3F', dark: '#244B32', light: '#7BA88E' },
        terra: '#C8553D',
        cream: '#F5F5F4',
        creamdark: '#E7E5E4',
        ocre: '#B45309',
        grafito: '#1C1917',
        warmgray: '#78716C',
        success: '#4A7C59',
        info: '#5B7B8F',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28, 25, 23, 0.05), 0 1px 3px rgba(28, 25, 23, 0.06)',
        lift: '0 4px 12px rgba(28, 25, 23, 0.08), 0 2px 4px rgba(28, 25, 23, 0.05)',
      },
      transitionTimingFunction: {
        brand: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
