// ═══════════════════════════════════════════════════════════════════
//  Bootstrap.gs  —  Ejecutar UNA SOLA VEZ para montar todo el sistema
//  Jornadas Formativas SOCIA · IES Rafael Alberti
//
//  Qué hace:
//    1. Crea la hoja "Slots" con los 50 perfiles VPN
//    2. Aplica formato y validación
//    3. Crea el Google Form con los 3 campos
//    4. Vincula el Form al Spreadsheet
//    5. Instala el trigger onFormSubmit automáticamente
//
//  Cómo usarlo:
//    Apps Script → selecciona "setup" → ▶️ Run
//    Mira el Log para ver las URLs del Form y el Spreadsheet
// ═══════════════════════════════════════════════════════════════════

// ── Datos de los 50 slots (generados por setup_opnsense.py) ───────
// PLACEHOLDER — sustituido automáticamente por deploy.py antes del push
// NO editar manualmente; ejecutar: python3 setup/deploy.py
var SLOTS_DATA = [];

function setup() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Acción destructiva — setup()',
    'Esta función va a:\n\n' +
    '  • Borrar TODOS los datos de la hoja Slots\n' +
    '  • Crear un NUEVO Google Form\n' +
    '  • Reinstalar el trigger\n\n' +
    'Los slots ocupados y los registros existentes se perderán.\n\n' +
    '¿Confirmas que quieres continuar?',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) {
    Logger.log('setup() cancelada por el usuario.');
    return;
  }

  Logger.log('=== SETUP JORNADAS SOCIA ===');

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Crear / limpiar hoja Slots ──────────────────────────────
  var sheet = ss.getSheetByName('Slots');
  if (!sheet) {
    sheet = ss.insertSheet('Slots');
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  // ── 2. Cabecera ────────────────────────────────────────────────
  var headers = [
    'slot','ip','privkey','pubkey','psk','conf','uuid',
    'libre','nombre','email','centro','enviado_en'
  ];
  var hRange = sheet.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers]);
  hRange.setFontWeight('bold');
  hRange.setBackground('#1565c0');
  hRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // ── 3. Insertar datos de los 50 slots ──────────────────────────
  if (SLOTS_DATA.length === 0) {
    Logger.log('ERROR: SLOTS_DATA está vacío. Ejecuta inject_csv.py primero.');
    return;
  }

  var dataRows = SLOTS_DATA.map(function(r) {
    return [r[0],r[1],r[2],r[3],r[4],r[5],r[6],
            true,'','','',''];
  });
  sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

  // Formato condicional: libre=TRUE → verde, FALSE → rojo
  var rules = sheet.getConditionalFormatRules();
  var ruleVerde = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H2=TRUE')
    .setBackground('#c8e6c9')
    .setRanges([sheet.getRange('A2:L51')])
    .build();
  var ruleRojo = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H2=FALSE')
    .setBackground('#ffcdd2')
    .setRanges([sheet.getRange('A2:L51')])
    .build();
  sheet.setConditionalFormatRules([ruleVerde, ruleRojo]);

  // Ocultar columnas sensibles (privkey, pubkey, psk, conf, uuid)
  sheet.hideColumns(3, 5);  // C-G

  // Ajustar anchos
  sheet.setColumnWidth(1, 90);   // slot
  sheet.setColumnWidth(2, 110);  // ip
  sheet.setColumnWidth(8, 60);   // libre
  sheet.setColumnWidth(9, 180);  // nombre
  sheet.setColumnWidth(10, 200); // email
  sheet.setColumnWidth(11, 150); // centro
  sheet.setColumnWidth(12, 160); // enviado_en

  Logger.log('✅ Hoja Slots creada con ' + SLOTS_DATA.length + ' filas');

  // ── 4. Crear Google Form ───────────────────────────────────────
  var form = FormApp.create('Registro VPN — Jornadas Formativas SOCIA');
  form.setDescription(
    'Rellena este formulario para recibir tu acceso VPN por email.\n' +
    'En pocos segundos recibirás el archivo de configuración y las instrucciones.'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage(
    '✅ ¡Listo! En breve recibirás un email con tu configuración VPN. ' +
    'Revisa también la carpeta de spam.'
  );

  // Campo 1: Nombre completo
  form.addTextItem()
    .setTitle('Nombre completo')
    .setRequired(true);

  // Campo 2: Email
  var emailItem = form.addTextItem();
  emailItem.setTitle('Email');
  emailItem.setRequired(true);
  emailItem.setValidation(
    FormApp.createTextValidation()
      .requireTextIsEmail()
      .build()
  );

  // Campo 3: Centro educativo
  form.addTextItem()
    .setTitle('Centro educativo')
    .setRequired(true);

  // ── 5. Vincular Form → Spreadsheet ────────────────────────────
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('✅ Form creado y vinculado al spreadsheet');

  // ── 6. Instalar trigger onFormSubmit ───────────────────────────
  // Eliminar triggers previos del mismo tipo para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.log('✅ Trigger onFormSubmit instalado');

  // ── 7. Log de URLs ─────────────────────────────────────────────
  var formUrl = form.getPublishedUrl();
  var ssUrl   = ss.getUrl();

  Logger.log('');
  Logger.log('══════════════════════════════════════════');
  Logger.log('  SETUP COMPLETADO');
  Logger.log('  Spreadsheet: ' + ssUrl);
  Logger.log('  Form URL:    ' + formUrl);
  Logger.log('  Form edit:   ' + form.getEditUrl());
  Logger.log('══════════════════════════════════════════');
  Logger.log('Siguiente: ejecuta testEnvioEmail() para verificar el email');
}

function organizarEnCarpeta() {
  var NOMBRE_CARPETA = 'VPN Jornadas SOCIA';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Crear o reutilizar la carpeta ──────────────────────────────
  var iter = DriveApp.getFoldersByName(NOMBRE_CARPETA);
  var folder = iter.hasNext() ? iter.next() : DriveApp.createFolder(NOMBRE_CARPETA);
  Logger.log('Carpeta: ' + folder.getUrl());

  // ── Mover el Spreadsheet (y el script vinculado va con él) ─────
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  Logger.log('Spreadsheet movido: ' + ss.getUrl());

  // ── Mover el Formulario ────────────────────────────────────────
  var formUrl = ss.getFormUrl();
  if (formUrl) {
    var formId = formUrl.replace(/.*\/d\/([^\/]+).*/, '$1');
    DriveApp.getFileById(formId).moveTo(folder);
    Logger.log('Formulario movido: ' + formUrl);
  } else {
    Logger.log('No se encontro formulario vinculado al spreadsheet.');
  }

  Logger.log('');
  Logger.log('Todo organizado en: ' + folder.getUrl());
}

// ── Restaurar hoja Slots sin tocar el formulario ni el trigger ───────────────
// Usar cuando la hoja queda vacía por accidente. El Form y el trigger siguen igual.
function restoreSlotsOnly() {
  try {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert(
      '⚠️ Acción destructiva — restoreSlotsOnly()',
      'Esta función va a:\n\n' +
      '  • Borrar el contenido actual de la hoja Slots\n' +
      '  • Repoblarla con los slots de SLOTS_DATA\n\n' +
      'Los datos de asignación (nombre, email, libre) se perderán.\n' +
      'El formulario y el trigger NO se tocan.\n\n' +
      '¿Confirmas que quieres continuar?',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) {
      Logger.log('restoreSlotsOnly() cancelada por el usuario.');
      return;
    }
  } catch(e) {
    // Ejecutado desde el editor — se omite la confirmación visual
    Logger.log('restoreSlotsOnly() ejecutada desde el editor (sin confirmación UI).');
  }

  if (SLOTS_DATA.length === 0) {
    Logger.log('ERROR: SLOTS_DATA está vacío. Ejecuta run.py primero.');
    return;
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Slots');
  if (!sheet) {
    sheet = ss.insertSheet('Slots');
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  var headers = ['slot','ip','privkey','pubkey','psk','conf','uuid','libre','nombre','email','centro','enviado_en'];
  var hRange  = sheet.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers]);
  hRange.setFontWeight('bold');
  hRange.setBackground('#1565c0');
  hRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  var dataRows = SLOTS_DATA.map(function(r) {
    return [r[0],r[1],r[2],r[3],r[4],r[5],r[6],true,'','','',''];
  });
  sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

  var ruleVerde = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H2=TRUE')
    .setBackground('#c8e6c9')
    .setRanges([sheet.getRange(2, 1, dataRows.length, 12)])
    .build();
  var ruleRojo = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H2=FALSE')
    .setBackground('#ffcdd2')
    .setRanges([sheet.getRange(2, 1, dataRows.length, 12)])
    .build();
  sheet.setConditionalFormatRules([ruleVerde, ruleRojo]);

  sheet.hideColumns(3, 5);
  sheet.setColumnWidth(1, 90);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(8, 60);
  sheet.setColumnWidth(9, 180);
  sheet.setColumnWidth(10, 200);
  sheet.setColumnWidth(11, 150);
  sheet.setColumnWidth(12, 160);

  Logger.log('✅ Hoja Slots restaurada con ' + dataRows.length + ' slots (Form y trigger intactos)');
}

// ── Añadir slots sin resetear la hoja ─────────────────────────────────────────
// Usar en modo AÑADIR (run.py opción "a").
// Solo inserta los slots de SLOTS_DATA que no existan ya en la hoja.
function addSlotsToSheet() {
  if (SLOTS_DATA.length === 0) {
    Logger.log('ERROR: SLOTS_DATA esta vacio. Ejecuta run.py primero.');
    return;
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Slots');
  if (!sheet) {
    Logger.log('ERROR: No existe la hoja Slots. Ejecuta setup() primero.');
    return;
  }

  // Recoger nombres de slots ya presentes en la hoja
  var lastRow   = sheet.getLastRow();
  var existing  = {};
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues()
         .forEach(function(row) { existing[row[0]] = true; });
  }

  // Filtrar solo los nuevos
  var newRows = SLOTS_DATA.filter(function(r) { return !existing[r[0]]; });
  if (newRows.length === 0) {
    Logger.log('No hay slots nuevos que anadir (todos ya existen en la hoja).');
    return;
  }

  // Insertar
  var startRow = lastRow + 1;
  var data     = newRows.map(function(r) {
    return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], true, '', '', '', ''];
  });
  sheet.getRange(startRow, 1, data.length, 12).setValues(data);

  // Extender el formato condicional a las nuevas filas
  var endRow = startRow + data.length - 1;
  var rules  = sheet.getConditionalFormatRules();
  var rVerde = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H' + startRow + '=TRUE')
    .setBackground('#c8e6c9')
    .setRanges([sheet.getRange(startRow, 1, data.length, 12)])
    .build();
  var rRojo = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H' + startRow + '=FALSE')
    .setBackground('#ffcdd2')
    .setRanges([sheet.getRange(startRow, 1, data.length, 12)])
    .build();
  sheet.setConditionalFormatRules(rules.concat([rVerde, rRojo]));

  Logger.log('Anadidos ' + newRows.length + ' nuevos slots (filas ' + startRow + '-' + endRow + ')');
  Logger.log('Total de slots en la hoja: ' + (lastRow - 1 + newRows.length));
}

// ── Limpiar asignaciones y respuestas del formulario ─────────────────────────
// Libera todos los slots (libre=TRUE) y borra las respuestas del Form.
// NO borra los slots ni toca el formulario ni el trigger.
function resetAsignaciones() {
  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '⚠️ Limpiar asignaciones',
    'Esta función va a:\n\n' +
    '  • Marcar todos los slots como libre=TRUE\n' +
    '  • Borrar nombre, email, centro y fecha de cada slot\n' +
    '  • Eliminar las respuestas del formulario (dejando la cabecera)\n\n' +
    'Los slots en sí NO se borran. ¿Confirmas?',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) {
    Logger.log('resetAsignaciones() cancelada.');
    return;
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var slots = ss.getSheetByName('Slots');

  if (slots) {
    var lastRow = slots.getLastRow();
    if (lastRow > 1) {
      var numRows = lastRow - 1;
      // libre = TRUE
      slots.getRange(2, 8, numRows, 1).setValue(true);
      // nombre, email, centro, enviado_en = ''
      slots.getRange(2, 9, numRows, 4).clearContent();
    }
    Logger.log('✅ Slots liberados: ' + (lastRow - 1));
  } else {
    Logger.log('⚠️ No se encontró la hoja Slots');
  }

  // Limpiar respuestas del formulario (todas las hojas excepto Slots)
  var sheets = ss.getSheets();
  sheets.forEach(function(sheet) {
    var name = sheet.getName();
    if (name !== 'Slots') {
      var lr = sheet.getLastRow();
      if (lr > 1) {
        sheet.deleteRows(2, lr - 1);
        Logger.log('✅ Respuestas borradas en hoja: ' + name);
      }
    }
  });

  ui.alert('✅ Listo', 'Slots liberados y respuestas del formulario eliminadas.', ui.ButtonSet.OK);
}
