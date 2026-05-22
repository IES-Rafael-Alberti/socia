// ═══════════════════════════════════════════════════════════════════
//  Bootstrap_team.gs  —  Setup del sistema de registro por equipos
//  Jornadas Formativas SOCIA · IES Rafael Alberti
//
//  Qué hace setupTeam():
//    1. Crea la hoja "Slots_Equipos" con los perfiles VPN por equipo
//    2. Crea la hoja "TheHive" (vacía — rellénala tú con las URLs)
//    3. Crea el Google Form con 4 campos
//    4. Vincula el Form al Spreadsheet
//    5. Instala el trigger onFormSubmitTeam
//
//  Cómo usarlo:
//    Apps Script → selecciona "setupTeam" → ▶️ Run
//    Después rellena la hoja TheHive con las URLs antes de la jornada.
// ═══════════════════════════════════════════════════════════════════

// PLACEHOLDER — sustituido automáticamente por run_team.py antes del push
// NO editar manualmente; ejecutar: python3 setup/run_team.py
var SLOTS_TEAM_DATA = [];

// URLs de TheHive — una por equipo (puertos 9101-9150)
var THEHIVE_URLS = (function() {
  var urls = [];
  for (var p = 9101; p <= 9150; p++) {
    urls.push('http://172.17.33.200:' + p);
  }
  return urls;
})();

function setupTeam() {
  try {
    var ui   = SpreadsheetApp.getUi();
    var resp = ui.alert(
      '⚠️ Acción destructiva — setupTeam()',
      'Esta función va a:\n\n' +
      '  • Borrar TODOS los datos de la hoja Slots_Equipos\n' +
      '  • Crear la hoja TheHive (si no existe)\n' +
      '  • Crear un NUEVO Google Form de equipos\n' +
      '  • Reinstalar el trigger\n\n' +
      '¿Confirmas que quieres continuar?',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) {
      Logger.log('setupTeam() cancelada por el usuario.');
      return;
    }
  } catch(e) {
    Logger.log('setupTeam() ejecutada desde el editor — confirmación omitida.');
  }

  Logger.log('=== SETUP EQUIPOS SOCIA ===');

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Crear / limpiar hoja Slots_Equipos ─────────────────────
  var sheet = ss.getSheetByName(CONFIG_TEAM.SHEET_SLOTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_TEAM.SHEET_SLOTS);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  // ── 2. Cabecera ────────────────────────────────────────────────
  var headers = [
    'equipo',
    'slot_m1','ip_m1','privkey_m1','pubkey_m1','psk_m1','conf_m1','uuid_m1',
    'slot_m2','ip_m2','privkey_m2','pubkey_m2','psk_m2','conf_m2','uuid_m2',
    'libre','nombre_equipo',
    'nombre_m1','email_m1','centro_m1',
    'nombre_m2','email_m2','centro_m2',
    'thehive_url','enviado_en'
  ];
  var hRange = sheet.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers]);
  hRange.setFontWeight('bold');
  hRange.setBackground('#1565c0');
  hRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // ── 3. Insertar datos de los equipos ───────────────────────────
  if (SLOTS_TEAM_DATA.length === 0) {
    Logger.log('ERROR: SLOTS_TEAM_DATA está vacío. Ejecuta run_team.py primero.');
    return;
  }

  var dataRows = SLOTS_TEAM_DATA.map(function(r) {
    // r = [equipo, slot_m1, ip_m1, priv1, pub1, psk1, conf1, uuid1,
    //             slot_m2, ip_m2, priv2, pub2, psk2, conf2, uuid2]
    return [r[0], r[1],r[2],r[3],r[4],r[5],r[6],r[7],
                  r[8],r[9],r[10],r[11],r[12],r[13],r[14],
            true,'','','','','','','','',''];
  });
  sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

  // Formato condicional
  var ruleVerde = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$P2=TRUE')
    .setBackground('#c8e6c9')
    .setRanges([sheet.getRange(2, 1, dataRows.length, headers.length)])
    .build();
  var ruleRojo = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$P2=FALSE')
    .setBackground('#ffcdd2')
    .setRanges([sheet.getRange(2, 1, dataRows.length, headers.length)])
    .build();
  sheet.setConditionalFormatRules([ruleVerde, ruleRojo]);

  // Ocultar columnas sensibles (privkey, pubkey, psk, conf, uuid de ambos miembros)
  // Columnas D-H (4-8) y K-O (11-15)
  sheet.hideColumns(4, 5);
  sheet.hideColumns(11, 5);

  sheet.setColumnWidth(1, 90);   // equipo
  sheet.setColumnWidth(2, 110);  // slot_m1
  sheet.setColumnWidth(3, 110);  // ip_m1
  sheet.setColumnWidth(9, 110);  // slot_m2
  sheet.setColumnWidth(10, 110); // ip_m2
  sheet.setColumnWidth(16, 60);  // libre
  sheet.setColumnWidth(17, 160); // nombre_equipo
  sheet.setColumnWidth(18, 160); // nombre_m1
  sheet.setColumnWidth(19, 200); // email_m1
  sheet.setColumnWidth(20, 150); // centro_m1
  sheet.setColumnWidth(21, 160); // nombre_m2
  sheet.setColumnWidth(22, 200); // email_m2
  sheet.setColumnWidth(23, 150); // centro_m2
  sheet.setColumnWidth(24, 260); // thehive_url
  sheet.setColumnWidth(25, 160); // enviado_en

  Logger.log('✅ Hoja Slots_Equipos creada con ' + SLOTS_TEAM_DATA.length + ' equipos');

  // ── 4. Crear / limpiar hoja TheHive y poblarla con las URLs ───
  var thSheet = ss.getSheetByName(CONFIG_TEAM.SHEET_THEHIVE);
  if (!thSheet) {
    thSheet = ss.insertSheet(CONFIG_TEAM.SHEET_THEHIVE);
  } else {
    thSheet.clearContents();
    thSheet.clearFormats();
  }

  var thHeaders = ['url','libre','equipo','asignado_en'];
  var thRange   = thSheet.getRange(1, 1, 1, thHeaders.length);
  thRange.setValues([thHeaders]);
  thRange.setFontWeight('bold');
  thRange.setBackground('#37474f');
  thRange.setFontColor('#ffffff');
  thSheet.setFrozenRows(1);
  thSheet.setColumnWidth(1, 280); // url
  thSheet.setColumnWidth(2, 60);  // libre
  thSheet.setColumnWidth(3, 120); // equipo
  thSheet.setColumnWidth(4, 160); // asignado_en

  var thRows = THEHIVE_URLS.map(function(url) {
    return [url, true, '', ''];
  });
  thSheet.getRange(2, 1, thRows.length, 4).setValues(thRows);

  // Formato condicional TheHive: libre=TRUE → verde, FALSE → rojo
  var thRuleVerde = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2=TRUE')
    .setBackground('#c8e6c9')
    .setRanges([thSheet.getRange(2, 1, thRows.length, 4)])
    .build();
  var thRuleRojo = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$B2=FALSE')
    .setBackground('#ffcdd2')
    .setRanges([thSheet.getRange(2, 1, thRows.length, 4)])
    .build();
  thSheet.setConditionalFormatRules([thRuleVerde, thRuleRojo]);

  Logger.log('✅ Hoja TheHive creada con ' + thRows.length + ' URLs (puertos 9101-9150)');

  // ── 5. Limpiar forms antiguos y reutilizar el activo ─────────
  // Identificar el form activo (el que getFormUrl() devuelve)
  var existingFormUrl = ss.getFormUrl();
  var activeFormId    = existingFormUrl
    ? existingFormUrl.replace(/.*\/d\/([^\/]+).*/, '$1')
    : null;

  // Recorrer TODOS los forms del Drive: desvincular los que no son el activo
  // (removeDestination elimina su hoja de respuestas automáticamente)
  var allForms = DriveApp.searchFiles('mimeType = "application/vnd.google-apps.form"');
  while (allForms.hasNext()) {
    var fFile = allForms.next();
    if (fFile.getId() === activeFormId) continue;
    try {
      var otherForm = FormApp.openById(fFile.getId());
      if (otherForm.getDestinationId() === ss.getId()) {
        otherForm.removeDestination();
        Logger.log('🔗 Form antiguo desvinculado: ' + fFile.getName());
      }
    } catch(fe) {}
  }

  // Forzar propagación antes de intentar borrar hojas
  SpreadsheetApp.flush();

  // Reutilizar el form activo o crear uno nuevo si no existe
  var form      = null;
  var formIsNew = false;
  if (activeFormId) {
    try {
      form = FormApp.openById(activeFormId);
      form.getItems().forEach(function(item) { form.deleteItem(item); });
      Logger.log('✅ Formulario reutilizado (ítems reiniciados)');
    } catch(e) { form = null; }
  }
  if (!form) {
    form      = FormApp.create('Registro de Equipo — Jornadas Formativas SOCIA');
    formIsNew = true;
  }

  form.setTitle('Registro de Equipo — Jornadas Formativas SOCIA');
  form.setDescription(
    '⚠️ Este formulario es para equipos de DOS personas. Rellena los datos de ambos integrantes antes de enviarlo — solo hay que enviar uno por pareja.\n\n' +
    'Cada integrante recibirá su configuración VPN por email, junto con las instrucciones de acceso a las diferentes herramientas que se usarán.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage(
    '✅ ¡Equipo registrado! Cada integrante recibirá en breve un email con su configuración VPN. ' +
    'Revisad también la carpeta de spam.'
  );

  // ── Integrante 1 ──────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Integrante 1');

  form.addTextItem()
    .setTitle('Nombre completo')
    .setRequired(true);

  var emailItem1 = form.addTextItem();
  emailItem1.setTitle('Email');
  emailItem1.setRequired(true);
  emailItem1.setValidation(
    FormApp.createTextValidation().requireTextIsEmail().build()
  );

  form.addTextItem()
    .setTitle('Centro educativo')
    .setRequired(true);

  // ── Integrante 2 ──────────────────────────────────────────────
  form.addSectionHeaderItem()
    .setTitle('Integrante 2');

  form.addTextItem()
    .setTitle('Nombre completo')
    .setRequired(true);

  var emailItem2 = form.addTextItem();
  emailItem2.setTitle('Email');
  emailItem2.setRequired(true);
  emailItem2.setValidation(
    FormApp.createTextValidation().requireTextIsEmail().build()
  );

  form.addTextItem()
    .setTitle('Centro educativo')
    .setRequired(true);

  // ── 6. Vincular Form → Spreadsheet (solo si es nuevo) ─────────
  var responseSheetName = null;
  if (formIsNew) {
    var sheetsBefore = ss.getSheets().map(function(s) { return s.getName(); });
    form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    SpreadsheetApp.flush();
    ss.getSheets().forEach(function(s) {
      if (sheetsBefore.indexOf(s.getName()) === -1) responseSheetName = s.getName();
    });
    Logger.log('✅ Form nuevo vinculado — hoja de respuestas: ' + responseSheetName);
  } else {
    Logger.log('✅ Form actualizado (sin nueva hoja de respuestas)');
  }

  // ── Limpiar hojas de respuestas sobrantes ─────────────────────
  // removeDestination() ya eliminó las hojas de forms antiguos automáticamente;
  // por si queda algún residuo, borramos todo excepto las hojas de datos
  var keepSheets = [CONFIG_TEAM.SHEET_SLOTS, CONFIG_TEAM.SHEET_THEHIVE];
  if (responseSheetName) keepSheets.push(responseSheetName);
  var extraSheets = ss.getSheets().filter(function(s) {
    return keepSheets.indexOf(s.getName()) === -1;
  });
  extraSheets.slice(0, extraSheets.length - 1).forEach(function(s) {
    try {
      ss.deleteSheet(s);
      Logger.log('🗑️ Hoja sobrante eliminada: ' + s.getName());
    } catch(de) {
      // Si no se puede eliminar (form aún vinculado), la ocultamos
      try {
        s.hideSheet();
        Logger.log('👁 Hoja ocultada (pendiente de eliminar manualmente): ' + s.getName());
      } catch(he) {
        Logger.log('⚠️ No se pudo eliminar ni ocultar: ' + s.getName());
      }
    }
  });

  // ── 7. Instalar trigger onFormSubmitTeam ───────────────────────
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onFormSubmitTeam') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onFormSubmitTeam')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.log('✅ Trigger onFormSubmitTeam instalado');

  // ── 8. Mover a carpeta "VPN Jornadas SOCIA" en Drive ──────────
  var CARPETA = 'VPN Jornadas SOCIA';
  var iter    = DriveApp.getFoldersByName(CARPETA);
  var folder  = iter.hasNext() ? iter.next() : DriveApp.createFolder(CARPETA);

  DriveApp.getFileById(ss.getId()).moveTo(folder);
  Logger.log('✅ Spreadsheet movido a carpeta: ' + CARPETA);

  var formUrl = ss.getFormUrl();
  if (formUrl) {
    var formId = formUrl.replace(/.*\/d\/([^\/]+).*/, '$1');
    DriveApp.getFileById(formId).moveTo(folder);
    Logger.log('✅ Formulario movido a carpeta: ' + CARPETA);
  }

  // ── 9. Log de URLs ─────────────────────────────────────────────
  Logger.log('');
  Logger.log('══════════════════════════════════════════');
  Logger.log('  SETUP EQUIPOS COMPLETADO');
  Logger.log('  Carpeta Drive: ' + folder.getUrl());
  Logger.log('  Spreadsheet:   ' + ss.getUrl());
  Logger.log('  Form URL:      ' + form.getPublishedUrl());
  Logger.log('  Form edit:     ' + form.getEditUrl());
  Logger.log('══════════════════════════════════════════');
  Logger.log('✅ Listo — la hoja TheHive ya tiene las 50 URLs cargadas');
}

// ── Reset de asignaciones (para reutilizar entre jornadas) ────────────────────
function resetAsignacionesTeam() {
  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Limpiar asignaciones de equipos',
    'Esta función va a:\n\n' +
    '  • Marcar todos los slots como libre=TRUE\n' +
    '  • Borrar nombre, emails, centro, URL TheHive y fecha\n' +
    '  • Liberar todas las URLs en la hoja TheHive\n' +
    '  • Eliminar las respuestas del formulario\n\n' +
    '¿Confirmas?',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) return;

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var slots = ss.getSheetByName(CONFIG_TEAM.SHEET_SLOTS);

  if (slots) {
    var lastRow = slots.getLastRow();
    if (lastRow > 1) {
      var n = lastRow - 1;
      slots.getRange(2, CONFIG_TEAM.COL_LIBRE, n, 1).setValue(true);
      slots.getRange(2, CONFIG_TEAM.COL_NOMBRE_EQUIPO, n, 9).clearContent(); // Q-Y
    }
    Logger.log('✅ Slots de equipos liberados: ' + (lastRow - 1));
  }

  // Liberar URLs en TheHive
  var thSheet = ss.getSheetByName(CONFIG_TEAM.SHEET_THEHIVE);
  if (thSheet) {
    var thLast = thSheet.getLastRow();
    if (thLast > 1) {
      var thN = thLast - 1;
      thSheet.getRange(2, CONFIG_TEAM.COL_TH_LIBRE, thN, 1).setValue(true);
      thSheet.getRange(2, CONFIG_TEAM.COL_TH_EQUIPO, thN, 2).clearContent();
    }
    Logger.log('✅ URLs TheHive liberadas: ' + (thLast - 1));
  }

  // Borrar respuestas del formulario
  ss.getSheets().forEach(function(sheet) {
    if (sheet.getName() !== CONFIG_TEAM.SHEET_SLOTS &&
        sheet.getName() !== CONFIG_TEAM.SHEET_THEHIVE) {
      var lr = sheet.getLastRow();
      if (lr > 1) sheet.deleteRows(2, lr - 1);
    }
  });

  ui.alert('✅ Listo', 'Asignaciones de equipos eliminadas y URLs TheHive liberadas.', ui.ButtonSet.OK);
}
