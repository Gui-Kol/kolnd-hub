/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)'
        },
        surface: {
          base: 'var(--bg-base)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          muted: 'var(--accent-muted)'
        }
      }
    }
  },
  plugins: []
}
