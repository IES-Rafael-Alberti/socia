// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: "https://ies-rafael-alberti.github.io",
	base: "/socia/docs",
	integrations: [
		starlight({
			title: 'SOCIA',
			description: 'Documentación oficial de SOCIA — entrenamiento de SOC con IA. IES Rafael Alberti, CIFP N.º 1 Cuenca y Aktios.',
			logo: {
				src: './src/assets/socia-logo.svg',
				replacesTitle: false,
			},
			favicon: '/favicon.svg',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/IES-Rafael-Alberti/socia'
				}
			],
			defaultLocale: 'root',
			locales: {
				root: { label: 'Español', lang: 'es' },
			},
			sidebar: [
				{
					label: 'Introducción',
					translations: { en: 'Introduction' },
					items: [
						{ label: 'Bienvenida', translations: { en: 'Welcome' }, link: '/introduccion/bienvenida/' },
						{ label: 'Arquitectura', translations: { en: 'Architecture' }, link: '/introduccion/arquitectura/' },
						{ label: 'Glosario', translations: { en: 'Glossary' }, link: '/introduccion/glosario/' },
					],
				},
				{
					label: 'Instalar la plataforma',
					translations: { en: 'Install the platform' },
					items: [
						{ label: 'Resumen y requisitos', translations: { en: 'Overview & requirements' }, link: '/instalacion/requisitos/' },
						{ label: 'SOCIA Server (Docker)', link: '/instalacion/server/' },
						{ label: 'Stack SOC: Graylog · TheHive · Malcolm', translations: { en: 'SOC stack: Graylog · TheHive · Malcolm' }, link: '/instalacion/stack-soc/' },
						{ label: 'Extensiones MENTORA y SOCIA', translations: { en: 'MENTORA & SOCIA extensions' }, link: '/instalacion/extensiones/' },
						{ label: 'Adopción en otros institutos', translations: { en: 'Adopting SOCIA in your school' }, link: '/instalacion/adopcion/' },
					],
				},
				{
					label: 'Componentes de IA',
					translations: { en: 'AI components' },
					items: [
						{ label: 'Visión general', translations: { en: 'Overview' }, link: '/ia/vision/' },
						{ label: 'MENTORA — extensión del docente', translations: { en: 'MENTORA — teacher extension' }, link: '/ia/mentora/' },
						{ label: 'SOCIA — extensión del alumnado', translations: { en: 'SOCIA — student extension' }, link: '/ia/socia/' },
						{ label: 'SOCIA Server — panel del centro', translations: { en: 'SOCIA Server — school panel' }, link: '/ia/server/' },
					],
				},
				{
					label: 'Referentes',
					translations: { en: 'References' },
					items: [
						{ label: 'Por qué miramos fuera', translations: { en: 'Why we looked outward' }, link: '/referentes/intro/' },
						{ label: 'Universidad de Murcia', link: '/referentes/murcia/' },
						{ label: 'Tknika (País Vasco)', translations: { en: 'Tknika (Basque Country)' }, link: '/referentes/tknika/' },
					],
				},
			],
			customCss: [
				'./src/styles/custom.css',
			],
		}),
	],
});
