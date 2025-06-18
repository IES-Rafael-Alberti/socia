// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'SOCIA Docs',
			description: 'Documentación oficial de SOCIA - Plataforma de entrenamiento en ciberseguridad con IA',
			logo: {
				src: './src/assets/socia-logo.svg',
			},
			social: [
				{ 
					icon: 'github', 
					label: 'GitHub', 
					href: 'https://github.com/IES-Rafael-Alberti/socia' 
				}
			],
			defaultLocale: 'es',
			locales: {
				es: {
					label: 'Español',
					lang: 'es',
				},
				en: {
					label: 'English',
					lang: 'en',
				},
			},
			sidebar: [
				{
					label: 'Introducción',
					autogenerate: { directory: 'intro' },
				},
				{
					label: 'Guías',
					autogenerate: { directory: 'guides' },
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
			customCss: [
				'./src/styles/custom.css',
			],
		}),
	],
});
