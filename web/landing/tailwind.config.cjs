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
        socia: {
          50: "var(--socia-red-50)",
          100: "var(--socia-red-100)",
          200: "var(--socia-red-200)",
          300: "var(--socia-red-300)",
          400: "var(--socia-red-400)",
          500: "var(--socia-red-500)",
          600: "var(--socia-red-600)",
          700: "var(--socia-red-700)",
          800: "var(--socia-red-800)",
          900: "var(--socia-red-900)",
        },
        ink: {
          50: "var(--socia-ink-50)",
          100: "var(--socia-ink-100)",
          200: "var(--socia-ink-200)",
          300: "var(--socia-ink-300)",
          400: "var(--socia-ink-400)",
          500: "var(--socia-ink-500)",
          600: "var(--socia-ink-600)",
          700: "var(--socia-ink-700)",
          800: "var(--socia-ink-800)",
          900: "var(--socia-ink-900)",
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
