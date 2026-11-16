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
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // fontFamily.mono intencionalmente NÃO definido — usa o stack mono default do Tailwind (input-gamer)
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      colors: {
        // ── Tokens semânticos 13.2/13.4 (valores em :root, index.css) ──
        surface: {
          base: 'var(--bg-base)',
          sunken: 'var(--bg-sunken)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)'
        },
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          contrast: 'var(--accent-contrast)',
          muted: 'var(--accent-muted)',
          border: 'var(--accent-border)'
        },
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-muted)',
          border: 'var(--success-border)'
        },
        warn: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-muted)',
          border: 'var(--warning-border)'
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg: 'var(--danger-muted)',
          border: 'var(--danger-border)'
        },
        'focus-ring': 'var(--focus-ring)',

        // ── @deprecated — marcas/legado: saem em 13.7–13.18 junto com a migração
        //    das telas. NÃO usar em código novo. (13.4 §8: cores kloud/nintendo/
        //    playstation/steam/neon não entram em classes recém-criadas.) ──
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
        // @deprecated(13.16) — BigPicture.tsx (bg-gradient-gaming) ainda usa;
        // sai com o rebuild do backdrop do Big Picture (13.16).
        'gradient-gaming': 'linear-gradient(135deg, #0b1d29 0%, #0a0a0f 50%, #1a1014 100%)'
        // Removidos no 13.4 (§8 "o que sai"): gradient-kloud / gradient-nintendo /
        // gradient-playstation / gradient-steam / gradient-rainbow —
        // nenhum uso vivo confirmado (classes `gradient-rainbow` no código são
        // referências mortas, nunca geradas pelo Tailwind; ver relatório 13.4).
      },
      boxShadow: {
        // ── Elevação 13.2/13.4: fria, curta — sem glow ──
        'elevation-1': 'var(--shadow-sm)',
        'elevation-2': 'var(--shadow-md)',
        'elevation-3': 'var(--shadow-lg)',
        highlight: 'var(--highlight)',

        // ── @deprecated(13.7+) — glow gamer: sai com a migração das telas.
        //    Usos vivos mapeados em 13.4 (AppCard, BigPicture*, Dashboard,
        //    Inicializacao, LoadingScreen, Sidebar, Layout, PcUpdates, Settings,
        //    FirstRunInstall, App/AppDetailModal). NÃO usar em código novo. ──
        'glow-cyan': '0 0 30px -8px rgba(0, 243, 255, 0.35)',
        'glow-purple': '0 0 30px -8px rgba(188, 19, 254, 0.35)',
        'glow-red': '0 0 30px -8px rgba(230, 0, 18, 0.35)',
        'glow-blue': '0 0 30px -8px rgba(0, 78, 162, 0.35)',
        'glow-orange': '0 0 30px -8px rgba(249, 115, 22, 0.35)'
        // Removido no 13.4: inner-glass (.glass reimplementado sobre --surface-3/--border-subtle)
      },
      borderRadius: {
        // Raio único 13.2 §3: controles 10 · cards 12 · pills full.
        sm: 'var(--radius-sm)', // 8px (chips/kbd/selos)
        control: 'var(--radius-control)', // 10px — botões/inputs/toggles
        card: 'var(--radius-card)', // 12px — cards/painéis/modais
        pill: 'var(--radius-pill)', // full
        // @deprecated — aliases de migração (13.4): valores antigos apontavam para
        // 12/16/24px; agora todos = card (12px). Remover ao fim da seção 13.
        xl: 'var(--radius-card)', // era 12px
        '2xl': 'var(--radius-card)', // era 16px
        '3xl': 'var(--radius-card)' // era 24px
      },
      zIndex: {
        // Tokens 13.2 §3 — escala base do Tailwind (0–50) continua existindo
        rail: 'var(--z-rail)', // 30 — sidebar/rail
        chrome: 'var(--z-chrome)', // 40 — titlebar
        dropdown: 'var(--z-dropdown)', // 50 — dropdowns/popovers
        toast: 'var(--z-toast)', // 60 — toasts
        overlay: 'var(--z-overlay)', // 80 — busca/BP overlays
        modal: 'var(--z-modal)' // 100 — modais (backdrop = modal − 10)
      },
      transitionDuration: {
        // Motion 13.2 §3: 120/180/240/360 ms
        1: 'var(--motion-fast)', // 120 — hover/press/cor
        2: 'var(--motion-base)', // 180 — controles/toggle/badges
        3: 'var(--motion-slow)', // 240 — entrada de card/modal
        4: 'var(--motion-screen)' // 360 — transições de tela/BP
      },
      transitionTimingFunction: {
        // Easing padrão do sistema (13.2 §3)
        DEFAULT: 'var(--ease-out)',
        standard: 'var(--ease-out)'
      }
      // animation/keyframes removidos no 13.4: pulse-slow/glow/float/scanline não
      // eram usados como utilities do Tailwind (apenas classes custom no index.css,
      // que referenciam os keyframes default `pulse`).
    }
  },
  plugins: []
}
