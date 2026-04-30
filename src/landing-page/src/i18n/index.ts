export const languages = {
  es: 'Español',
  en: 'English'
}

export const defaultLang = 'es'

export const translations = {
  es: {
    // Meta
    'site.title': 'SOCIA — Entrenamiento de SOC con IA',
    'site.description': 'SOCIA es una plataforma abierta para entrenar al alumnado de ciberseguridad en la resolución de casos de un Centro de Operaciones de Seguridad (SOC), con grabación, pistas y evaluación tutorizadas por IA. Un proyecto del IES Rafael Alberti, el CIFP N.º 1 Cuenca y Aktios.',

    // Header / nav
    'nav.what': 'Qué es',
    'nav.stack': 'Infraestructura',
    'nav.pieces': 'Capa de IA',
    'nav.classroom': 'En el aula',
    'nav.partners': 'Quiénes',
    'nav.docs': 'Documentación',

    // Hero
    'hero.script': 'Un proyecto de',
    'hero.school': 'IES Rafael Alberti · CIFP N.º 1 Cuenca · Aktios',
    'hero.title.line1': 'Aprende',
    'hero.title.line2': 'SOC',
    'hero.title.line3': 'con IA',
    'hero.lead': 'Un SOC real desplegado en el centro educativo con aplicaciones profesionales y abiertas sobre Proxmox, sumado a una capa de IA que ayuda al profesorado a crear casos y al alumnado a aprender a resolverlos.',
    'hero.cta.docs': 'Documentación',
    'hero.cta.github': 'GitHub',
    'hero.kpi1.value': 'SOC real',
    'hero.kpi1.label': 'Sobre Proxmox · Herramientas profesionales',
    'hero.kpi2.value': 'IA tutorizada',
    'hero.kpi2.label': 'MENTORA · SOCIA · SOCIA Server',
    'hero.kpi3.value': 'Open source',
    'hero.kpi3.label': 'Replicable en cualquier centro',

    // What is SOCIA — three big statements, Apple-style
    'what.eyebrow': 'Manifiesto',
    'what.line1.lead': 'Un',
    'what.line1.accent': 'SOC real',
    'what.line1.tail': ', no un simulador.',
    'what.line2.lead': 'IA aplicada ',
    'what.line2.accent': 'con sentido',
    'what.line2.tail': ', no un chatbot genérico.',
    'what.line3.lead': 'Un proyecto',
    'what.line3.accent': 'open source',
    'what.line3.tail': ' y reproducible.',

    // Infraestructura — dos sub-bloques: SOC + capa IA
    'stack.eyebrow': 'Infraestructura',
    'stack.title': 'Dos capas, un proyecto',
    'stack.lead': 'SOCIA combina un SOC profesional desplegado sobre Proxmox y una capa de IA que conecta esa infraestructura con el aula. La de abajo trae herramientas reales; la de arriba, automatización pedagógica.',
    'stack.soc.subtitle': '',
    'stack.soc.desc': '',
    'stack.ai.subtitle': '',
    'stack.ai.desc': '',
    'stack.wazuh.title': 'Wazuh',
    'stack.wazuh.role': 'SIEM · EDR',
    'stack.wazuh.desc': 'Recoge, correlaciona y alerta sobre eventos de seguridad.',
    'stack.malcolm.title': 'Malcolm',
    'stack.malcolm.role': 'Análisis de tráfico',
    'stack.malcolm.desc': 'Indexa pcaps y permite consultas.',
    'stack.velociraptor.title': 'Velociraptor',
    'stack.velociraptor.role': 'DFIR',
    'stack.velociraptor.desc': 'Forense en endpoint, recolectando artefactos.',
    'stack.opnsense.title': 'OPNsense',
    'stack.opnsense.role': 'Firewall',
    'stack.opnsense.desc': 'Reglas de bloqueo que se aplican sobre tráfico real.',
    'stack.more.title': 'Y más',
    'stack.more.role': 'Stack completo',
    'stack.more.desc': 'TheHive, T-Pot, máquinas vulnerables...',

    // Three pieces — la capa de IA que se monta encima del SOC
    'pieces.eyebrow': 'Capa de IA',
    'pieces.title': 'Tres piezas que conectan IA y aula',
    'pieces.lead': 'Sobre la infraestructura SOC se monta una capa de software que automatiza la creación de casos, registra el recorrido del alumnado y emite la evaluación. La IA solo aparece donde aporta valor.',
    'pieces.mentora.tag': 'Para el docente',
    'pieces.mentora.title': 'MENTORA',
    'pieces.mentora.desc': 'Extensión de navegador que graba al docente resolviendo un caso (pantalla, voz y acciones). Genera una guía PDF y un caso en json listo para SOCIA.',
    'pieces.mentora.skills': ['Grabación con clics y selectores CSS', 'Skill de IA: guía PDF paso a paso', 'Skill de IA: workflow ejecutable', 'Publicación directa al servidor'],
    'pieces.socia.tag': 'Para el alumnado',
    'pieces.socia.title': 'SOCIA',
    'pieces.socia.desc': 'Extensión de navegador que carga el caso, realiza el seguimiento, ofrece pistas con un LLM pequeño y genera una evaluación final en PDF. Funciona con o sin servidor.',
    'pieces.socia.skills': ['Modos guiado y prueba', 'Bombilla de pistas bajo demanda', 'Evaluación final en PDF', 'Standalone o managed por servidor'],
    'pieces.server.tag': 'Para el centro',
    'pieces.server.title': 'SOCIA Server',
    'pieces.server.desc': 'Contenedor Docker que sirve el panel web del docente: clases, workflows, dashboard en directo y evaluaciones. Centraliza la API key del LLM.',
    'pieces.server.skills': ['Clases con código y QR', 'Biblioteca de workflows', 'Directo: progreso por alumno', 'Evaluaciones por alumno y CSV'],

    // Classroom flow
    'flow.eyebrow': 'En el aula',
    'flow.title': 'Una sesión, de principio a fin',
    'flow.lead': 'Buscamos la mejor experiencia de usuario para profesorado y alumnado.',
    'flow.s1.title': 'Levanta el servidor',
    'flow.s1.body': 'El docente arranca el contenedor de la aplicación y obtiene acceso al panel web.',
    'flow.s2.title': 'Crea la clase',
    'flow.s2.body': 'Un nombre, opcionalmente un dominio de correo permitido. El sistema produce un código corto y un QR.',
    'flow.s3.title': 'Onboarding por QR',
    'flow.s3.body': 'El alumnado escanea el QR con las instrucciones. Se identifica con correo o nombre.',
    'flow.s4.title': 'Lanza el caso',
    'flow.s4.body': 'Un solo botón activa el incidente asignado para toda la clase. Se observa en directo el progreso, paso a paso.',
    'flow.s5.title': 'Evalúa al cerrar',
    'flow.s5.body': 'Cuando el alumno termina, se genera un PDF con recorrido, aciertos, desvíos y calificación justificada.',

    // Partners
    'partners.eyebrow': 'Quiénes',
    'partners.title': 'Tres equipos, un proyecto',
    'partners.lead': 'SOCIA es un trabajo a tres bandas entre dos centros públicos de Formación Profesional y una empresa especializada en ciberseguridad. Cada uno aporta una pieza imprescindible: didáctica, alcance y experiencia profesional.',
    'partners.role.alberti': 'FP Ciberseguridad',
    'partners.role.cuenca': 'FP Ciberseguridad',
    'partners.role.aktios': 'Empresa especializada',
    'partners.contribution.alberti': 'Coordina el proyecto y desarrolla la capa de IA: las extensiones MENTORA y SOCIA, el panel del docente y la integración pedagógica con el ciclo de Ciberseguridad.',
    'partners.contribution.cuenca': 'Valida la infraestructura y la capa de IA en su propia aula. Documenta el despliegue para que cualquier otro centro educativo pueda reproducirlo.',
    'partners.contribution.aktios': 'Diseña, instala y configura la infraestructura SOC: el servidor Proxmox y el stack profesional, además de aportar casos prácticos reales.',
    'partners.visit': 'Visitar sitio',

    // Funding
    'funding.eyebrow': 'Financiación',
    'funding.title': 'Innovación en F. P. — Convocatoria 2023',
    'funding.body': 'Proyecto financiado por el Ministerio de Educación, Formación Profesional y Deportes, en el marco del Plan de Recuperación, Transformación y Resiliencia.',

    // Footer
    'footer.tag': 'Creado entre',
    'footer.tag2': 'Cádiz, Cuenca y la industria',
    'footer.legal': 'SOCIA es un proyecto colaborativo de innovación educativa, distribuido como código abierto.',
    'footer.year': '2026',
    'footer.col.explore': 'Explorar',
    'footer.col.docs': 'Para tu centro',
    'footer.col.funding': 'Financiación',
    'footer.cta.adopt': 'Adoptar SOCIA en tu centro',
    'footer.cta.adopt.lead': 'La instalación está documentada paso a paso. Si quieres replicar el laboratorio en tu instituto, empieza por aquí.',
    'footer.funding.label': 'Innovación en F. P. — Convocatoria 2023',
    'footer.funding.body': 'Ministerio de Educación, Formación Profesional y Deportes · Plan de Recuperación, Transformación y Resiliencia.',
  },
  en: {
    // Meta
    'site.title': 'SOCIA — AI-tutored SOC training',
    'site.description': 'SOCIA is an open-source platform that lets cybersecurity students solve real SOC cases with AI-assisted hints, traces and evaluation. A joint project of IES Rafael Alberti, CIFP N.º 1 Cuenca and Aktios.',

    // Header / nav
    'nav.what': 'What it is',
    'nav.stack': 'Infrastructure',
    'nav.pieces': 'AI layer',
    'nav.classroom': 'In class',
    'nav.partners': 'Partners',
    'nav.docs': 'Docs',

    // Hero
    'hero.script': 'A project by',
    'hero.school': 'IES Rafael Alberti · CIFP N.º 1 Cuenca · Aktios',
    'hero.title.line1': 'Learn',
    'hero.title.line2': 'SOC',
    'hero.title.line3': 'with AI',
    'hero.lead': 'A real Security Operations Center deployed at the school with professional, open-source tools on top of Proxmox, plus an AI layer that helps teachers build cases and students learn to solve them.',
    'hero.cta.docs': 'Read the docs',
    'hero.cta.github': 'GitHub',
    'hero.kpi1.value': 'Real SOC',
    'hero.kpi1.label': 'On Proxmox · Production-grade tools',
    'hero.kpi2.value': 'AI-tutored',
    'hero.kpi2.label': 'MENTORA · SOCIA · SOCIA Server',
    'hero.kpi3.value': 'Open source',
    'hero.kpi3.label': 'Replicable in any centre',

    // What is SOCIA — three big statements, Apple-style
    'what.eyebrow': 'Manifesto',
    'what.line1.lead': 'A',
    'what.line1.accent': 'real SOC',
    'what.line1.tail': ', not a simulator.',
    'what.line2.lead': 'AI applied ',
    'what.line2.accent': 'with purpose',
    'what.line2.tail': ', not a generic chatbot.',
    'what.line3.lead': 'An',
    'what.line3.accent': 'open source',
    'what.line3.tail': ' and reproducible project.',

    // Infrastructure — two sub-blocks: SOC + AI layer
    'stack.eyebrow': 'Infrastructure',
    'stack.title': 'Two layers, one project',
    'stack.lead': 'SOCIA combines a professional SOC deployed on Proxmox with an AI layer that ties that infrastructure to the classroom. The bottom layer brings real-world tools; the top one, pedagogical automation.',
    'stack.soc.subtitle': '',
    'stack.soc.desc': '',
    'stack.ai.subtitle': '',
    'stack.ai.desc': '',
    'stack.wazuh.title': 'Wazuh',
    'stack.wazuh.role': 'SIEM · EDR',
    'stack.wazuh.desc': 'Collects, correlates and alerts on security events.',
    'stack.malcolm.title': 'Malcolm',
    'stack.malcolm.role': 'Traffic analysis',
    'stack.malcolm.desc': 'Indexes pcaps and answers queries.',
    'stack.velociraptor.title': 'Velociraptor',
    'stack.velociraptor.role': 'DFIR',
    'stack.velociraptor.desc': 'Endpoint forensics, collecting artefacts.',
    'stack.opnsense.title': 'OPNsense',
    'stack.opnsense.role': 'Firewall',
    'stack.opnsense.desc': 'Blocking rules applied on real traffic.',
    'stack.more.title': 'And more',
    'stack.more.role': 'Full stack',
    'stack.more.desc': 'TheHive, T-Pot, vulnerable machines…',

    // Three pieces — the AI layer that sits on top of the SOC
    'pieces.eyebrow': 'AI layer',
    'pieces.title': 'Three pieces tying AI to the classroom',
    'pieces.lead': 'On top of the SOC infrastructure sits a software layer that automates case authoring, records student traces and emits the evaluation. AI only appears where it adds real value.',
    'pieces.mentora.tag': 'For teachers',
    'pieces.mentora.title': 'MENTORA',
    'pieces.mentora.desc': 'A browser extension that records the teacher solving a case (screen, voice and actions). Outputs a PDF guide and a case file ready to load in SOCIA.',
    'pieces.mentora.skills': ['Click and CSS-selector capture', 'AI skill: step-by-step PDF guide', 'AI skill: runnable workflow', 'Direct publish to server'],
    'pieces.socia.tag': 'For students',
    'pieces.socia.title': 'SOCIA',
    'pieces.socia.desc': 'A browser extension that loads the case, follows the student, hands out hints with a small LLM, and emits a final PDF evaluation. Runs with or without server.',
    'pieces.socia.skills': ['Guided and exam modes', 'On-demand hint lightbulb', 'Final PDF evaluation', 'Standalone or managed by server'],
    'pieces.server.tag': 'For the school',
    'pieces.server.title': 'SOCIA Server',
    'pieces.server.desc': 'A Docker container that serves the teacher\'s web panel: classes, workflows, live dashboard and evaluations. Centralises the LLM API key.',
    'pieces.server.skills': ['Classes with code and QR', 'Workflow library', 'Live: per-student progress', 'Per-student evaluations + CSV'],

    // Classroom flow
    'flow.eyebrow': 'In class',
    'flow.title': 'A session, end to end',
    'flow.lead': 'We design every step around teachers and students alike.',
    'flow.s1.title': 'Spin up the server',
    'flow.s1.body': 'The teacher starts the application container and gets access to the web panel.',
    'flow.s2.title': 'Create the class',
    'flow.s2.body': 'A name, optionally an allowed email domain. The system produces a short code and a QR.',
    'flow.s3.title': 'QR onboarding',
    'flow.s3.body': 'Students scan the QR with the instructions. They identify by email or free-form name.',
    'flow.s4.title': 'Launch the case',
    'flow.s4.body': 'A single button fires the assigned incident for the whole class. Progress is watched live, step by step.',
    'flow.s5.title': 'Evaluate on close',
    'flow.s5.body': 'When the student finishes, a PDF is produced with path, hits, deviations and a reasoned grade.',

    // Partners
    'partners.eyebrow': 'Who',
    'partners.title': 'Three teams, one project',
    'partners.lead': 'SOCIA is a three-way collaboration between two public vocational training schools and a cybersecurity company. Each side brings something the others cannot: pedagogy, scale and industry experience.',
    'partners.role.alberti': 'Cybersecurity F. P.',
    'partners.role.cuenca': 'Cybersecurity F. P.',
    'partners.role.aktios': 'Cybersecurity company',
    'partners.contribution.alberti': 'Coordinates the project and builds the AI layer: the MENTORA and SOCIA browser extensions, the teacher panel and the pedagogical integration with the cybersecurity curriculum.',
    'partners.contribution.cuenca': 'Validates the infrastructure and the AI layer in their own classroom. Documents the deployment so any other school can reproduce it.',
    'partners.contribution.aktios': 'Designs, installs and configures the SOC infrastructure: the Proxmox server and the professional stack, and contributes real-world cases.',
    'partners.visit': 'Visit site',

    // Funding
    'funding.eyebrow': 'Funding',
    'funding.title': 'F. P. Innovation — 2023 call',
    'funding.body': 'Funded by the Spanish Ministry of Education, Vocational Training and Sports, under the Recovery, Transformation and Resilience Plan.',

    // Footer
    'footer.tag': 'Made between',
    'footer.tag2': 'Cádiz, Cuenca and the industry',
    'footer.legal': 'SOCIA is a collaborative educational innovation project, released as open source.',
    'footer.year': '2026',
    'footer.col.explore': 'Explore',
    'footer.col.docs': 'For your school',
    'footer.col.funding': 'Funding',
    'footer.cta.adopt': 'Adopt SOCIA in your school',
    'footer.cta.adopt.lead': 'The deployment is documented step by step. If you want to replicate the lab at your school, start here.',
    'footer.funding.label': 'F. P. Innovation — 2023 call',
    'footer.funding.body': 'Spanish Ministry of Education, Vocational Training and Sports · Recovery, Transformation and Resilience Plan.',
  }
} as const

export function getLangFromUrl(url: URL) {
  const [, lang] = url.pathname.split('/')
  if (lang in languages) return lang as keyof typeof languages
  return defaultLang
}

export function useTranslations(lang: keyof typeof languages) {
  return function t(key: keyof typeof translations[typeof defaultLang]) {
    return translations[lang][key] || translations[defaultLang][key]
  }
}
