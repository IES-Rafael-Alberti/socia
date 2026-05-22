# Apps Script — Guía de despliegue

## Requisitos previos

- Haber ejecutado `setup/setup_opnsense.py` y tener el archivo `slots_vpn.csv`
- Una cuenta Google con Google Drive y Gmail

---

## Paso 1 — Crear el Google Spreadsheet

1. Ve a [sheets.google.com](https://sheets.google.com) → **Nuevo spreadsheet**
2. Renombra la hoja por defecto como **`Slots`**
3. Importa el CSV: **Archivo → Importar → Subir** → `slots_vpn.csv`
   - Separador: coma
   - Reemplazar hoja actual
4. Comprueba que la columna **H** (`libre`) tenga valores **`TRUE`** en las 50 filas

---

## Paso 2 — Crear el Google Form

1. Ve a [forms.google.com](https://forms.google.com) → **Nuevo formulario**
2. Título: `Registro VPN — Jornadas Formativas SOCIA`
3. Añade estos campos **en este orden**:
   - Pregunta 1: **Nombre completo** (Respuesta corta, obligatoria)
   - Pregunta 2: **Email** (Respuesta corta, obligatoria, validación: email)
   - Pregunta 3: **Centro educativo** (Respuesta corta, obligatoria)
4. En **Respuestas** → icono de spreadsheet → **Seleccionar spreadsheet existente**
   → elige el spreadsheet del Paso 1
   > Esto crea automáticamente la hoja `Respuestas de formulario 1`

---

## Paso 3 — Añadir el código Apps Script

1. En el spreadsheet: **Extensiones → Apps Script**
2. Borra el código de `Código.gs` que viene por defecto
3. Copia la plantilla de configuración y rellena tus valores:

   ```bash
   cp apps-script/Config.example.gs apps-script/Config.gs
   ```

   Edita `Config.gs` y rellena:
   - `WG_ENDPOINT` — IP pública y puerto de tu servidor WireGuard
   - `WG_SERVER_PUBKEY` — clave pública del servidor WireGuard
   - `ADMIN_EMAIL` — tu email de administración
   - `INFRA_HTML` — instrucciones de acceso a tu infraestructura (ver `instrucciones/infraestructura.md`)

4. Crea los siguientes archivos en Apps Script (**+ Nuevo archivo → Script**) y pega el contenido:

   | Archivo en este repo         | Nombre en Apps Script |
   |------------------------------|-----------------------|
   | `Config.gs`                  | `Config`              |
   | `Code.gs`                    | `Code`                |
   | `EmailService.gs`            | `EmailService`        |

---

## Paso 4 — Instalar el trigger

1. En Apps Script → **Triggers** (icono reloj) → **+ Add Trigger**
2. Configura:
   - Función: `onFormSubmit`
   - Fuente de eventos: `From spreadsheet`
   - Tipo de evento: `On form submit`
3. Autoriza los permisos cuando Google te lo pida
   (Gmail, Spreadsheets, Lock service)

---

## Paso 5 — Test antes de la jornada

1. En Apps Script, abre `Code.gs`
2. Selecciona la función `testEnvioEmail` en el desplegable
3. Pulsa ▶️ **Run**
4. Revisa tu bandeja de entrada — deberías recibir el email con:
   - El archivo `.conf` adjunto
   - El QR para móvil
   - Las instrucciones de infraestructura

---

## Paso 6 — Generar el QR del formulario

1. Copia la URL del formulario (botón **Enviar → icono de enlace**)
2. Genera el QR en [qr.io](https://qr.io) o [qrserver.com](https://qrserver.com)
3. Imprime el cartel con el QR para colocarlo en la sala

---

## Panel de control en tiempo real

La hoja **Slots** actúa como panel:
- Columna `libre = FALSE` → slot asignado (fondo rojo si aplicas formato condicional)
- Columna `nombre`, `email`, `centro` → quién tiene cada VPN
- Columna `enviado_en` → cuándo se envió

Para ver el estado desde Apps Script: ejecuta la función `estadoSlots()`.

---

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| Email no llega | Spam / filtros | Pide al profesor que revise spam |
| QR no carga en el email | Gmail bloquea imágenes externas | El `.conf` adjunto siempre funciona |
| `Lock no disponible` en log | Dos envíos simultáneos | Normal, el segundo reintenta |
| `No existe la hoja "Slots"` | Nombre de hoja incorrecto | Renombra la hoja a exactamente `Slots` |
| Sin slots libres | Se agotaron los 50 | El admin recibe aviso por email |
