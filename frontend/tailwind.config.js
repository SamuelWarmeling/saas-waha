/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f9f5ff',
          100: '#f0e6ff',
          200: '#e2cfff',
          300: '#c9a6f0',
          400: '#b07de6',
          500: '#9D4EDD',
          600: '#8435c7',
          700: '#6A0DAD',
          800: '#520989',
          900: '#3d0766',
          950: '#220340',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#3d3058',
          700: '#2d2244',
          800: '#1A1625',
          900: '#120e1e',
          950: '#0B0914',
        },
        'bg-base': '#0B0914',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}
