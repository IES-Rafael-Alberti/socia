// ═══════════════════════════════════════════════════════════════════
//  Code_team.gs  —  Lógica principal del registro por equipos
//  Jornadas Formativas SOCIA · IES Rafael Alberti
// ═══════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ SOCIA Admin — Equipos')
    .addItem('Estado de equipos',          'estadoEquipos')
    .addSeparator()
    .addItem('Limpiar asignaciones',       'resetAsignacionesTeam')
    .addSeparator()
    .addItem('Setup completo (⚠️)',        'setupTeam')
    .addToUi();
}

/**
 * Trigger que se ejecuta cuando un equipo envía el formulario.
 * Asigna el primer slot de equipo libre + la primera URL TheHive libre.
 * Envía un email personalizado a cada miembro del equipo.
 */
function onFormSubmitTeam(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    Logger.log('Lock no disponible: ' + err);
    return;
  }

  try {
    var values   = e.values;
    var nombreM1 = values[CONFIG_TEAM.FORM_NOMBRE_M1] || '';
    var emailM1      = values[CONFIG_TEAM.FORM_EMAIL_M1]      || '';
    var centroM1     = values[CONFIG_TEAM.FORM_CENTRO_M1]     || '';
    var nombreM2     = values[CONFIG_TEAM.FORM_NOMBRE_M2]     || '';
    var emailM2      = values[CONFIG_TEAM.FORM_EMAIL_M2]      || '';
    var centroM2     = values[CONFIG_TEAM.FORM_CENTRO_M2]     || '';

    if (!emailM1 || !emailM2) {
      Logger.log('Emails vacíos — se ignora la respuesta');
      return;
    }

    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var slotsSheet = ss.getSheetByName(CONFIG_TEAM.SHEET_SLOTS);
    var thSheet    = ss.getSheetByName(CONFIG_TEAM.SHEET_THEHIVE);

    if (!slotsSheet) throw new Error('No existe la hoja "' + CONFIG_TEAM.SHEET_SLOTS + '"');
    if (!thSheet)    throw new Error('No existe la hoja "' + CONFIG_TEAM.SHEET_THEHIVE + '"');

    // ── Buscar primer equipo libre ─────────────────────────────
    var slotsData = slotsSheet.getDataRange().getValues();
    var slotRow   = -1;

    for (var i = 1; i < slotsData.length; i++) {
      var libre = slotsData[i][CONFIG_TEAM.COL_LIBRE - 1];
      if (libre === true || libre === 'TRUE' || libre === 'true') {
        slotRow = i + 1;
        break;
      }
    }

    if (slotRow === -1) {
      GmailApp.sendEmail(
        CONFIG_TEAM.ADMIN_EMAIL,
        '⚠️ Sin slots de equipo disponibles — Jornadas SOCIA',
        'Intento de registro sin slots libres: ' + emailM1 + ', ' + emailM2
      );
      Logger.log('Sin slots de equipo libres para: ' + emailM1 + ', ' + emailM2);
      return;
    }

    // ── Buscar primera URL TheHive libre ───────────────────────
    var thData  = thSheet.getDataRange().getValues();
    var thRow   = -1;
    var thehiveUrl = '';

    for (var j = 1; j < thData.length; j++) {
      var thLibre = thData[j][CONFIG_TEAM.COL_TH_LIBRE - 1];
      if (thLibre === true || thLibre === 'TRUE' || thLibre === 'true') {
        thRow      = j + 1;
        thehiveUrl = thData[j][CONFIG_TEAM.COL_TH_URL - 1];
        break;
      }
    }

    if (thRow === -1) {
      GmailApp.sendEmail(
        CONFIG_TEAM.ADMIN_EMAIL,
        '⚠️ Sin URLs TheHive disponibles — Jornadas SOCIA',
        'Equipo (' + emailM1 + ', ' + emailM2 + ') registrado pero sin URLs TheHive libres.\n' +
        'Añade más URLs a la hoja TheHive.'
      );
      Logger.log('Sin URLs TheHive libres para: ' + emailM1 + ', ' + emailM2);
      return;
    }

    // ── Leer datos del slot de equipo ──────────────────────────
    var row    = slotsSheet.getRange(slotRow, 1, 1, CONFIG_TEAM.COL_ENVIADO_EN).getValues()[0];
    var equipo = row[CONFIG_TEAM.COL_EQUIPO   - 1];
    var slotM1 = row[CONFIG_TEAM.COL_SLOT_M1  - 1];
    var ipM1   = row[CONFIG_TEAM.COL_IP_M1    - 1];
    var confM1 = row[CONFIG_TEAM.COL_CONF_M1  - 1];
    var slotM2 = row[CONFIG_TEAM.COL_SLOT_M2  - 1];
    var ipM2   = row[CONFIG_TEAM.COL_IP_M2    - 1];
    var confM2 = row[CONFIG_TEAM.COL_CONF_M2  - 1];

    // ── Marcar slot como ocupado ───────────────────────────────
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_LIBRE).setValue(false);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_NOMBRE_M1).setValue(nombreM1);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_EMAIL_M1).setValue(emailM1);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_CENTRO_M1).setValue(centroM1);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_NOMBRE_M2).setValue(nombreM2);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_EMAIL_M2).setValue(emailM2);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_CENTRO_M2).setValue(centroM2);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_THEHIVE_URL).setValue(thehiveUrl);
    slotsSheet.getRange(slotRow, CONFIG_TEAM.COL_ENVIADO_EN).setValue(new Date());

    // ── Marcar URL TheHive como ocupada ────────────────────────
    thSheet.getRange(thRow, CONFIG_TEAM.COL_TH_LIBRE).setValue(false);
    thSheet.getRange(thRow, CONFIG_TEAM.COL_TH_EQUIPO).setValue(equipo);
    thSheet.getRange(thRow, CONFIG_TEAM.COL_TH_ASIGNADO).setValue(new Date());

    SpreadsheetApp.flush();

    // ── Enviar emails ──────────────────────────────────────────
    EmailServiceTeam.send(
      thehiveUrl,
      nombreM1, emailM1, centroM1, slotM1, ipM1, confM1,
      nombreM2, emailM2, centroM2, slotM2, ipM2, confM2
    );

    Logger.log('VPN equipo enviada: ' + equipo + ' → ' + emailM1 + ', ' + emailM2 +
               ' | TheHive: ' + thehiveUrl);

  } catch (err) {
    Logger.log('Error en onFormSubmitTeam: ' + err);
    GmailApp.sendEmail(
      CONFIG_TEAM.ADMIN_EMAIL,
      '❌ Error en registro de equipo — Jornadas SOCIA',
      'Error procesando registro:\n\n' + err.toString() +
      '\n\nDatos del form: ' + JSON.stringify(e.values)
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Test manual — envía un email de prueba a tu propia cuenta.
 */
function testEnvioEmailTeam() {
  var adminEmail = Session.getActiveUser().getEmail();
  // values[0] = timestamp, luego los 6 campos del formulario en orden
  var fakeEvent = {
    values: [
      new Date().toISOString(),       // 0 timestamp
      'Integrante Uno (test)',        // 1 nombre_m1
      adminEmail,                     // 2 email_m1
      'IES Rafael Alberti',           // 3 centro_m1
      'Integrante Dos (test)',        // 4 nombre_m2
      adminEmail,                     // 5 email_m2  (mismo email para recibir ambos)
      'IES Rafael Alberti'            // 6 centro_m2
    ]
  };
  onFormSubmitTeam(fakeEvent);
  Logger.log('Test completado — revisa tu bandeja de entrada (' + adminEmail + ')');
}

/**
 * Muestra en el log cuántos equipos y URLs TheHive quedan disponibles.
 */
function estadoEquipos() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var slots = ss.getSheetByName(CONFIG_TEAM.SHEET_SLOTS);
  var th    = ss.getSheetByName(CONFIG_TEAM.SHEET_THEHIVE);

  var libresSlots = 0, ocupadosSlots = 0;
  if (slots) {
    var data = slots.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var l = data[i][CONFIG_TEAM.COL_LIBRE - 1];
      if (l === true || l === 'TRUE' || l === 'true') libresSlots++;
      else ocupadosSlots++;
    }
  }

  var libresTH = 0, ocupadosTH = 0;
  if (th) {
    var thData = th.getDataRange().getValues();
    for (var j = 1; j < thData.length; j++) {
      var tl = thData[j][CONFIG_TEAM.COL_TH_LIBRE - 1];
      if (tl === true || tl === 'TRUE' || tl === 'true') libresTH++;
      else ocupadosTH++;
    }
  }

  var msg = 'Slots de equipo libres: ' + libresSlots + ' / ' + (libresSlots + ocupadosSlots) +
            '\nURLs TheHive libres: ' + libresTH + ' / ' + (libresTH + ocupadosTH);
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
}
