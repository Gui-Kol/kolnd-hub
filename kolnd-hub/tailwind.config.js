/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        // TVs 4K / monitores grandes (≥ 1920 px) — tipografia e alvos maiores.
        '3xl': '1920px'
      },
      fontFamily: {
        // 13.5: Inter empacotada offline (OFL) — única família; fallback system preservado
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'] // 13.5: antes era "Segoe UI"
      },
      colors: {
        kloud: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          900: '#7c2d12'
        },
        nintendo: {
          500: '#e60012',
          600: '#b3000d',
          // Tom acessível para texto/ícones pequenos sobre fundo escuro (≥ 4.5:1) — ver docs/a11y-contrast-audit.md
          400: '#ff6b6b'
        },
        playstation: {
          500: '#004ea2',
          600: '#003d80',
          glow: 'rgba(0, 78, 162, 0.35)',
          // Tons acessíveis: 300 para texto pequeno (≥ 4.5:1), 400 para ícones/estados (≥ 3:1 com folga)
          300: '#5e9eff',
          400: '#4da3ff'
        },
        steam: {
          900: '#0b1d29',
          800: '#112734',
          500: '#171a21',
          blue: '#0568e5',
          blueDark: '#0457c4',
          // Tom acessível para texto pequeno sobre fundo escuro (≥ 4.5:1)
          'blue-light': '#6ba3ff'
        },
        neon: {
          cyan: '#00f3ff',
          purple: '#bc13fe',
          magenta: '#ff00ff',
          green: '#0aff0a',
          // Tom acessível para textos pequenos (badges/labels) sobre fundo escuro (≥ 4.5:1)
          'purple-light': '#d06bff'
        },
        slate: {
          950: '#020617',
          900: '#0f172a'
        },
        // Tokens de texto acessível (WCAG AA) para legendas e metadados — ver docs/a11y-contrast-audit.md
        muted: '#cbd5e1', // slate-300 — ≥ 11.5:1 sobre os fundos do tema
        subtle: '#94a3b8' // slate-400 — ≥ 6.7:1 sobre os fundos do tema
      },
      backgroundImage: {
        'gradient-gaming': 'linear-gradient(135deg, #0b1d29 0%, #0a0a0f 50%, #1a1014 100%)',
        'gradient-kloud': 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
        'gradient-nintendo': 'linear-gradient(135deg, #e60012 0%, #b3000d 100%)',
        'gradient-playstation': 'linear-gradient(135deg, #004ea2 0%, #0568e5 100%)',
        'gradient-steam': 'linear-gradient(135deg, #0b1d29 0%, #171a21 100%)',
        // Parada playstation elevada (#004ea2 → #2e7ce6) para o gradiente de texto atingir ≥ 3:1
        // mesmo na pior parada, nos títulos grandes/bold que usam `gradient-rainbow` (AA texto grande).
        'gradient-rainbow': 'linear-gradient(45deg, #e60012, #2e7ce6, #00f3ff, #bc13fe, #e60012)'
      },
      boxShadow: {
        'glow-cyan': '0 0 30px -8px rgba(0, 243, 255, 0.35)',
        'glow-purple': '0 0 30px -8px rgba(188, 19, 254, 0.35)',
        'glow-red': '0 0 30px -8px rgba(230, 0, 18, 0.35)',
        'glow-blue': '0 0 30px -8px rgba(0, 78, 162, 0.35)',
        'glow-orange': '0 0 30px -8px rgba(249, 115, 22, 0.35)',
        'inner-glass': 'inset 0 0 20px -5px rgba(255, 255, 255, 0.03)'
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
        float: 'float 6s ease-in-out infinite',
        scanline: 'scanline 10s linear infinite'
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 20px -10px var(--glow-color, rgba(99, 102, 241, 0.3))' },
          '100%': { boxShadow: '0 0 40px -5px var(--glow-color, rgba(99, 102, 241, 0.5))' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        }
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px'
      }
    }
  },
  plugins: []
}
