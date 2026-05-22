# Registro SOCIA Jornadas

Sistema automatizado de registro y distribución de accesos VPN para las **Jornadas Formativas del Proyecto SOCIA** (IES Rafael Alberti, Cádiz).

Hay dos modos de uso según cómo se organice la jornada:

| Modo | Quién rellena el form | Qué recibe cada persona |
|------|----------------------|-------------------------|
| **Individual** | Cada asistente por separado | Su propio `.conf` WireGuard |
| **Equipos** | Un representante por equipo (2 personas) | Cada integrante recibe su `.conf` individual + la URL de TheHive compartida del equipo |

---

## Cómo funciona — modo individual

```
Asistente rellena el Form (nombre, email, centro)
        ↓
Apps Script detecta el envío
        ↓
Asigna el primer slot libre de la hoja Slots
        ↓
Envía el email con el .conf adjunto y el QR de WireGuard
```

## Cómo funciona — modo equipos

```
Un integrante rellena el Form con los datos de ambos miembros
        ↓
Apps Script detecta el envío
        ↓
Asigna el primer slot libre de Slots_Equipos (2 perfiles VPN, uno por miembro)
        ↓
Asigna la primera URL TheHive libre de la hoja TheHive (compartida por el equipo)
        ↓
Envía un email individual a cada integrante con:
  - Su .conf WireGuard personal (IPs distintas para cada miembro)
  - El nombre y email de su compañero/a
  - La URL de TheHive compartida por el equipo
```

> El formulario lo rellena **una sola persona por equipo**. Cada integrante recibe su propio perfil VPN, pero ambos comparten la misma instancia de TheHive (con dos usuarios: `analista1` / `analista2`).

---

## Requisitos previos

- Python 3.9+
- Node.js + `clasp` instalado globalmente (`npm install -g @google/clasp`)
- Acceso a OPNsense con usuario y contraseña
- Cuenta de Google con acceso al proyecto de Apps Script
- Autenticación de clasp activa (`clasp login`)

Instalar dependencias Python:

```bash
pip install -r setup/requirements.txt
```

---

## Configuración inicial (solo la primera vez)

### 1. Credenciales de OPNsense

```bash
cp setup/.env.example setup/.env
```

Editar `setup/.env` y rellenar:

```
OPNSENSE_URL=https://192.168.x.x
OPNSENSE_USER=tu_usuario
OPNSENSE_PASS=tu_contraseña
```

### 2. Configuración de Apps Script

```bash
cp apps-script/Config.example.gs apps-script/Config.gs
```

Editar `apps-script/Config.gs` y rellenar:
- `WG_ENDPOINT` — IP pública y puerto de tu servidor WireGuard
- `WG_SERVER_PUBKEY` — clave pública del servidor WireGuard
- `ADMIN_EMAIL` — tu email de administración
- `INFRA_HTML` — instrucciones de acceso a tu infraestructura (ver `instrucciones/infraestructura.md`)

Si usas el modo equipos, repetir con `apps-script-team/Config_team.example.gs` → `Config_team.gs`.

### 3. Autenticar clasp con Google

```bash
clasp login
```

---

## Preparar una jornada

### Paso 1 — Ejecutar el script principal

**Modo individual:**

```bash
python3 setup/run.py
```

**Modo equipos:**

```bash
python3 setup/run_team.py
```

Ambos scripts son interactivos y hacen todo de forma automática:

1. Se conectan a OPNsense y detectan los peers WireGuard existentes
2. Preguntan cuántos perfiles (o equipos) quieres generar
3. Preguntan si quieres **añadir** o **reemplazar** los peers existentes
   - **Reemplazar**: borra todos los peers `alumnoN` / `equipoN` y crea N nuevos desde `1`
   - **Añadir**: mantiene los existentes y crea nuevos a partir del último
4. Crean los peers en OPNsense y recargan WireGuard
5. Exportan los perfiles a `setup/slots_vpn.csv` o `setup/slots_team.csv`
6. Suben el código a Google Apps Script con los datos de los slots
7. Generan `docs/index.html` o `docs/index_team.html` con el QR del formulario

### Paso 2 — Configurar Apps Script (solo si es la primera vez o se ha reseteado)

Tras el deploy, abrir Apps Script en el navegador y ejecutar la función de setup correspondiente:

**Modo individual — `setup()`:**
- Crea la pestaña **Slots** con todos los perfiles
- Crea el **Google Form** con los campos nombre, email y centro
- Instala el trigger `onFormSubmit`

> ⚠️ `setup()` borra y recrea la hoja Slots. Solo ejecutarla si es la primera vez o si quieres resetear todo. Pedirá confirmación antes de continuar.

**Modo equipos — `setupTeam()`:**
- Crea la hoja **Slots_Equipos** con los perfiles (2 VPN por fila, una por miembro)
- Crea la hoja **TheHive** y la puebla automáticamente con las URLs de las instancias (puertos 9101–9150)
- Crea el **Google Form** de equipos con los campos de ambos integrantes
- Instala el trigger `onFormSubmitTeam`
- Mueve el spreadsheet y el formulario a la carpeta "VPN Jornadas SOCIA" en Drive

> ⚠️ `setupTeam()` es destructiva: borra y recrea las hojas y el formulario. Pedirá confirmación si se lanza desde el menú de la hoja de cálculo. Si se ejecuta directamente desde el editor de Apps Script, la confirmación se omite automáticamente.

### Paso 3 — Proyectar el QR

Abrir `docs/index.html` (modo individual) o `docs/index_team.html` (modo equipos) en el navegador y proyectar en pantalla para que los asistentes escaneen el QR.

---

## Durante la jornada

El sistema funciona de forma completamente automática.

**Modo individual:**
1. El asistente escanea el QR y rellena el formulario (nombre, email, centro)
2. Apps Script asigna el primer slot libre y lo marca como ocupado
3. Envía el email con el `.conf` adjunto y el QR de WireGuard

**Modo equipos:**
1. Un integrante del equipo escanea el QR y rellena el formulario con los datos de los dos miembros
2. Apps Script busca el primer slot libre en `Slots_Equipos` y la primera URL libre en `TheHive`
3. Marca ambos recursos como ocupados y registra los datos del equipo
4. Envía un email individual a cada integrante con su `.conf` personal y la URL de TheHive compartida

En ambos modos, si no quedan recursos libres el sistema avisa automáticamente al administrador por email.

---

## Limpiar perfiles tras la jornada

Al terminar la formación, ejecutar `cleanup.py` para borrar los peers WireGuard de OPNsense:

```bash
python3 setup/cleanup.py
```

El script es interactivo:

1. Se conecta a OPNsense
2. Pregunta qué tipo de perfiles borrar: **individuales** (`alumnoN`), **equipos** (`equipoN_mN`) o **ambos**
3. Muestra el listado numerado con todos los peers encontrados
4. Pregunta cuáles eliminar:
   - **Todos** — borra todos los del tipo seleccionado
   - **Los primeros N** — borra los N primeros (útil si solo se usaron algunos slots)
   - **Selección manual** — números o rangos (`1,3,5-8`)
5. Muestra el resumen y pide confirmación explícita antes de borrar
6. Borra los peers y aplica `reconfigure` en WireGuard

Para verificar qué se borraría sin modificar nada:

```bash
python3 setup/cleanup.py --dry-run
```

---

## Menú de administración (modo equipos)

El spreadsheet de equipos incluye un menú **⚙️ SOCIA Admin — Equipos** con estas opciones:

- **Estado de equipos** — muestra cuántos slots VPN y cuántas URLs TheHive quedan disponibles
- **Limpiar asignaciones** — libera todos los slots y URLs (útil entre jornadas o en pruebas) sin tocar el formulario ni los perfiles VPN
- **Setup completo** — recrea todo desde cero (destructivo, pide confirmación)

---

## Restaurar la hoja Slots sin tocar el formulario

**Modo individual:** ejecutar `restoreSlotsOnly()` en Apps Script. Repuebla la hoja Slots con los slots actuales sin tocar el formulario ni el trigger.

Requiere haber hecho un deploy previo con `python3 setup/run.py` o `python3 setup/deploy.py`.

**Modo equipos:** usar la opción **Limpiar asignaciones** del menú de administración para resetear entre jornadas, o `setupTeam()` para una recreación completa.

---

## Solo actualizar el código (sin tocar OPNsense)

**Modo individual:**

```bash
python3 setup/deploy.py
```

Inyecta el CSV existente en Bootstrap.gs, sube el código a Apps Script y restaura el archivo.

**Modo equipos:**

```bash
python3 setup/run_team.py --deploy-only
```

Usa el `slots_team.csv` existente, sube el código a Apps Script y ofrece regenerar la página QR. Útil para cambios en el email, la configuración o la lógica del script sin tocar OPNsense ni regenerar los perfiles VPN.

---

## Estructura del proyecto

```
apps-script/                    Modo individual
  Bootstrap.gs                  Datos de slots + funciones de setup y restauración
  Code.gs                       Trigger onFormSubmit y lógica principal
  Config.example.gs             Plantilla de configuración (cópiala como Config.gs)
  Config.gs                     Configuración local con valores reales (ignorado por git)
  EmailService.gs               Construcción y envío del email corporativo
  appsscript.json               Manifiesto del proyecto Apps Script

apps-script-team/               Modo equipos
  Bootstrap_team.gs             Datos de slots (equipos + URLs TheHive)
  Code_team.gs                  Trigger onFormSubmit para equipos
  Config_team.example.gs        Plantilla de configuración (cópiala como Config_team.gs)
  Config_team.gs                Configuración local con valores reales (ignorado por git)
  EmailService_team.gs          Email con perfiles de 2 miembros por equipo
  appsscript.json               Manifiesto del proyecto Apps Script

setup/
  run.py                        Script maestro interactivo — modo individual
  run_team.py                   Script maestro interactivo — modo equipos
  cleanup.py                    Limpieza de peers WireGuard tras la jornada
  deploy.py                     Deploy a Apps Script sin tocar OPNsense
  vpn_utils.py                  Utilidades compartidas (OPNsense, UI, crypto)
  setup_opnsense.py             Cliente de la API de OPNsense
  requirements.txt              Dependencias Python
  .env.example                  Plantilla de credenciales (sin secretos)
  slots_vpn.example.csv         Plantilla de perfiles individuales (estructura de ejemplo)
  slots_vpn.csv                 Perfiles individuales generados (ignorado por git)
  slots_team.example.csv        Plantilla de perfiles de equipos (estructura de ejemplo)
  slots_team.csv                Perfiles de equipos generados (ignorado por git)

docs/
  index.html                    Página de proyección con QR — modo individual
  index_team.html               Página de proyección con QR — modo equipos
  .nojekyll                     Necesario para GitHub Pages

instrucciones/
  infraestructura.md            Instrucciones en el email — modo individual
  infraestructura_team.md       Instrucciones en el email — modo equipos
```

---

## Seguridad

Las claves privadas WireGuard y las credenciales de OPNsense **nunca se suben al repositorio**:

- `setup/.env` — credenciales de OPNsense (ignorado por git)
- `setup/slots_vpn.csv` — claves privadas de los perfiles individuales (ignorado por git)
- `setup/slots_team.csv` — claves privadas de los perfiles de equipos (ignorado por git)
- `apps-script/Config.gs` — configuración local con IP y clave pública del servidor (ignorado por git)
- `apps-script-team/Config_team.gs` — ídem para el modo equipos (ignorado por git)
- `.clasp.json` — vinculación a tu cuenta Google (ignorado por git)

El deploy inyecta las claves en Bootstrap.gs solo durante el `clasp push` y las elimina inmediatamente después.

Para cada archivo ignorado existe una plantilla `*.example` con la misma estructura pero sin valores reales. Cópialos y rellena tus datos antes de usar el sistema.

---

*Plataforma SOCIA · Un SOC en tu aula · IES Rafael Alberti*
