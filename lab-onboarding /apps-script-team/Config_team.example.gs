// ═══════════════════════════════════════════════════════════════════
//  Config_team.gs  —  Configuración del sistema VPN por equipos
//  Jornadas Formativas SOCIA · IES Rafael Alberti
//
//  INSTRUCCIONES: Copia este archivo como Config_team.gs y rellena
//  los valores marcados con TU_... con los de tu infraestructura.
//  NUNCA subas Config_team.gs al repositorio (está en .gitignore).
// ═══════════════════════════════════════════════════════════════════

var CONFIG_TEAM = {

  // ── Google Sheets ──────────────────────────────────────────────
  SHEET_SLOTS:   'Slots_Equipos',
  SHEET_THEHIVE: 'TheHive',

  // Columnas de Slots_Equipos (índice 1 = columna A)
  COL_EQUIPO:        1,   // A: equipo1 … equipo25
  COL_SLOT_M1:       2,   // B: equipo1_m1
  COL_IP_M1:         3,   // C: 10.0.3.151
  COL_PRIVKEY_M1:    4,   // D
  COL_PUBKEY_M1:     5,   // E
  COL_PSK_M1:        6,   // F
  COL_CONF_M1:       7,   // G
  COL_UUID_M1:       8,   // H
  COL_SLOT_M2:       9,   // I: equipo1_m2
  COL_IP_M2:         10,  // J: 10.0.3.152
  COL_PRIVKEY_M2:    11,  // K
  COL_PUBKEY_M2:     12,  // L
  COL_PSK_M2:        13,  // M
  COL_CONF_M2:       14,  // N
  COL_UUID_M2:       15,  // O
  COL_LIBRE:         16,  // P: TRUE / FALSE
  COL_NOMBRE_EQUIPO: 17,  // Q
  COL_NOMBRE_M1:     18,  // R
  COL_EMAIL_M1:      19,  // S
  COL_CENTRO_M1:     20,  // T
  COL_NOMBRE_M2:     21,  // U
  COL_EMAIL_M2:      22,  // V
  COL_CENTRO_M2:     23,  // W
  COL_THEHIVE_URL:   24,  // X
  COL_ENVIADO_EN:    25,  // Y

  // Columnas de TheHive
  COL_TH_URL:      1,   // A: URL de TheHive
  COL_TH_LIBRE:    2,   // B: TRUE / FALSE
  COL_TH_EQUIPO:   3,   // C: nombre del equipo asignado
  COL_TH_ASIGNADO: 4,   // D: timestamp de asignación

  // ── Email ──────────────────────────────────────────────────────
  EMAIL_SUBJECT:   'Tu acceso VPN — Jornadas Formativas SOCIA',
  EMAIL_FROM_NAME: 'Jornadas SOCIA · IES Rafael Alberti',
  ADMIN_EMAIL:     'TU_EMAIL_ADMIN',

  // ── Campos del formulario (posición en e.values[]) ─────────────
  // 0 = timestamp, luego en orden del form
  // Los SectionHeaderItem no generan valor — solo los campos de texto
  FORM_NOMBRE_M1:     1,
  FORM_EMAIL_M1:      2,
  FORM_CENTRO_M1:     3,
  FORM_NOMBRE_M2:     4,
  FORM_EMAIL_M2:      5,
  FORM_CENTRO_M2:     6,

  // ── Instrucciones de infraestructura ──────────────────────────
  INFRA_HTML: `
    <p>Añade aquí el HTML con las instrucciones de acceso a tu infraestructura.</p>
  `

};
