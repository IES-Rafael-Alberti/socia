import tailwind from "@astrojs/tailwind";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  // Hosted on the project's custom domain. No base path: the landing
  // is served from the apex of the domain.
  site: "https://socia.fpciberseguridad.com",
  integrations: [tailwind(), icon()],
  i18n: {
    defaultLocale: "es",
    locales: ["es", "en"],
    routing: {
      prefixDefaultLocale: false
    }
  }
});
