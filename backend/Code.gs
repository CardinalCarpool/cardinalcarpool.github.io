/**
 * Cardinal Carpool — Google Apps Script backend.
 *
 * Storage: the "Rides" tab of the Google Sheet this script is bound to.
 * Email:   MailApp, sent from the Google account that deploys the web app.
 *
 * Setup (see README.md):
 *   1. Project Settings → Script properties → add ADMIN_PASSWORD (and optionally SITE_URL).
 *   2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   3. Paste the /exec URL into js/config.js.
 */

const SHEET_NAME = 'Rides';
const HEADERS = [
  'id', 'createdAt', 'updatedAt', 'type', 'direction', 'date', 'time', 'airport', 'airline',
  'location', 'locationOther', 'firstName', 'email', 'phone', 'notes', 'orderUrl', 'editKey', 'notified',
];
const AIRPORTS = ['SFO', 'SJC', 'OAK'];
const DIRECTIONS = ['to', 'from']; // to = leaving Stanford for the airport, from = returning to Stanford
const LOCATIONS = [
  'Branner', 'EV', 'FloMo', 'GovCo', 'Lagunita', 'Lower Row', 'Stern', 'Toyon', 'Upper Row', 'Wilbur', 'Other',
];
const MATCH_WINDOW_MIN = 30;
const TZ = 'America/Los_Angeles';
const CONTACT_EMAIL = 'sdesai05@stanford.edu';

// ---------- HTTP entry points ----------

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid request body.' });
  }
  return handle_(body);
}

function handle_(req) {
  try {
    return json_(Object.assign({ ok: true }, route_(req)));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  switch (req.action) {
    case 'list':
      return { rides: readRides_().filter(isUpcoming_).map(publicRide_) };
    case 'add':
      return withLock_(() => addRide_(req.ride));
    case 'update':
      return withLock_(() => updateRide_(req.id, req.editKey, req.ride));
    case 'remove':
      return withLock_(() => removeOwnRide_(req.id, req.editKey));

    case 'adminLogin':
      requireAdmin_(req.password);
      return { settings: getSettings_(), quota: MailApp.getRemainingDailyQuota() };
    case 'adminList':
      requireAdmin_(req.password);
      return {
        rides: readRides_().map(adminRide_),
        settings: getSettings_(),
        quota: MailApp.getRemainingDailyQuota(),
      };
    case 'adminAddShuttle':
      requireAdmin_(req.password);
      return withLock_(() => addShuttle_(req.shuttle));
    case 'adminDelete':
      requireAdmin_(req.password);
      return withLock_(() => ({ removed: deleteById_(req.id) }));
    case 'adminSendMatches':
      requireAdmin_(req.password);
      return withLock_(() => sendMatchEmails_(null));
    case 'adminSettings':
      requireAdmin_(req.password);
      return { settings: saveSettings_(req.settings || {}) };
    default:
      throw new Error('Unknown action.');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- Auth & settings ----------

function requireAdmin_(password) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('ADMIN_PASSWORD is not set in Script properties.');
  if (typeof password !== 'string' || password !== expected) {
    Utilities.sleep(800); // slow down guessing
    throw new Error('Incorrect password.');
  }
}

function getSettings_() {
  const props = PropertiesService.getScriptProperties();
  return {
    autoNotify: props.getProperty('AUTO_NOTIFY') !== 'false',
    siteUrl: props.getProperty('SITE_URL') || '',
  };
}

function saveSettings_(s) {
  const props = PropertiesService.getScriptProperties();
  if (typeof s.autoNotify === 'boolean') props.setProperty('AUTO_NOTIFY', String(s.autoNotify));
  if (typeof s.siteUrl === 'string') props.setProperty('SITE_URL', s.siteUrl.trim().slice(0, 300));
  return getSettings_();
}

// ---------- Sheet access ----------

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRides_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
  return values
    .filter((row) => row[0])
    .map((row, i) => {
      const r = { _row: i + 2 };
      HEADERS.forEach((h, j) => (r[h] = row[j]));
      return r;
    });
}

function writeRow_(rowNumber, ride) {
  const range = sheet_().getRange(rowNumber, 1, 1, HEADERS.length);
  range.setNumberFormat('@'); // plain text: keeps "+1 650…" and dates from being reinterpreted
  range.setValues([HEADERS.map((h) => (ride[h] == null ? '' : String(ride[h])))]);
}

function appendRide_(ride) {
  writeRow_(sheet_().getLastRow() + 1, ride);
}

function deleteById_(id) {
  const ride = readRides_().find((r) => r.id === id);
  if (!ride) return false;
  sheet_().deleteRow(ride._row);
  return true;
}

// ---------- Ride operations ----------

function addRide_(input) {
  const ride = validateRide_(input);
  ride.id = Utilities.getUuid();
  ride.createdAt = new Date().toISOString();
  ride.updatedAt = ride.createdAt;
  ride.type = 'rider';
  ride.editKey = Utilities.getUuid();
  ride.notified = '';
  appendRide_(ride);

  let emailed = 0;
  if (getSettings_().autoNotify) emailed = sendMatchEmails_(ride.id).emailsSent;
  return { ride: publicRide_(ride), editKey: ride.editKey, emailed };
}

function updateRide_(id, editKey, input) {
  const existing = readRides_().find((r) => r.id === id);
  if (!existing || existing.type !== 'rider' || !editKey || existing.editKey !== editKey) {
    throw new Error('Ride not found or you do not have permission to edit it.');
  }
  const ride = validateRide_(input);
  const tripChanged = ['direction', 'date', 'time', 'airport'].some((k) => ride[k] !== existing[k]);
  Object.assign(existing, ride, {
    updatedAt: new Date().toISOString(),
    notified: tripChanged ? '' : existing.notified,
  });
  writeRow_(existing._row, existing);

  let emailed = 0;
  if (tripChanged && getSettings_().autoNotify) emailed = sendMatchEmails_(existing.id).emailsSent;
  return { ride: publicRide_(existing), emailed };
}

function removeOwnRide_(id, editKey) {
  const ride = readRides_().find((r) => r.id === id);
  if (!ride || !editKey || ride.editKey !== editKey) throw new Error('Ride not found.');
  sheet_().deleteRow(ride._row);
  return { removed: true };
}

function addShuttle_(input) {
  const s = input || {};
  const shuttle = {
    direction: oneOf_(s.direction, DIRECTIONS, 'direction'),
    date: validDate_(s.date),
    time: validTime_(s.time),
    airport: oneOf_(s.airport, AIRPORTS, 'airport'),
    airline: '',
    location: oneOf_(s.location, LOCATIONS, 'location'),
    locationOther: s.location === 'Other' ? text_(s.locationOther, 80, true, 'location') : '',
    firstName: '$5 Shuttle',
    email: '',
    phone: '',
    notes: text_(s.notes, 300, false),
    orderUrl: validUrl_(s.orderUrl),
  };
  shuttle.id = Utilities.getUuid();
  shuttle.createdAt = new Date().toISOString();
  shuttle.updatedAt = shuttle.createdAt;
  shuttle.type = 'shuttle';
  shuttle.editKey = '';
  shuttle.notified = '';
  appendRide_(shuttle);

  let emailed = 0;
  if (getSettings_().autoNotify) emailed = sendMatchEmails_(shuttle.id).emailsSent;
  return { ride: publicRide_(shuttle), emailed };
}

function validateRide_(input) {
  const r = input || {};
  const email = text_(r.email, 120, false).toLowerCase();
  const phone = text_(r.phone, 30, false);
  if (!email && !phone) throw new Error('Please add an email or phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email looks invalid.');
  if (phone && !/^[0-9+().\-\s]{7,30}$/.test(phone)) throw new Error('Phone number looks invalid.');
  const location = oneOf_(r.location, LOCATIONS, 'location');
  return {
    direction: oneOf_(r.direction, DIRECTIONS, 'direction'),
    date: validDate_(r.date),
    time: validTime_(r.time),
    airport: oneOf_(r.airport, AIRPORTS, 'airport'),
    airline: text_(r.airline, 60, true, 'airline'),
    location,
    locationOther: location === 'Other' ? text_(r.locationOther, 80, true, 'location') : '',
    firstName: text_(r.firstName, 40, true, 'first name'),
    email,
    phone,
    notes: '',
    orderUrl: '',
  };
}

function oneOf_(v, list, label) {
  if (list.indexOf(v) === -1) throw new Error('Please choose a valid ' + label + '.');
  return v;
}

function validUrl_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^https:\/\/[^\s"<>]{3,500}$/.test(s)) throw new Error('Please enter the order form link (https://…).');
  return s;
}

function validDate_(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new Error('Please enter a valid date.');
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error('Please enter a valid date.');
  return v;
}

function validTime_(v) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '')) throw new Error('Please enter a valid time.');
  return v;
}

function text_(v, max, required, label) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  if (required && !s) throw new Error('Please enter your ' + label + '.');
  return s;
}

function publicRide_(r) {
  return {
    id: r.id, type: r.type, direction: r.direction, date: r.date, time: r.time, airport: r.airport,
    airline: r.airline, location: r.location, locationOther: r.locationOther, firstName: r.firstName,
    email: r.email, phone: r.phone, notes: r.notes, orderUrl: r.orderUrl, createdAt: r.createdAt,
  };
}

function adminRide_(r) {
  const out = publicRide_(r);
  out.notifiedCount = r.notified ? r.notified.split(',').filter(Boolean).length : 0;
  return out;
}

// ---------- Time helpers (all times are Pacific wall-clock) ----------

function minutes_(r) {
  const [y, m, d] = r.date.split('-').map(Number);
  const [h, mi] = r.time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
}

function nowMinutes_() {
  const s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return minutes_({ date: s[0], time: s[1] });
}

function isUpcoming_(r) {
  return minutes_(r) >= nowMinutes_() - 60; // keep rides visible until an hour after their time
}

// ---------- Matching & email ----------

function isMatch_(a, b) {
  return a.id !== b.id && a.direction === b.direction && a.airport === b.airport &&
    Math.abs(minutes_(a) - minutes_(b)) <= MATCH_WINDOW_MIN;
}

/**
 * Emails every rider who has new matches they haven't been told about yet.
 * If focusId is given, only riders involved with that ride are considered
 * (the ride itself plus everyone it matches).
 */
function sendMatchEmails_(focusId) {
  const rides = readRides_().filter(isUpcoming_);
  let candidates = rides.filter((r) => r.type === 'rider' && r.email);
  if (focusId) {
    const focus = rides.find((r) => r.id === focusId);
    if (!focus) return { emailsSent: 0, ridersWithMatches: 0 };
    candidates = candidates.filter((r) => r.id === focusId || isMatch_(r, focus));
  }

  let emailsSent = 0;
  let ridersWithMatches = 0;
  let quota = MailApp.getRemainingDailyQuota();

  candidates.forEach((rider) => {
    const already = rider.notified ? rider.notified.split(',') : [];
    const fresh = rides.filter((o) => isMatch_(rider, o) && already.indexOf(o.id) === -1);
    if (!fresh.length) return;
    ridersWithMatches++;
    if (quota < 1) return;

    MailApp.sendEmail({
      to: rider.email,
      subject: 'Cardinal Carpool: ' + (fresh.length === 1 ? 'a ride match' : fresh.length + ' ride matches') +
        ' for your ' + rider.airport + ' trip',
      htmlBody: matchEmailHtml_(rider, fresh),
      name: 'Cardinal Carpool',
      replyTo: CONTACT_EMAIL,
    });
    quota--;
    emailsSent++;
    rider.notified = already.concat(fresh.map((o) => o.id)).filter(Boolean).join(',');
    writeRow_(rider._row, rider);
  });

  return { emailsSent, ridersWithMatches, quotaLeft: quota };
}

function matchEmailHtml_(rider, matches) {
  const site = getSettings_().siteUrl;
  const dirLabel = rider.direction === 'to' ? 'Stanford → ' + rider.airport : rider.airport + ' → Stanford';
  const rows = matches.map((m) => {
    const where = m.location === 'Other' ? m.locationOther : m.location;
    if (m.type === 'shuttle') {
      return '<tr><td style="padding:12px;border-bottom:1px solid #eee">' +
        '<strong style="color:#8C1515">$5 SSS Shuttle</strong> at ' + esc_(fmtTime_(m.time)) +
        '<br>' + (m.direction === 'to' ? 'Pickup' : 'Drop-off') + ': ' + esc_(where) +
        (m.notes ? '<br>' + esc_(m.notes) : '') +
        (m.orderUrl ? '<br><a href="' + esc_(m.orderUrl) + '" style="color:#8C1515;font-weight:bold">Reserve a seat →</a>' : '') +
        '</td></tr>';
    }
    const contact = [
      m.email ? '<a href="mailto:' + esc_(m.email) + '">' + esc_(m.email) + '</a>' : '',
      m.phone ? '<a href="sms:' + esc_(m.phone.replace(/[^0-9+]/g, '')) + '">' + esc_(m.phone) + '</a>' : '',
    ].filter(Boolean).join(' · ');
    return '<tr><td style="padding:12px;border-bottom:1px solid #eee">' +
      '<strong>' + esc_(m.firstName) + '</strong> at ' + esc_(fmtTime_(m.time)) +
      ' (' + esc_(m.airline) + ')<br>' + (m.direction === 'to' ? 'Leaving from' : 'Heading to') + ': ' +
      esc_(where) + '<br>' + contact + '</td></tr>';
  }).join('');

  return '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#222">' +
    '<h2 style="color:#8C1515;margin-bottom:4px">Cardinal Carpool</h2>' +
    '<p>Hi ' + esc_(rider.firstName) + ', good news! We found ' +
    (matches.length === 1 ? 'a ride' : matches.length + ' rides') + ' within ' + MATCH_WINDOW_MIN +
    ' minutes of your trip <strong>' + esc_(dirLabel) + '</strong> on ' + esc_(fmtDate_(rider.date)) +
    ' at ' + esc_(fmtTime_(rider.time)) + '.</p>' +
    '<table style="width:100%;border-collapse:collapse;background:#fafafa">' + rows + '</table>' +
    '<p>Reach out to coordinate. Splitting an Uber/Lyft saves everyone money.</p>' +
    (site ? '<p><a href="' + esc_(site) + '" style="color:#8C1515">Open Cardinal Carpool</a></p>' : '') +
    '<p style="color:#888;font-size:12px">Made by Samuel for SSS · Questions? ' +
    '<a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a></p></div>';
}

function fmtTime_(t) {
  const [h, m] = t.split(':').map(Number);
  return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}

function fmtDate_(d) {
  const [y, m, day] = d.split('-');
  return m + '/' + day + '/' + y;
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Optional: run once from the editor to create the sheet tab and authorize MailApp. */
function setup() {
  sheet_();
  Logger.log('Sheet ready. Remaining email quota today: ' + MailApp.getRemainingDailyQuota());
}
