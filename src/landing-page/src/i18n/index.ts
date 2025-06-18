export const languages = {
  es: 'Español',
  en: 'English'
}

export const defaultLang = 'es'

export const translations = {
  es: {
    // Meta
    'site.title': 'SOCIA - Plataforma de Entrenamiento en Ciberseguridad',
    'site.description': 'SOCIA: Una plataforma para el entrenamiento de gestión de incidentes de Ciberseguridad tutorizada con Inteligencia Artificial. Simula un Centro de Operaciones de Seguridad (SOC) en tiempo real.',
    
    // Navigation
    'nav.home': 'Inicio',
    'nav.features': 'Características',
    'nav.collaborators': 'Colaboradores',
    
    // Hero
    'hero.title': 'SOCIA',
    'hero.subtitle': 'Plataforma de entrenamiento en',
    'hero.cybersecurity': 'Ciberseguridad',
    'hero.with': 'con',
    'hero.ai': 'Inteligencia Artificial',
    
    // Intro
    'intro.title': 'Qué',
    'intro.lead': 'SOCIA es una plataforma que simula un <span class="text-primary">Centro de Operaciones de Seguridad (SOC)</span>, integrando tecnologías de <span class="text-primary">Inteligencia Artificial</span> para ofrecer una formación única en la gestión de <span class="text-primary">incidentes de ciberseguridad</span>.',
    'intro.docs': 'Leer documentación',
    
    // Features
    'features.title': 'Cómo',
    'features.lead': 'SOCIA integra <span class="text-primary">tecnologías avanzadas</span> de Inteligencia Artificial con <span class="text-primary">metodologías innovadoras</span> para crear la <span class="text-primary">experiencia de aprendizaje</span> más realista en ciberseguridad.',
    'features.soc.title': 'Simulación SOC en tiempo real',
    'features.soc.description': 'Entrenamiento práctico en un Centro de Operaciones de Seguridad simulado que replica escenarios reales de ciberseguridad.',
    'features.ai.title': 'Tutorización con Inteligencia Artificial',
    'features.ai.description': 'Asistente IA que adapta su nivel de ayuda según tu histórico de respuestas, proporcionando una experiencia personalizada.',
    'features.challenges.title': 'Aprendizaje Basado en Retos',
    'features.challenges.description': 'Metodología que permite aplicar conocimientos de manera práctica mediante la resolución de incidentes reales.',
    'features.opensource.title': 'Código abierto',
    'features.opensource.description': 'Plataforma open source que permite la replicación y adaptación en otros centros educativos y empresas.',
    
    // Collaborators
    'collaborators.title': 'Quién',
    'collaborators.lead': 'SOCIA es el resultado de la <span class="text-primary">colaboración</span> entre centros educativos de excelencia y empresas especializadas en <span class="text-primary">ciberseguridad</span>.',
    'collaborators.visit': 'Visitar sitio web',
    
    // Footer
    'footer.collaborators': 'Colaboradores del Proyecto',
    'footer.funded': 'Financiado por el Ministerio de Educación y Formación Profesional',
    'footer.project': 'Proyecto de innovación en Formación Profesional - Convocatoria 2024',
    'footer.rights': 'SOCIA - Todos los derechos reservados',
    'footer.initiative': 'Una iniciativa del IES Rafael Alberti y el CIFP Nº1 - Cuenca en colaboración con Aktios Security Services'
  },
  en: {
    // Meta
    'site.title': 'SOCIA - Cybersecurity Training Platform',
    'site.description': 'SOCIA: A platform for cybersecurity incident management training tutored with Artificial Intelligence. Simulates a Security Operations Center (SOC) in real time.',
    
    // Navigation
    'nav.home': 'Home',
    'nav.features': 'Features',
    'nav.collaborators': 'Collaborators',
    
    // Hero
    'hero.title': 'SOCIA',
    'hero.subtitle': 'Training platform for',
    'hero.cybersecurity': 'Cybersecurity',
    'hero.with': 'with',
    'hero.ai': 'Artificial Intelligence',
    
    // Intro
    'intro.title': 'What',
    'intro.lead': 'SOCIA is a platform that simulates a <span class="text-primary">Security Operations Center (SOC)</span>, integrating <span class="text-primary">Artificial Intelligence</span> technologies to offer unique training in <span class="text-primary">cybersecurity incident management</span>.',
    'intro.docs': 'Read documentation',
    
    // Features
    'features.title': 'How',
    'features.lead': 'SOCIA integrates <span class="text-primary">advanced technologies</span> of Artificial Intelligence with <span class="text-primary">innovative methodologies</span> to create the most realistic <span class="text-primary">learning experience</span> in cybersecurity.',
    'features.soc.title': 'Real-time SOC Simulation',
    'features.soc.description': 'Practical training in a simulated Security Operations Center that replicates real cybersecurity scenarios.',
    'features.ai.title': 'AI-powered Tutoring',
    'features.ai.description': 'AI assistant that adapts its level of help based on your response history, providing a personalized experience.',
    'features.challenges.title': 'Challenge-Based Learning',
    'features.challenges.description': 'Methodology that allows applying knowledge practically through solving real incidents.',
    'features.opensource.title': 'Open Source',
    'features.opensource.description': 'Open source platform that allows replication and adaptation in other educational centers and companies.',
    
    // Collaborators
    'collaborators.title': 'Who',
    'collaborators.lead': 'SOCIA is the result of <span class="text-primary">collaboration</span> between centers of educational excellence and companies specialized in <span class="text-primary">cybersecurity</span>.',
    'collaborators.visit': 'Visit website',
    
    // Footer
    'footer.collaborators': 'Project Collaborators',
    'footer.funded': 'Funded by the Ministry of Education and Vocational Training',
    'footer.project': 'Vocational Training Innovation Project - 2024 Call',
    'footer.rights': 'SOCIA - All rights reserved',
    'footer.initiative': 'An initiative of IES Rafael Alberti and CIFP Nº1 - Cuenca in collaboration with Aktios Security Services'
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