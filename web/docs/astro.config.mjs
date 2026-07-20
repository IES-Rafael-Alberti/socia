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
					],
				},
				{
					label: 'Infraestructura',
					translations: { en: 'Infrastructure' },
					items: [
						{ label: 'Resumen', translations: { en: 'Overview' }, link: '/despliegue/resumen/' },
						{ label: 'Arquitectura', translations: { en: 'Architecture' }, link: '/despliegue/arquitectura/' },
						{
							label: 'Restauración de backups',
							translations: { en: 'Backup restoration' },
							items: [
								{ label: 'Introducción', translations: { en: 'Introduction' }, link: '/despliegue/restauracion/introduccion/' },
								{ label: 'Descargas', translations: { en: 'Downloads' }, link: '/despliegue/restauracion/descargas/' },
								{ label: 'Preparación del Proxmox', translations: { en: 'Proxmox preparation' }, link: '/despliegue/restauracion/preparacion/' },
								{ label: 'Restauración de las VMs', translations: { en: 'VM restoration' }, link: '/despliegue/restauracion/vms/' },
								{ label: 'OpenSearch', link: '/despliegue/restauracion/opensearch/' },
								{ label: 'Graylog', link: '/despliegue/restauracion/graylog/' },
								{ label: 'Wazuh y Velociraptor', translations: { en: 'Wazuh & Velociraptor' }, link: '/despliegue/restauracion/wazuh-velociraptor/' },
								{ label: 'Malcolm', link: '/despliegue/restauracion/malcolm/' },
								{ label: 'MISP', link: '/despliegue/restauracion/misp/' },
								{ label: 'TheHive y Cortex', translations: { en: 'TheHive & Cortex' }, link: '/despliegue/restauracion/thehive-cortex/' },
								{ label: 'Grafana', link: '/despliegue/restauracion/grafana/' },
								{ label: 'fwlab', link: '/despliegue/restauracion/fwlab/' },
								{ label: 'OPNsense', link: '/despliegue/restauracion/opnsense/' },
								{ label: 'Puesta en marcha', translations: { en: 'Going live' }, link: '/despliegue/restauracion/puesta-en-marcha/' },
								{ label: 'Programar backups', translations: { en: 'Schedule backups' }, link: '/despliegue/restauracion/backups-periodicos/' },
							],
						},
						{ label: 'Despliegue automatizado', translations: { en: 'Automated deployment' }, link: '/despliegue/automatizado/' },
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
