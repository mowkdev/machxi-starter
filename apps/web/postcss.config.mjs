/*
 * Tailwind v4 enters the Next build here; the theme itself lives in
 * `@repo/ui/globals.css` (ADR-0031), which `src/app/styles.css` imports.
 */
const config = {
  plugins: ["@tailwindcss/postcss"],
};

export default config;
