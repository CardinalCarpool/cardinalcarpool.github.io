/**
 * Cardinal Carpool — Google Apps Script backend.
 *
 * Storage: the "Rides" tab of the Google Sheet this script is bound to.
 * Email:   MailApp, sent from the Google account that deploys the web app.
 *
 * Notifications are opt-in ("Notify me"). Once an hour, on the hour, one email is
 * BCC'd to every opted-in rider who has a new ride posted within their time window.
 *
 * Setup (see README.md):
 *   1. Project Settings → Script properties → add ADMIN_PASSWORD (and optionally SITE_URL).
 *   2. Run setup() once from the editor (creates the sheet and the hourly schedule).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   4. Paste the /exec URL into js/config.js.
 */

const SHEET_NAME = 'Rides';
const HEADERS = [
  'id', 'createdAt', 'updatedAt', 'type', 'direction', 'date', 'time', 'airport', 'airline',
  'location', 'locationOther', 'firstName', 'email', 'phone', 'notes', 'orderUrl', 'editKey', 'notified',
  'notify', 'notifyBefore', 'notifyAfter', 'notifySince',
];
const AIRPORTS = ['SFO', 'SJC', 'OAK'];
const DIRECTIONS = ['to', 'from']; // to = leaving Stanford for the airport, from = returning to Stanford
const LOCATIONS = [
  'Branner', 'EV', 'FloMo', 'GovCo', 'Lagunita', 'Lower Row', 'Stern', 'Toyon', 'Upper Row', 'Wilbur', 'Other',
];
const NOTIFY_OFFSETS = [0, 15, 30, 45, 60, 90, 120, 180, 240]; // minutes before / after the rider's time
const DEFAULT_NOTIFY_OFFSET = 60;
const BCC_BATCH = 50; // recipients per email
const HOURLY_HANDLER = 'hourlyNotify';
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
      return { settings: getSettings_(), quota: MailApp.getRemainingDailyQuota(), nextRun: nextRunLabel_() };
    case 'adminList':
      requireAdmin_(req.password);
      return {
        rides: readRides_().map(adminRide_),
        settings: getSettings_(),
        quota: MailApp.getRemainingDailyQuota(),
        nextRun: nextRunLabel_(),
      };
    case 'adminAddShuttle':
      requireAdmin_(req.password);
      return withLock_(() => addShuttle_(req.shuttle));
    case 'adminDelete':
      requireAdmin_(req.password);
      return withLock_(() => ({ removed: deleteById_(req.id) }));
    case 'adminSendMatches':
      requireAdmin_(req.password);
      return withLock_(() => sendMatchEmails_());
    case 'adminSettings':
      requireAdmin_(req.password);
      const settings = saveSettings_(req.settings || {});
      if (settings.autoNotify) scheduleNextRun_();
      return { settings, nextRun: nextRunLabel_() };
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
  } else if (sh.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0].join() !== HEADERS.join()) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold'); // new columns
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
  ride.notifySince = ride.createdAt;
  appendRide_(ride);
  return { ride: ownRide_(ride), editKey: ride.editKey };
}

function updateRide_(id, editKey, input) {
  const existing = readRides_().find((r) => r.id === id);
  if (!existing || existing.type !== 'rider' || !editKey || existing.editKey !== editKey) {
    throw new Error('Ride not found or you do not have permission to edit it.');
  }
  const ride = validateRide_(input);
  const now = new Date().toISOString();
  // A new trip time or window (or turning alerts on) only alerts about rides posted from now on.
  const resetAlerts = ['direction', 'date', 'time', 'airport', 'notifyBefore', 'notifyAfter'].some((k) => ride[k] !== existing[k]) ||
    (ride.notify === 'yes' && existing.notify !== 'yes');
  Object.assign(existing, ride, { updatedAt: now });
  if (resetAlerts) Object.assign(existing, { notified: '', notifySince: now });
  writeRow_(existing._row, existing);
  return { ride: ownRide_(existing) };
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
  return { ride: publicRide_(shuttle) };
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
    notify: email && (r.notify === true || r.notify === 'yes') ? 'yes' : '',
    notifyBefore: offset_(r.notifyBefore),
    notifyAfter: offset_(r.notifyAfter),
  };
}

function offset_(v) {
  return String(NOTIFY_OFFSETS.indexOf(Number(v)) === -1 ? DEFAULT_NOTIFY_OFFSET : Number(v));
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

/** What the poster gets back about their own ride: public fields plus their private alert settings. */
function ownRide_(r) {
  return Object.assign(publicRide_(r), {
    notify: r.notify === 'yes', notifyBefore: Number(offset_(r.notifyBefore)), notifyAfter: Number(offset_(r.notifyAfter)),
  });
}

function adminRide_(r) {
  const out = ownRide_(r);
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

/** Is `other` a new ride inside `rider`'s alert window that they haven't been told about? */
function isNewMatchFor_(rider, other) {
  if (other.id === rider.id || other.direction !== rider.direction || other.airport !== rider.airport) return false;
  const diff = minutes_(other) - minutes_(rider); // negative = earlier than the rider
  if (diff < -Number(offset_(rider.notifyBefore)) || diff > Number(offset_(rider.notifyAfter))) return false;
  if ((other.updatedAt || other.createdAt) <= (rider.notifySince || rider.createdAt)) return false;
  return (rider.notified ? rider.notified.split(',') : []).indexOf(other.id) === -1;
}

/**
 * Finds every opted-in rider with at least one new match and sends one generic
 * "check it out" email BCC'd to all of them (in batches of BCC_BATCH).
 */
function sendMatchEmails_() {
  const rides = readRides_().filter(isUpcoming_);
  const subscribers = rides.filter((r) => r.type === 'rider' && r.notify === 'yes' && r.email);
  const toNotify = [];
  subscribers.forEach((rider) => {
    const fresh = rides.filter((o) => isNewMatchFor_(rider, o));
    if (fresh.length) toNotify.push({ rider, fresh });
  });

  // Each BCC recipient counts against the daily quota, so only send what fits.
  let quota = MailApp.getRemainingDailyQuota();
  const sending = toNotify.slice(0, Math.max(0, quota - 1)); // -1 for the visible "to" copy
  const emails = Array.from(new Set(sending.map((x) => x.rider.email)));
  const self = Session.getEffectiveUser().getEmail() || CONTACT_EMAIL;

  for (let i = 0; i < emails.length; i += BCC_BATCH) {
    MailApp.sendEmail({
      to: self,
      bcc: emails.slice(i, i + BCC_BATCH).join(','),
      subject: 'You have a new ride match on Cardinal Carpool 🚗',
      htmlBody: matchEmailHtml_(),
      name: 'Cardinal Carpool',
      replyTo: CONTACT_EMAIL,
    });
  }

  sending.forEach(({ rider, fresh }) => {
    const already = rider.notified ? rider.notified.split(',') : [];
    rider.notified = already.concat(fresh.map((o) => o.id)).filter(Boolean).join(',');
    writeRow_(rider._row, rider);
  });

  return {
    emailsSent: Math.ceil(emails.length / BCC_BATCH),
    recipients: emails.length,
    ridersWithMatches: toNotify.length,
    subscribers: subscribers.length,
    quotaLeft: MailApp.getRemainingDailyQuota(),
  };
}

function matchEmailHtml_() {
  const site = getSettings_().siteUrl;
  return '<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#2e2d29">' +
    '<h2 style="color:#8C1515;margin-bottom:4px">Cardinal Carpool</h2>' +
    '<p>Good news! Someone new posted a ride within the time window you picked for your airport trip.</p>' +
    '<p>Check it out and reach out to coordinate. Splitting an Uber or Lyft saves everyone money.</p>' +
    (site ? '<p><a href="' + esc_(site) + '" style="display:inline-block;background:#8C1515;color:#fff;' +
      'padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">See your matches →</a></p>' : '') +
    '<p style="color:#53565a;font-size:13px">You\'re getting this because you turned on "Notify me" for a ride. ' +
    'To stop, edit your ride on Cardinal Carpool and turn it off.</p>' +
    '<p style="color:#888;font-size:12px">Made by Samuel for SSS · Questions? ' +
    '<a href="mailto:' + CONTACT_EMAIL + '">' + CONTACT_EMAIL + '</a></p></div>';
}

// ---------- Hourly schedule ----------

/** Runs at the top of every hour; always books the next run, even if sending fails. */
function hourlyNotify() {
  try {
    if (getSettings_().autoNotify) withLock_(() => sendMatchEmails_());
  } finally {
    scheduleNextRun_();
  }
}

/** One-off trigger at the next :00. (Apps Script's "every hour" triggers don't fire on the hour.) */
function scheduleNextRun_() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === HOURLY_HANDLER)
    .forEach((t) => ScriptApp.deleteTrigger(t));
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  ScriptApp.newTrigger(HOURLY_HANDLER).timeBased().at(next).create();
  PropertiesService.getScriptProperties().setProperty('NEXT_RUN', next.toISOString());
}

/** Safety net (every 6 hours): restarts the hourly chain if it ever broke. */
function ensureSchedule() {
  const hasNext = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === HOURLY_HANDLER);
  const next = PropertiesService.getScriptProperties().getProperty('NEXT_RUN');
  if (!hasNext || !next || new Date(next) < new Date(Date.now() - 10 * 60000)) scheduleNextRun_();
}

function nextRunLabel_() {
  const next = PropertiesService.getScriptProperties().getProperty('NEXT_RUN');
  return next && new Date(next) > new Date() ? Utilities.formatDate(new Date(next), TZ, 'h:mm a') : '';
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Run once from the editor: creates the sheet tab, authorizes email, and starts the hourly schedule. */
function setup() {
  sheet_();
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'ensureSchedule')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('ensureSchedule').timeBased().everyHours(6).create();
  scheduleNextRun_();
  Logger.log('Ready. Next email run: ' + nextRunLabel_() + '. Email quota left today: ' +
    MailApp.getRemainingDailyQuota());
}
