/**
 * Google Apps Script Gmail HTTPS Relay for Guulingiinhan (port 443).
 *
 * Render Free Tier blocks outbound SMTP ports (25, 465, 587). Deploying this
 * script as a Google Apps Script Web App sends transactional verification and
 * password-reset emails straight from your Gmail account over HTTPS (port 443).
 *
 * Setup:
 * 1. Go to https://script.google.com -> New Project -> paste this file.
 * 2. Project Settings -> Script Properties -> Add property:
 *      WEBHOOK_SECRET = <32+ char random string> (same as EMAIL_WEBHOOK_SECRET in Render)
 * 3. Deploy -> New deployment -> Web app:
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Copy the Web App URL (https://script.google.com/macros/s/.../exec) into Render:
 *      EMAIL_PROVIDER=apps_script
 *      EMAIL_FROM=yourname@gmail.com
 *      EMAIL_WEBHOOK_URL=<Web App URL>
 *      EMAIL_WEBHOOK_SECRET=<same 32+ char secret>
 */

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function timingSafeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0) {
    return false;
  }
  var maxLen = Math.max(a.length, b.length);
  var mismatch = a.length ^ b.length;
  for (var i = 0; i < maxLen; i++) {
    var codeA = i < a.length ? a.charCodeAt(i) : 0;
    var codeB = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= codeA ^ codeB;
  }
  return mismatch === 0;
}

function doPost(e) {
  try {
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';
    if (expectedSecret.length < 32) {
      return jsonResponse({ ok: false, error: 'relay_not_configured' });
    }
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);

    if (!timingSafeEquals(String(data.secret || ''), expectedSecret)) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    var to = String(data.to || '').trim();
    var subject = String(data.subject || '').trim();
    var text = String(data.text || '');
    var htmlBody = String(data.html || '');
    var fromName = String(data.from_name || 'Гуулингийнхан').trim();

    if (!to || !subject) {
      return jsonResponse({ ok: false, error: 'invalid_payload' });
    }

    var options = { name: fromName };
    if (htmlBody) {
      options.htmlBody = htmlBody;
    }
    GmailApp.sendEmail(to, subject, text || subject, options);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
