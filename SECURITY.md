# Política de seguridad

Gracias por preocuparte por la seguridad de SOCIA. Este proyecto se usa en aulas reales con datos de menores y de profesorado, así que tomamos los reportes en serio.

## Cómo reportar una vulnerabilidad

**No abras un issue público para reportar una vulnerabilidad.** Hazlo de forma privada por una de estas vías, en orden de preferencia:

1. **GitHub Security Advisory privado** (recomendado): pestaña *Security* → *Report a vulnerability* en este repositorio. Es la vía moderna y la usaremos para coordinar el fix y la divulgación responsable.
2. **Correo**: si por algún motivo no puedes usar GitHub Advisories, escribe a la persona mantenedora del repo a través del email que figura en su perfil de GitHub. Asunto: `[SOCIA security] <resumen breve>`.

En el reporte, incluye en la medida de lo posible:

- Versión / commit del repo en el que reproduces.
- Componente afectado: extensión SOCIA, extensión MENTORA, server (`apps/server`), panel docente, o landing/docs.
- Pasos concretos para reproducir.
- Impacto estimado (lectura no autorizada, escalada de privilegios, denegación de servicio, exfiltración de PII…).
- Mitigaciones temporales que conozcas.

## Plazos esperados

- **Acuse de recibo**: en 5 días naturales.
- **Triage** (confirmar / rechazar): en 14 días naturales.
- **Fix** y publicación coordinada: depende de la severidad. Para casos críticos en el server (panel docente) intentaremos parchear y publicar advisory en menos de 30 días.

Si no recibes respuesta en los plazos anteriores, hazme un ping público (sin describir la vuln) en un issue del repo o por mensaje directo, por si el aviso se ha perdido.

## Alcance

Componentes que aceptamos en reportes:

| Componente | Ruta en el repo | Ejemplos de bugs relevantes |
|---|---|---|
| **Servidor + panel docente** | `apps/server/` | Auth bypass del panel, IDOR sobre evaluaciones, XSS, SQLi, RCE en handlers, exposición de tokens de estudiante, leak de datos de menores |
| **Extensión SOCIA** | `apps/extensions/entrypoints/socia/` | Filtración de la API key del alumno, manipulación de la traza, ejecución de código vía workflow.json malicioso |
| **Extensión MENTORA** | `apps/extensions/entrypoints/mentora/` | Filtración de la API key de OpenAI compilada, captura de credenciales del docente |
| **Paquetes compartidos** | `apps/packages/socia-eval/`, `apps/packages/socia-runtime/`, `apps/packages/socia-branding/` | Inyección a través del PDF, validación de input débil, abuso del prompt al LLM |
| **Web pública** | `web/landing/`, `web/docs/` | XSS en el sitio publicado, contenido inyectado vía meta tags |

Componentes **fuera de alcance**:

- Vulnerabilidades en dependencias upstream sin reproducción concreta en SOCIA (repórtalas a la dependencia y haremos bump aquí).
- Bugs de configuración del despliegue del usuario (ej. levantar el servidor en HTTP plano, contraseña por defecto del admin sin cambiar) — son responsabilidad de quien lo despliega; lo cubrimos en docs, no en código.
- Hallazgos en infraestructura externa (OpenRouter, OpenAI, GitHub Pages).
- Consideraciones de modelo del LLM (jailbreaks, prompts adversariales) que no produzcan acceso indebido a datos del alumnado.

## Buenas prácticas para quien despliega SOCIA Server

Aunque no son vulnerabilidades del código en sí, conviene recordarlas porque su omisión sí es una vulnerabilidad operativa:

- **Cambia las credenciales por defecto** (`ADMIN_USER`, `ADMIN_PASS`) y el `SESSION_SECRET` antes de exponer el servidor a la red.
- **Usa HTTPS** en producción. El panel envía cookies de sesión y tokens de estudiante; sin TLS, son interceptables.
- **No expongas el servidor a internet sin un reverse proxy** (Caddy / Nginx) con TLS y rate limiting.
- **Limita el acceso al volumen `socia-data`**: contiene la base de datos SQLite con identificación del alumnado y los PDFs de evaluación.
- **Actualiza la imagen** cuando se publique un advisory de seguridad.

## Reconocimiento

Listamos los reportes responsables en el `CHANGELOG.md` (cuando exista) y, si quien reporta lo desea, le mencionamos por nombre o handle. Sin recompensa económica — el proyecto es educativo y sin financiación destinada a bug bounty.
