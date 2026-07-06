/** @type {import('tailwindcss').Config} */

// All themeable colors point at CSS variables holding "R G B" triples so the
// theme system (src/services/ThemeService.js) can restyle the whole app while
// opacity modifiers like bg-pink-600/20 keep working. Defaults live in
// src/assets/tailwind.css.
const themeColor = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const themeScale = (prefix, shades) =>
  Object.fromEntries(shades.map((s) => [s, themeColor(`${prefix}-${s}`)]));

module.exports = {
  content: [
    "./src/**/*.{vue,js,ts,jsx,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        black: themeColor('black'),
        white: themeColor('white'),
        gray: themeScale('gray', [50, 100, 200, 300, 400, 500, 600, 700, 750, 800, 900]),
        pink: themeScale('accent', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
      },
    },
  },
  plugins: [],
}
