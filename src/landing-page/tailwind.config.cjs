const defaultTheme = require("tailwindcss/defaultTheme");

module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,svelte,ts,tsx,vue}"],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Montserrat", ...defaultTheme.fontFamily.sans],
        display: ["Montserrat", ...defaultTheme.fontFamily.sans],
        script: ["Caveat Brush", "Kalam", "cursive"],
      },
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        alberti: {
          50: "var(--alberti-red-50)",
          100: "var(--alberti-red-100)",
          200: "var(--alberti-red-200)",
          300: "var(--alberti-red-300)",
          400: "var(--alberti-red-400)",
          500: "var(--alberti-red-500)",
          600: "var(--alberti-red-600)",
          700: "var(--alberti-red-700)",
          800: "var(--alberti-red-800)",
          900: "var(--alberti-red-900)",
        },
        ink: {
          50: "var(--alberti-ink-50)",
          100: "var(--alberti-ink-100)",
          200: "var(--alberti-ink-200)",
          300: "var(--alberti-ink-300)",
          400: "var(--alberti-ink-400)",
          500: "var(--alberti-ink-500)",
          600: "var(--alberti-ink-600)",
          700: "var(--alberti-ink-700)",
          800: "var(--alberti-ink-800)",
          900: "var(--alberti-ink-900)",
        },
      },
      textColor: {
        default: "var(--color-text)",
        offset: "var(--color-text-offset)",
      },
      backgroundColor: {
        default: "var(--color-background)",
        offset: "var(--color-background-offset)",
      },
      borderColor: {
        default: "var(--color-border)",
      },
    },
  },
  corePlugins: {
    fontSize: false,
  },
  plugins: [require("tailwindcss-fluid-type")],
};
