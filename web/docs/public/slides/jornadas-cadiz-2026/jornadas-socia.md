
<!-- .slide: data-background-color="#FFFFFF" -->

<div class="portada-socia">

<img src="assets/socia/SOCIA_logo.png" style="max-height: 280px; margin-bottom: 0.3em;">

<h1 style="font-size: 2.8em; margin-bottom: 0.1em;">SOCIA</h1>

<h3 style="text-transform: none; font-weight: 400;">Plataforma para el entrenamiento de gestión de incidentes de ciberseguridad tutorizada con Inteligencia Artificial</h3>

<p class="meta-portada">
<strong>AINN23 / 00303</strong> · Proyecto de Innovación<br>
Jornadas Formativas · Cádiz · 21 – 22 de mayo de 2026
</p>

<div class="logos-pie">
<img src="assets/socia/Sello-Rafael-Alberti-Primario.svg" alt="IES Rafael Alberti">
<img src="assets/socia/atkios.svg" alt="AKTIOS Security Services">
</div>

</div>

---

# ¿Qué es SOCIA?

Note:
SOCIA = SOC + IA. El acrónimo lo dice todo: un Centro de Operaciones de Seguridad con una capa de IA encima.

- Una **plataforma** para entrenar la **gestión de incidentes** de ciberseguridad en el aula.
- Un **SOC real** tutorizado por **Inteligencia Artificial**.
- Pensada, inicialmente, para el módulo de **Incidentes de Ciberseguridad** del CE en Ciberseguridad.

---

## ¿Y más allá del CE de Ciberseguridad?

<div class="cards">

<div class="card">
<h4>CFGS ASIR</h4>
</div>

<div class="card">
<h4>CFGM SMR</h4>
</div>

<div class="card">
<h4>Bachillerato / ESO TIC</h4>
</div>

</div>

Note:
La arquitectura de SOCIA y los escenarios permiten adaptar el nivel a otras enseñanzas. La idea es que el centro elija el nivel de profundidad, no que el alumnado tenga que llegar al nivel del CE. Misma plataforma, distintos niveles de profundidad según la enseñanza.

- **CFGS ASIR** — Módulo *Seguridad y Alta Disponibilidad*: detección, análisis de logs, hardening, monitorización.
- **CFGM SMR** — Módulo *Seguridad Informática*: modo guiado y divulgativo, rol de analista SOC.
- **Bachillerato / ESO TIC** — Demostraciones puntuales: acercar la ciberseguridad y los perfiles SOC al alumnado.

---

## Marco del proyecto

Proyectos de Innovación e Investigación aplicadas y transferencia del conocimiento en FP

**Convocatoria**: 2023

**Desarrollo del proyecto**: sept. 2024 – ago. 2026

<div class="logos-pie" style="margin-top: 1.2em; gap: 50px;">
<img src="assets/socia/logo-ministerio-fp.jpg" alt="Ministerio de Educación, Formación Profesional y Deportes" style="max-height: 73px;">
<img src="assets/socia/logo-plan-recuperacion.jpg" alt="Plan de Recuperación, Transformación y Resiliencia" style="max-height: 130px;">
<img src="assets/socia/logo-next-generation.jpg" alt="Financiado por la Unión Europea — NextGenerationEU" style="max-height: 73px;">
</div>

---

## Tres equipos, un proyecto

<div class="cards" style="grid-template-columns: repeat(3, 1fr); align-items: center; gap: 60px; margin-top: 1.2em;">

<div style="text-align: center;">
<!-- <div style="font-size: 0.5em;"><strong>Centro coordinador</strong></div> -->
<img src="assets/socia/Sello-Rafael-Alberti-Primario.svg" alt="IES Rafael Alberti" style="max-height: 140px; margin: 0 auto 0.8em;">
</div>

<div style="text-align: center;">
<!-- <div style="font-size: 0.5em;"><strong>Centro participante</strong></div> -->
<img src="assets/socia/logo-cifp-cuenca.png" alt="CIFP Nº1 de Cuenca" style="max-height: 140px; margin: 0 auto 0.8em;">
</div>

<div style="text-align: center;">
<!-- <div style="font-size: 0.5em;"><strong>Empresa colaboradora</strong></div> -->
<img src="assets/socia/atkios.svg" alt="AKTIOS Security Services" style="max-height: 140px; margin: 0 auto 0.8em;">
</div>

</div>

Note:

SOCIA es un trabajo a tres bandas entre dos centros públicos de Formación Profesional y una empresa especializada en ciberseguridad. Cada uno aporta una pieza imprescindible: didáctica, alcance y experiencia profesional.

- **IES Rafael Alberti** (Cádiz) — Centro coordinador. Coordinación pedagógica, diseño didáctico, despliegue piloto y documentación.
- **CIFP Nº1 de Cuenca** — Centro participante. Validación en un segundo entorno educativo y co-creación de casos de uso.
- **AKTIOS Security Services** — Empresa colaboradora. Aporta el conocimiento operativo de SOC real.

---

# El problema que queríamos resolver

Note:

- El módulo de **Incidentes de Ciberseguridad** exige práctica realista

- El alumnado necesita **incidentes que ocurran**, no incidentes contados en una pizarra

- No hay un entorno SOC **profesional, libre y replicable** que pueda llevarse directamente al aula

---

# Un SOC real, no un simulador.

Note:
Por eso nace socia...

---

<div style="display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 0.6em;">

<div style="display: flex; align-items: stretch; justify-content: center; gap: 10px;">

<div style="background: #E60A46; color: #fff; padding: 22px 20px; border-radius: 8px; font-weight: 700; font-size: 0.7em; min-width: 165px; text-align: center;">
<div style="font-size: 0.75em; opacity: 0.75; margin-bottom: 4px;">01</div>
Detecta
</div>

<div style="display: flex; align-items: center; color: #1E283C; font-size: 1.7em;">→</div>

<div style="background: #E60A46; color: #fff; padding: 22px 20px; border-radius: 8px; font-weight: 700; font-size: 0.7em; min-width: 165px; text-align: center;">
<div style="font-size: 0.75em; opacity: 0.75; margin-bottom: 4px;">02</div>
Investiga
</div>

<div style="display: flex; align-items: center; color: #1E283C; font-size: 1.7em;">→</div>

<div style="background: #E60A46; color: #fff; padding: 22px 20px; border-radius: 8px; font-weight: 700; font-size: 0.7em; min-width: 165px; text-align: center;">
<div style="font-size: 0.75em; opacity: 0.75; margin-bottom: 4px;">03</div>
Contiene
</div>

</div>

<div style="display: flex; align-items: stretch; justify-content: center; gap: 10px;">

<div style="background: #E60A46; color: #fff; padding: 22px 20px; border-radius: 8px; font-weight: 700; font-size: 0.7em; min-width: 165px; text-align: center;">
<div style="font-size: 0.75em; opacity: 0.75; margin-bottom: 4px;">04</div>
Responde
</div>

<div style="display: flex; align-items: center; color: #1E283C; font-size: 1.7em;">→</div>

<div style="background: #E60A46; color: #fff; padding: 22px 20px; border-radius: 8px; font-weight: 700; font-size: 0.7em; min-width: 165px; text-align: center;">
<div style="font-size: 0.75em; opacity: 0.75; margin-bottom: 4px;">05</div>
Documenta
</div>

</div>

</div>

Note:
- El alumnado **se sienta delante de su SOC**.
- La plataforma **lanza un incidente** (ataque simulado / replay / escenario IA).
- El alumno recorre el ciclo: **detecta → investiga → contiene → responde → documenta**.
- Esto es lo que diferencia a SOCIA de una práctica tradicional: el incidente ocurre de verdad sobre la infraestructura, y la evaluación no depende solo del criterio del docente.

---

## Arquitectura de la plataforma

<div class="arq">

<div class="capa pedagogica">Panel docente — clases, casos, dashboards en directo, evaluaciones</div>

<div class="flecha">▼</div>

<div class="capa ia">Capa de Inteligencia Artificial — generación y tutorización de incidentes <em>(se explicará al día siguiente)</em></div>

<div class="flecha">▼</div>

<div class="capa">Infraestructura SOC</div>

<div class="flecha">▼</div>

<div class="capa">Red simulada · endpoints · servicios objetivo</div>

</div>

Note:
Cuatro capas:
1. Infra base — la "red" donde ocurren las cosas.
2. Stack SOC profesional — todo software libre.
3. Capa de IA — el cerebro que decide qué pasa, evalúa al alumno y guía.
4. Capa pedagógica — lo que ve el docente y el alumno.

La capa de IA es la que justifica el nombre y la que veremos en profundidad mañana.

---

## Panel docente

<img src="assets/socia/panel.png" alt="Panel docente SOCIA" style="max-height: 70vh; max-width: 92%; margin: 0.4em auto 0; display: block;">

---

# Un panel, dos extensiones

---

## Mentora

<img src="assets/socia/mentora.png" alt="Mentora" style="max-height: 70vh; max-width: 92%; margin: 0.4em auto 0; display: block;">

Note:
Extensión de navegador que graba al docente resolviendo un caso (pantalla, voz y acciones). Genera una guía PDF y un caso en json listo para SOCIA.

---

## La segunda extensión, la capa de IA

La parte que da nombre al proyecto: la **IA** de SOCIA

<img src="assets/socia/SOCIA_logo.png" style="max-height: 220px; margin-top: 0.6em;">

Note:
Extensión de navegador que carga el caso, realiza el seguimiento, ofrece pistas con un LLM pequeño y genera una evaluación final en PDF. Funciona con o sin servidor.

---

## SOCIA

<img src="assets/socia/socia.png" alt="SOCIA" style="max-height: 78vh; max-width: 96%; margin: 0.4em auto 0; display: block;">

Note:

**Tutoriza** al alumno: pistas, refuerzos, escalado de dificultad

**Evalúa** la resolución comparando con el ground truth del escenario

---

## Arquitectura del SOC

<img src="assets/socia/diagrama.png" alt="Diagrama de arquitectura SOCIA" style="max-height: 62vh; max-width: 85%; margin: 0.4em auto 0; display: block;">

Note:
Cuatro capas:
1. Infra base — la "red" donde ocurren las cosas.
2. Stack SOC profesional — todo software libre.
3. Capa de IA — el cerebro que decide qué pasa, evalúa al alumno y guía.
4. Capa pedagógica — lo que ve el docente y el alumno.

La capa de IA es la que justifica el nombre y la que veremos en profundidad mañana.

---

## Stack de herramientas

<div class="cards" style="font-size: 0.8em; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">

<div class="card">
<h4>OPNsense</h4>
Cortafuegos perimetral con IDS / IPS.
</div>

<div class="card">
<h4>Wazuh</h4>
SIEM central · correlación de eventos y detección de amenazas.
</div>

<div class="card">
<h4>OpenSearch</h4>
Almacenamiento y búsqueda de eventos del SIEM.
</div>

<div class="card">
<h4>TheHive</h4>
Gestión profesional de casos de incidentes · triaje y seguimiento.
</div>

<div class="card">
<h4>Cortex</h4>
Motor de análisis automatizado de observables e IOCs.
</div>

<div class="card">
<h4>MISP</h4>
Plataforma de intercambio de inteligencia de amenazas.
</div>

<div class="card">
<h4>Velociraptor</h4>
Forense de endpoint y recolección de evidencias.
</div>

<div class="card">
<h4>Malcolm</h4>
Análisis forense de tráfico de red a partir de PCAP.
</div>

<div class="card">
<h4>T-Pot</h4>
Honeypots para inteligencia de amenazas.
</div>

</div>

Note:
Todas estas herramientas se van a explicar a lo largo de las jornadas, y luego se propondrán casos de uso concretos para llevar al aula.

<!-- ---

## Las herramientas, una a una

A lo largo de estas jornadas vamos a **explicar cada herramienta** del stack y **proponer casos de uso** concretos para el aula.

Después, aterrizaremos sobre escenarios reales del módulo. -->

---

# Extensible a cualquier centro

Note:

- SOCIA no es un servicio cerrado: es una <strong>arquitectura desplegable</strong> que cualquier centro educativo puede instalar en su propia infraestructura.

- Stack 100% **software libre**

- Documentación de despliegue **paso a paso**

- Casos de uso **reutilizables** y adaptables

---

# Comunidad

Note:

Queremos que SOCIA **viva más allá del proyecto**

Otros centros que lo desplieguen → **nuevos casos de uso**

Profesorado que adapte → **nuevos escenarios**

Empresas que colaboren → **incidentes basados en la realidad del sector**

---

<!-- ## Beneficiarnos de las mejoras -->

<div class="destacado">
Cada centro que adopte SOCIA es un <strong>nodo activo</strong>: comparte sus escenarios, sus mejoras y su experiencia con el resto de la red.
</div>

Note:

Mejoras al núcleo → todos las recibimos.

Catálogo compartido de incidentes → crece con el tiempo.

Buenas prácticas docentes → documentadas y replicables.

---

## Tu propio SOC

<!-- <div class="destacado">
El <strong>viernes a las 13:30</strong> abriremos el repositorio completo y veremos cómo poner en marcha un SOC con SOCIA.
</div> -->

«Acceso al repositorio y puesta en marcha»

---

<!-- .slide: data-background-color="#1E283C" class="has-dark-background" -->

## ☕ Desayuno

### Formulario por parejas

Antes de pasar al desayuno, escanea el **QR** y completa el formulario por parejas.

<img src="assets/socia/qr_formulario.png" style="max-height: 240px; background: #fff; padding: 10px; border-radius: 8px;">

---

## ¿Preguntas?

<img src="assets/socia/SOCIA_logo.png" style="max-height: 220px;">

<p style="font-size: 0.6em; margin-top: 0.6em;">
Proyecto SOCIA · AINN23 / 00303 · IES Rafael Alberti · CIFP Nº1 Cuenca · AKTIOS
</p>

<div class="logos-pie" style="gap: 38px; margin-top: 0.8em; align-items: center;">
<img src="assets/socia/Sello-Rafael-Alberti-Primario.svg" alt="IES Rafael Alberti" style="max-height: 63px;">
<img src="assets/socia/logo-cifp-cuenca.png" alt="CIFP Nº1 de Cuenca" style="max-height: 52px;">
<img src="assets/socia/atkios.svg" alt="AKTIOS Security Services" style="max-height: 42px;">
<img src="assets/socia/logo-ministerio-fp.jpg" alt="Ministerio de Educación, Formación Profesional y Deportes" style="max-height: 46px;">
<img src="assets/socia/logo-plan-recuperacion.jpg" alt="Plan de Recuperación, Transformación y Resiliencia" style="max-height: 67px;">
<img src="assets/socia/logo-next-generation.jpg" alt="Financiado por la Unión Europea — NextGenerationEU" style="max-height: 46px;">
</div>