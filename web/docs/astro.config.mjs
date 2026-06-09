// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	// Hosted on the project's custom domain. Docs live at /docs/.
	site: "https://socia.fpciberseguridad.com",
	base: "/docs",
	// sharp is not declared as a dependency in this package; use passthrough
	// so Astro skips image optimisation and serves images as-is.
	image: {
		service: passthroughImageService(),
	},
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
						{ label: 'Stack SOC: Graylog · TheHive · Malcolm', translations: { en: 'SOC stack: Graylog · TheHive · Malcolm' }, link: '/instalacion/stack-soc/' },
					],
				},
				{
					label: 'Componentes de IA',
					translations: { en: 'AI components' },
					items: [
						{ label: 'Visión general', translations: { en: 'Overview' }, link: '/ia/vision/' },
						{ label: 'Proceso de diseño', translations: { en: 'Design journey' }, link: '/ia/proceso-diseno/' },
						{ label: 'MENTORA (profesorado)', translations: { en: 'MENTORA (teachers)' }, link: '/ia/mentora/' },
						{ label: 'SOCIA (alumnado)', translations: { en: 'SOCIA (students)' }, link: '/ia/socia/' },
						{ label: 'Panel web (gestión)', translations: { en: 'Web panel (management)' }, link: '/ia/server/' },
					],
				},
				{
					label: 'Comunidad y eventos',
					translations: { en: 'Community & events' },
					items: [
						{ label: 'Resumen', translations: { en: 'Overview' }, link: '/comunidad/resumen/' },
						{
							label: 'Jornadas formativas',
							translations: { en: 'Training sessions' },
							items: [
								{ label: 'Cuenca 2026', link: '/comunidad/jornadas/cuenca-2026/' },
								{ label: 'Cádiz 2026', link: '/comunidad/jornadas/cadiz-2026/' },
							],
						},
						{
							label: 'Encuentros y difusión',
							translations: { en: 'Meetups & dissemination' },
							items: [
								{ label: 'Castilla-La Mancha', link: '/comunidad/encuentros/castilla-la-mancha/' },
							],
						},
					],
				},
				{
					label: 'Referentes',
					translations: { en: 'References' },
					items: [
						{ label: 'Iniciativas previas', translations: { en: 'Why we looked outward' }, link: '/referentes/intro/' },
						{ label: 'SCORPION', link: '/referentes/murcia/' },
						{ label: 'Tknika', translations: { en: 'Tknika)' }, link: '/referentes/tknika/' },
					],
				},
			],
			customCss: [
				'./src/styles/custom.css',
			],
		}),
	],
});
