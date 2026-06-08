// ═══════════════════════════════════════════════════════════════════
//  Config.gs  —  Configuración central del sistema VPN
//  Jornadas Formativas SOCIA · IES Rafael Alberti
//
//  INSTRUCCIONES: Copia este archivo como Config.gs y rellena
//  los valores marcados con TU_... con los de tu infraestructura.
//  NUNCA subas Config.gs al repositorio (está en .gitignore).
// ═══════════════════════════════════════════════════════════════════

var CONFIG = {

  // ── WireGuard (servidor ya configurado, no tocar) ──────────────
  WG_ENDPOINT:    'TU_IP_PUBLICA:TU_PUERTO',
  WG_SERVER_PUBKEY: 'TU_CLAVE_PUBLICA_SERVIDOR_BASE64=',
  WG_DNS:         '1.1.1.1, 8.8.8.8',
  WG_ALLOWED_IPS: '10.0.3.0/24, 172.17.33.0/24, 172.17.34.0/24, 172.18.1.0/24, 172.31.0.0/24',
  WG_KEEPALIVE:   15,

  // ── Google Sheets ──────────────────────────────────────────────
  SHEET_SLOTS: 'Slots',   // nombre de la pestaña con los 50 slots

  // Columnas de la hoja Slots (índice 1 = columna A)
  COL_SLOT:       1,   // A: alumno1 … alumno50
  COL_IP:         2,   // B: 10.0.3.101 … 10.0.3.150
  COL_PRIVKEY:    3,   // C: clave privada cliente
  COL_PUBKEY:     4,   // D: clave pública cliente
  COL_PSK:        5,   // E: pre-shared key
  COL_CONF:       6,   // F: contenido .conf completo
  COL_UUID:       7,   // G: uuid OPNsense
  COL_LIBRE:      8,   // H: TRUE / FALSE
  COL_NOMBRE:     9,   // I: nombre del profesor asignado
  COL_EMAIL:      10,  // J: email del profesor
  COL_CENTRO:     11,  // K: centro educativo
  COL_ENVIADO_EN: 12,  // L: timestamp de envío

  // ── Email ──────────────────────────────────────────────────────
  EMAIL_SUBJECT:   'Tu acceso VPN — Jornadas Formativas SOCIA',
  EMAIL_FROM_NAME: 'Jornadas SOCIA · IES Rafael Alberti',
  ADMIN_EMAIL:     'TU_EMAIL_ADMIN',  // recibe avisos de slots agotados

  // ── Campos del formulario Google Form ─────────────────────────
  // Posición en e.values[] (0 = timestamp, luego van en orden del form)
  FORM_NOMBRE:  1,
  FORM_EMAIL:   2,
  FORM_CENTRO:  3,

  // ── Instrucciones de infraestructura ──────────────────────────
  //
  //  ┌─────────────────────────────────────────────────────────┐
  //  │  AQUÍ VAN TUS INSTRUCCIONES DE INFRAESTRUCTURA          │
  //  │                                                         │
  //  │  1. Edita el archivo:                                   │
  //  │     instrucciones/infraestructura.md                    │
  //  │                                                         │
  //  │  2. Convierte a HTML y pégalo entre los backticks       │
  //  │     de INFRA_HTML (justo debajo de este comentario)     │
  //  │                                                         │
  //  │  Puedes usar: <h3> <p> <ul> <li> <b> <a> <br>          │
  //  └─────────────────────────────────────────────────────────┘

  INFRA_HTML: `
    <p>Añade aquí el HTML con las instrucciones de acceso a tu infraestructura.</p>
  `

};
