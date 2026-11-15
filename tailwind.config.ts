import type { Config } from 'tailwindcss';

// Все значения — ссылки на CSS-переменные из src/styles/tokens.css.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        surface: 'var(--surface)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        ink: 'var(--ink)',
        shelf: 'var(--shelf)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        sans: ['var(--font-ui)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        book: ['var(--font-book)', 'Georgia', 'serif'],
      },
      borderRadius: { pill: 'var(--radius-pill)' },
      minHeight: { touch: 'var(--touch)' },
      minWidth: { touch: 'var(--touch)' },
      screens: { xs: '480px' },
    },
  },
  plugins: [],
};

export default config;
