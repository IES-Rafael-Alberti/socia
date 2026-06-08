// ═══════════════════════════════════════════════════════════════════
//  Code.gs  —  Lógica principal y trigger del formulario
//  Jornadas Formativas SOCIA · IES Rafael Alberti
// ═══════════════════════════════════════════════════════════════════

/**
 * Crea el menú SOCIA Admin en el spreadsheet al abrirlo.
 * Desde aquí se ejecutan las funciones administrativas con el contexto correcto.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ SOCIA Admin')
    .addItem('Estado de slots',          'estadoSlots')
    .addSeparator()
    .addItem('Limpiar asignaciones',     'resetAsignaciones')
    .addItem('Restaurar hoja Slots',     'restoreSlotsOnly')
    .addSeparator()
    .addItem('Setup completo (⚠️)',      'setup')
    .addToUi();
}

/**
 * Trigger que se ejecuta cada vez que alguien envía el Google Form.
 * Asigna el primer slot VPN libre y envía el email con la config.
 *
 * Cómo instalar el trigger:
 *   Apps Script → Triggers → + Add Trigger
 *   Función: onFormSubmit | Evento: From spreadsheet → On form submit
 */
function onFormSubmit(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    Logger.log('Lock no disponible: ' + err);
    return;
  }

  try {
    // ── Leer respuesta del formulario ──────────────────────────
    var values  = e.values;
    var nombre  = values[CONFIG.FORM_NOMBRE]  || '';
    var email   = values[CONFIG.FORM_EMAIL]   || '';
    var centro  = values[CONFIG.FORM_CENTRO]  || '';

    if (!email) {
      Logger.log('Email vacío — se ignora la respuesta');
      return;
    }

    // ── Buscar primer slot libre ───────────────────────────────
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEET_SLOTS);
    if (!sheet) {
      throw new Error('No existe la hoja "' + CONFIG.SHEET_SLOTS + '"');
    }

    var data     = sheet.getDataRange().getValues();
    var slotRow  = -1;

    for (var i = 1; i < data.length; i++) {       // fila 1 = cabecera
      var libre = data[i][CONFIG.COL_LIBRE - 1];
      if (libre === true || libre === 'TRUE' || libre === 'true') {
        slotRow = i + 1;                           // Sheet usa base 1
        break;
      }
    }

    // Sin slots disponibles → aviso al admin
    if (slotRow === -1) {
      GmailApp.sendEmail(
        CONFIG.ADMIN_EMAIL,
        '⚠️ Sin slots VPN disponibles — Jornadas SOCIA',
        'El profesor ' + nombre + ' <' + email + '> de ' + centro +
        ' intentó registrarse pero no quedan slots libres.\n\n' +
        'Revisa el spreadsheet para liberar o añadir slots.'
      );
      Logger.log('Sin slots libres para: ' + email);
      return;
    }

    // ── Leer datos del slot ────────────────────────────────────
    var row  = sheet.getRange(slotRow, 1, 1, CONFIG.COL_ENVIADO_EN).getValues()[0];
    var slot = row[CONFIG.COL_SLOT - 1];
    var ip   = row[CONFIG.COL_IP   - 1];
    var conf = row[CONFIG.COL_CONF - 1];

    // ── Marcar slot como ocupado (antes de enviar email) ───────
    sheet.getRange(slotRow, CONFIG.COL_LIBRE).setValue(false);
    sheet.getRange(slotRow, CONFIG.COL_NOMBRE).setValue(nombre);
    sheet.getRange(slotRow, CONFIG.COL_EMAIL).setValue(email);
    sheet.getRange(slotRow, CONFIG.COL_CENTRO).setValue(centro);
    sheet.getRange(slotRow, CONFIG.COL_ENVIADO_EN).setValue(new Date());
    SpreadsheetApp.flush();

    // ── Enviar email con config VPN ────────────────────────────
    EmailService.send(nombre, email, centro, slot, ip, conf);

    Logger.log('VPN enviada: ' + slot + ' → ' + email);

  } catch (err) {
    Logger.log('Error en onFormSubmit: ' + err);
    GmailApp.sendEmail(
      CONFIG.ADMIN_EMAIL,
      '❌ Error en registro VPN — Jornadas SOCIA',
      'Error procesando registro:\n\n' + err.toString() +
      '\n\nDatos del form: ' + JSON.stringify(e.values)
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Función de test — ejecútala manualmente desde el editor
 * para comprobar que el email se genera y envía correctamente
 * antes de la jornada.
 */
function testEnvioEmail() {
  var fakeEvent = {
    values: [
      new Date().toISOString(),        // timestamp
      'Profesor de Prueba',            // nombre
      Session.getActiveUser().getEmail(), // tu propio email
      'IES Rafael Alberti'             // centro
    ]
  };
  onFormSubmit(fakeEvent);
  Logger.log('Test completado — revisa tu bandeja de entrada');
}

/**
 * Muestra en el log cuántos slots quedan libres.
 */
function estadoSlots() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_SLOTS);
  var data  = sheet.getDataRange().getValues();
  var libres = 0, ocupados = 0;

  for (var i = 1; i < data.length; i++) {
    var libre = data[i][CONFIG.COL_LIBRE - 1];
    if (libre === true || libre === 'TRUE' || libre === 'true') libres++;
    else ocupados++;
  }

  var msg = 'Slots libres: ' + libres + ' / ' + (libres + ocupados);
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
