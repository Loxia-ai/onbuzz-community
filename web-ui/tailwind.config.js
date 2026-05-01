/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gray': {
          50:  'rgb(var(--gray-50) / <alpha-value>)',
          100: 'rgb(var(--gray-100) / <alpha-value>)',
          200: 'rgb(var(--gray-200) / <alpha-value>)',
          300: 'rgb(var(--gray-300) / <alpha-value>)',
          400: 'rgb(var(--gray-400) / <alpha-value>)',
          500: 'rgb(var(--gray-500) / <alpha-value>)',
          600: 'rgb(var(--gray-600) / <alpha-value>)',
          700: 'rgb(var(--gray-700) / <alpha-value>)',
          800: 'rgb(var(--gray-800) / <alpha-value>)',
          900: 'rgb(var(--gray-900) / <alpha-value>)',
          950: 'rgb(var(--gray-950) / <alpha-value>)',
        },
        'loxia': {
          50:  'rgb(var(--loxia-50) / <alpha-value>)',
          100: 'rgb(var(--loxia-100) / <alpha-value>)',
          200: 'rgb(var(--loxia-200) / <alpha-value>)',
          300: 'rgb(var(--loxia-300) / <alpha-value>)',
          400: 'rgb(var(--loxia-400) / <alpha-value>)',
          500: 'rgb(var(--loxia-500) / <alpha-value>)',
          600: 'rgb(var(--loxia-600) / <alpha-value>)',
          700: 'rgb(var(--loxia-700) / <alpha-value>)',
          800: 'rgb(var(--loxia-800) / <alpha-value>)',
          900: 'rgb(var(--loxia-900) / <alpha-value>)',
        },
        'agent': {
          'active': '#10b981',
          'paused': '#f59e0b',
          'error': '#ef4444',
          'idle': '#6b7280'
        },
        'task': {
          'completed':    'rgb(var(--task-completed) / <alpha-value>)',
          'completed-bg': 'rgb(var(--task-completed-bg) / <alpha-value>)',
          'blocked':      'rgb(var(--task-blocked) / <alpha-value>)',
          'blocked-bg':   'rgb(var(--task-blocked-bg) / <alpha-value>)',
        }
      },
      fontFamily: {
        'mono': ['Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounce 2s infinite',
        // Indeterminate progress strip — slides a 1/3-width chunk
        // across the bar repeatedly. Used on FlowCard when a run is
        // alive but no nodes have started yet (queued, or no flow def
        // to compute total against). Slow enough to feel calm, not
        // jittery; fast enough to feel responsive.
        'progress-shimmer': 'progress-shimmer 1.6s linear infinite',
      },
      keyframes: {
        // Slides from off-screen-left to off-screen-right. The element
        // it animates is sized w-1/3, so this gives the classic
        // indeterminate-bar feel.
        'progress-shimmer': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}