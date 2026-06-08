// ═══════════════════════════════════════════════════════════════════
//  EmailService_team.gs  —  Email de equipo con imagen corporativa
//  Jornadas Formativas SOCIA · IES Rafael Alberti
// ═══════════════════════════════════════════════════════════════════

var EmailServiceTeam = {

  /**
   * Envía un email a cada miembro del equipo con su .conf individual
   * y la URL de TheHive compartida por el equipo.
   */
  send: function(thehiveUrl,
                 nombreM1, emailM1, centroM1, slotM1, ipM1, confM1,
                 nombreM2, emailM2, centroM2, slotM2, ipM2, confM2) {

    var subject  = CONFIG_TEAM.EMAIL_SUBJECT;
    var fromName = CONFIG_TEAM.EMAIL_FROM_NAME;
    var replyTo  = CONFIG_TEAM.ADMIN_EMAIL;

    // Email al integrante 1
    var blob1 = Utilities.newBlob(confM1, 'text/plain', slotM1 + '.conf');
    GmailApp.sendEmail(
      emailM1, subject,
      EmailServiceTeam._plainText(nombreM1, slotM1, ipM1, nombreM2, emailM2, thehiveUrl),
      {
        name: fromName,
        htmlBody: EmailServiceTeam._buildHtml(nombreM1, centroM1, thehiveUrl,
                                              slotM1, ipM1, nombreM2, emailM2),
        attachments: [blob1],
        replyTo: replyTo,
      }
    );

    // Email al integrante 2
    var blob2 = Utilities.newBlob(confM2, 'text/plain', slotM2 + '.conf');
    GmailApp.sendEmail(
      emailM2, subject,
      EmailServiceTeam._plainText(nombreM2, slotM2, ipM2, nombreM1, emailM1, thehiveUrl),
      {
        name: fromName,
        htmlBody: EmailServiceTeam._buildHtml(nombreM2, centroM2, thehiveUrl,
                                              slotM2, ipM2, nombreM1, emailM1),
        attachments: [blob2],
        replyTo: replyTo,
      }
    );
  },

  _plainText: function(nombre, slot, ip, compNombre, compEmail, thehiveUrl) {
    return (
      'Hola ' + nombre + ',\n\n' +
      'Tu perfil VPN: ' + slot + ' | IP: ' + ip + '\n' +
      'Tu compañero/a: ' + compNombre + ' (' + compEmail + ')\n\n' +
      'TheHive (acceso de equipo): ' + thehiveUrl + '\n\n' +
      'El archivo ' + slot + '.conf está adjunto.\n\n' +
      'Jornadas SOCIA · IES Rafael Alberti'
    );
  },

  _buildHtml: function(nombre, centro, thehiveUrl, slot, ip, compNombre, compEmail) {
    return '<!DOCTYPE html>' +
'<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
'<body style="margin:0;padding:0;background:#e8e8e8;font-family:Arial,Helvetica,sans-serif;">' +
'<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e8e8;padding:28px 0;"><tr><td align="center">' +
'<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.13);border:1px solid #e0e0e0;">' +

'<tr><td style="background:#eb114b;padding:28px 32px 20px;">' +
'<div style="font-family:Arial Black,Arial,sans-serif;font-weight:900;font-size:72px;line-height:1;color:#fff;text-transform:uppercase;letter-spacing:-1px;">SOCIA</div>' +
'<div style="font-size:14px;color:rgba(255,255,255,.88);margin-top:8px;font-style:italic;">Un SOC en tu aula</div>' +
'<div style="margin-top:14px;"><table cellpadding="0" cellspacing="0"><tr>' +
'<td style="background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.22);border-radius:20px;padding:5px 14px;">' +
'<span style="color:rgba(255,255,255,.88);font-size:10px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;">Jornadas Formativas &middot; Registro por Equipos</span>' +
'</td></tr></table></div>' +
'</td></tr>' +

'<tr><td style="padding:28px 32px 16px;">' +
'<p style="font-size:17px;color:#1a1a1a;margin:0 0 6px;"><strong>Hola ' + nombre.split(' ')[0] + ',</strong></p>' +
'<p style="color:#555;line-height:1.7;margin:0;font-size:14px;">Tu acceso a la plataforma SOCIA está listo. En este correo encontrarás tu perfil VPN adjunto y las instrucciones para conectarte.</p>' +
'</td></tr>' +

'<tr><td style="padding:0 32px 16px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td style="padding-right:10px;white-space:nowrap;"><span style="font-size:10px;font-weight:bold;color:#eb114b;letter-spacing:2.5px;text-transform:uppercase;">Tu acceso</span></td>' +
'<td style="border-bottom:1px solid #e8e8e8;">&nbsp;</td>' +
'</tr></table></td></tr>' +

'<tr><td style="padding:0 32px 24px;">' +
'<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(235,17,75,.06);border-left:4px solid #eb114b;"><tr>' +
'<td style="padding:12px 18px;border-right:1px solid rgba(235,17,75,.15);">' +
'<div style="color:#eb114b;font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;">Perfil VPN</div>' +
'<strong style="font-size:16px;color:#1a1a1a;">' + slot + '</strong>' +
'</td>' +
'<td style="padding:12px 18px;border-right:1px solid rgba(235,17,75,.15);">' +
'<div style="color:#eb114b;font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;">IP asignada</div>' +
'<strong style="font-size:16px;color:#1a1a1a;font-family:monospace;">' + ip + '</strong>' +
'</td>' +
'<td style="padding:12px 18px;">' +
'<div style="color:#eb114b;font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;">Compañero/a</div>' +
'<strong style="font-size:13px;color:#1a1a1a;">' + compNombre.split(' ')[0] + '</strong><br>' +
'<span style="font-size:12px;color:#888;">' + compEmail + '</span>' +
'</td>' +
'</tr></table>' +
'</td></tr>' +

'<tr><td style="padding:0 32px 16px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td style="padding-right:10px;white-space:nowrap;"><span style="font-size:10px;font-weight:bold;color:#eb114b;letter-spacing:2.5px;text-transform:uppercase;">Configurar tu VPN</span></td>' +
'<td style="border-bottom:1px solid #e8e8e8;">&nbsp;</td>' +
'</tr></table></td></tr>' +

'<tr><td style="padding:0 32px 24px;">' +
'<p style="color:#555;margin:0 0 16px;line-height:1.6;font-size:14px;">Instala WireGuard e importa tu perfil para conectarte a la plataforma SOCIA.</p>' +
'<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td width="48%" valign="top" style="padding-right:8px;">' +
'<div style="background:#fafafa;border-radius:4px;padding:16px;border-top:3px solid #eb114b;">' +
'<p style="margin:0 0 8px;font-weight:bold;color:#eb114b;font-size:11px;letter-spacing:1px;text-transform:uppercase;">Windows</p>' +
'<ol style="margin:0;padding-left:18px;color:#555;font-size:13px;line-height:1.9;">' +
'<li>Descarga <a href="https://www.wireguard.com/install/" style="color:#eb114b;">wireguard.com/install</a></li>' +
'<li>Abre WireGuard</li>' +
'<li>Clic en <em>Importar tunel desde archivo</em></li>' +
'<li>Selecciona <strong>' + slot + '.conf</strong></li>' +
'<li>Pulsa <strong>Activar</strong></li>' +
'</ol></div>' +
'</td>' +
'<td width="4%"></td>' +
'<td width="48%" valign="top" style="padding-left:8px;">' +
'<div style="background:#fafafa;border-radius:4px;padding:16px;border-top:3px solid #eb114b;">' +
'<p style="margin:0 0 8px;font-weight:bold;color:#eb114b;font-size:11px;letter-spacing:1px;text-transform:uppercase;">macOS</p>' +
'<ol style="margin:0;padding-left:18px;color:#555;font-size:13px;line-height:1.9;">' +
'<li>Instala <strong>WireGuard</strong> desde Mac App Store</li>' +
'<li>Abre WireGuard</li>' +
'<li>Clic en <em>Importar tunel(es) desde archivo</em></li>' +
'<li>Selecciona <strong>' + slot + '.conf</strong></li>' +
'<li>Pulsa <strong>Activar</strong></li>' +
'</ol></div>' +
'</td>' +
'</tr></table>' +
'<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td style="background:rgba(235,17,75,.06);border-left:4px solid #eb114b;border-radius:0 4px 4px 0;padding:12px 16px;">' +
'<p style="margin:0;font-size:13px;color:#333;">El archivo <strong>' + slot + '.conf</strong> está adjunto. Es tu perfil personal — no lo compartas.</p>' +
'</td></tr></table>' +
'</td></tr>' +

'<tr><td style="padding:0 32px 16px;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
'<td style="padding-right:10px;white-space:nowrap;"><span style="font-size:10px;font-weight:bold;color:#eb114b;letter-spacing:2.5px;text-transform:uppercase;">Uso de la infraestructura</span></td>' +
'<td style="border-bottom:1px solid #e8e8e8;">&nbsp;</td>' +
'</tr></table></td></tr>' +

'<tr><td style="padding:0 32px 28px;">' +
CONFIG_TEAM.INFRA_HTML.replace(/XXXXX/g, thehiveUrl) +
'</td></tr>' +

'<tr><td style="background:#242d3d;padding:18px 32px;text-align:center;">' +
'<p style="color:#eb114b;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;margin:0 0 4px;">Plataforma SOCIA &middot; IES Rafael Alberti</p>' +
'<p style="color:rgba(255,255,255,.5);font-size:11px;margin:0;">Este mensaje es automático. Contacta con el equipo técnico si tienes problemas de conexión.</p>' +
'</td></tr>' +

'</table></td></tr></table>' +
'</body></html>';
  }

};
