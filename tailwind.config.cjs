const path = require('path');

// Colors reference CSS custom properties declared in client/src/styles/_tokens.scss,
// so the palette is defined once and shared by Tailwind utilities and SCSS.
const scale = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [
      step,
      `rgb(var(--color-${name}-${step}) / <alpha-value>)`,
    ])
  );

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.join(__dirname, 'client/index.html'), path.join(__dirname, 'client/src/**/*.{js,jsx}')],
  theme: {
    extend: {
      colors: {
        brand: scale('brand'),
        ink: scale('ink'),
        success: scale('success'),
        danger: scale('danger'),
        warning: scale('warning'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.05), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        pop: '0 12px 24px -4px rgb(16 24 40 / 0.12), 0 4px 8px -2px rgb(16 24 40 / 0.06)',
      },
    },
  },
  plugins: [],
};
