import { defineConfig } from 'wxt';

const target = process.env.EXT ?? 'mentora';
const isSOCIA = target === 'socia';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  outDir: isSOCIA ? 'dist-socia' : 'dist-mentora',
  entrypointsDir: isSOCIA ? 'entrypoints/socia' : 'entrypoints/mentora',
  // Vite forces a prefix on .env variables to keep server-side secrets out of
  // the client bundle. For our extensions there are no server-side secrets in
  // this .env (the server has its own apps/server/.env), but Vite refuses an
  // empty prefix anyway, so we use `EXT_` — descriptive ("variables for the
  // extensions"), neutral between MENTORA and SOCIA. Variables in
  // apps/extensions/.env must therefore start with EXT_.
  vite: () => ({ envPrefix: 'EXT_' }),
  manifest: isSOCIA
    ? {
        name: 'SOCIA',
        description:
          'Herramienta para que estudiantes ejecuten y validen casos SOC prácticos con verificación automática',
        version: '1.0.0',
        permissions: ['storage', 'tabs', 'activeTab', 'webNavigation', 'downloads', 'scripting'],
        host_permissions: ['<all_urls>'],
        action: {
          default_title: 'SOCIA',
          default_icon: 'assets/SOCIA_logo_128.png',
        },
        icons: {
          16: 'assets/SOCIA_logo_16.png',
          32: 'assets/SOCIA_logo_32.png',
          48: 'assets/SOCIA_logo_48.png',
          128: 'assets/SOCIA_logo_128.png',
        },
        web_accessible_resources: [
          { resources: ['interceptor-main.js'], matches: ['<all_urls>'] },
        ],
      }
    : {
        name: 'MENTORA',
        description:
          'Capture tutorials with screen recording, screenshots, and action logging for LLM comprehension',
        version: '1.0.0',
        permissions: [
          'storage',
          'tabs',
          'activeTab',
          'offscreen',
          'downloads',
          'scripting',
          'webNavigation',
        ],
        host_permissions: ['<all_urls>'],
        action: {
          default_title: 'MENTORA',
          default_icon: 'assets/MENTORA_logo_128.png',
        },
        icons: {
          16: 'assets/MENTORA_logo_16.png',
          32: 'assets/MENTORA_logo_32.png',
          48: 'assets/MENTORA_logo_48.png',
          128: 'assets/MENTORA_logo_128.png',
        },
        web_accessible_resources: [
          { resources: ['interceptor-main.js'], matches: ['<all_urls>'] },
        ],
      },
});
