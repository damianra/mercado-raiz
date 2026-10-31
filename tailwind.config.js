/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        root: { DEFAULT: '#2D5F3F', dark: '#244B32', light: '#7BA88E' },
        terra: '#C8553D',
        cream: '#F5F1E8',
        creamdark: '#E0DCD3',
        ocre: '#D4A574',
        grafito: '#2C2C2C',
        warmgray: '#8B8680',
        success: '#4A7C59',
        info: '#5B7B8F',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        soft: '0 2px 8px rgba(45, 95, 63, 0.08)',
        lift: '0 8px 24px rgba(45, 95, 63, 0.14)',
      },
      transitionTimingFunction: {
        brand: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
