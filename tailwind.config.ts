import type { Config } from 'tailwindcss';

/**
 * 所有值都指向 brutalist.css 里的 CSS 变量。
 * 这里不出现任何字面色值 —— 换皮只改 brutalist.css。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--qai-ink)',
        accent: 'var(--qai-accent)',
        'accent-fg': 'var(--qai-accent-fg)',
        paper: 'var(--qai-bg)',
        muted: 'var(--qai-bg-muted)',
        line: 'var(--qai-line)',
        'line-soft': 'var(--qai-line-soft)',
      },
      fontFamily: {
        head: 'var(--qai-font-head)',
        body: 'var(--qai-font-body)',
      },
      boxShadow: {
        brutal: 'var(--qai-shadow)',
        'brutal-sm': 'var(--qai-shadow-hover)',
        'brutal-lg': 'var(--qai-shadow-lg)',
        'brutal-none': 'var(--qai-shadow-none)',
      },
      borderWidth: {
        brutal: 'var(--qai-border-width)',
      },
      transitionDuration: {
        brutal: '100ms',
      },
    },
  },
  plugins: [],
} satisfies Config;
