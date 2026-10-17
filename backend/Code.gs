/**
 * Cardinal Carpool — Google Apps Script backend.
 *
 * Storage: the "Rides" tab of the Google Sheet this script is bound to.
 *
 * Setup (see README.md):
 *   1. Project Settings → Script properties → add ADMIN_PASSWORD.
 *   2. Run setup() once from the editor (creates the sheet tab).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *   4. Paste the /exec URL into js/config.js.
 */

const SHEET_NAME = 'Rides';
const HEADERS = [
  'id', 'createdAt', 'updatedAt', 'type', 'direction', 'date', 'time', 'airport', 'airline',
  'location', 'locationOther', 'firstName', 'email', 'phone', 'notes', 'orderUrl', 'editKey',
  'matchBefore', 'matchAfter',
];
const AIRPORTS = ['SFO', 'SJC', 'OAK'];
const DIRECTIONS = ['to', 'from']; // to = leaving Stanford for the airport, from = returning to Stanford
const LOCATIONS = [
  'Branner', 'EV', 'FloMo', 'GovCo', 'Lagunita', 'Lower Row', 'Stern', 'Toyon', 'Upper Row', 'Wilbur', 'Other',
];
// Each rider's flexibility: how much earlier / later than their time they could leave.
// Two rides match when those ranges overlap. Defaults differ for departures and returns.
const MATCH_OFFSETS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270];
const DEFAULT_WINDOW = { to: { before: 60, after: 15 }, from: { before: 15, after: 60 } };
const TZ = 'America/Los_Angeles';

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
    if (req.action === 'list') {
      // Pre-serialized (and usually cached) so big lists don't get parsed and re-stringified.
      return ContentService.createTextOutput('{"ok":true,"rides":' + listJson_() + '}')
        .setMimeType(ContentService.MimeType.JSON);
    }
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
    case 'add':
      return withLock_(() => addRide_(req.ride));
    case 'update':
      return withLock_(() => updateRide_(req.id, req.editKey, req.ride));
    case 'remove':
      return withLock_(() => removeOwnRide_(req.id, req.editKey));

    case 'adminLogin':
      requireAdmin_(req.password);
      return {};
    case 'adminList':
      requireAdmin_(req.password);
      return { rides: readRides_().map(publicRide_) };
    case 'adminAddShuttle':
      requireAdmin_(req.password);
      return withLock_(() => addShuttle_(req.shuttle));
    case 'adminDelete':
      requireAdmin_(req.password);
      return withLock_(() => ({ removed: deleteById_(req.id) }));
    default:
      throw new Error('Unknown action.');
  }
}

// Every write goes through here, so this is also where the cached ride list is cleared.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    invalidateListCache_();
    lock.releaseLock();
  }
}

// ---------- Cached public ride list ----------
// CacheService values max out at 100 KB, so the JSON is split into chunks.
const LIST_CACHE_TTL = 300; // seconds; writes clear it immediately
const LIST_CHUNK = 40000; // characters per chunk (safe under 100 KB even for non-ASCII)

function listJson_() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get('rides:meta');
  if (meta) {
    const { n, v } = JSON.parse(meta);
    const keys = Array.from({ length: n }, (_, i) => 'rides:' + v + ':' + i);
    const parts = cache.getAll(keys);
    if (keys.every((k) => parts[k] != null)) return keys.map((k) => parts[k]).join('');
  }
  const json = JSON.stringify(readRides_().filter(isUpcoming_).map(compactRide_));
  const v = Utilities.getUuid().slice(0, 8);
  const chunks = {};
  for (let i = 0; i * LIST_CHUNK < json.length; i++) chunks['rides:' + v + ':' + i] = json.slice(i * LIST_CHUNK, (i + 1) * LIST_CHUNK);
  try {
    cache.putAll(chunks, LIST_CACHE_TTL);
    cache.put('rides:meta', JSON.stringify({ n: Object.keys(chunks).length, v }), LIST_CACHE_TTL);
  } catch (err) {
    // Too big to cache (or cache unavailable): still answer, just uncached.
  }
  return json;
}

function invalidateListCache_() {
  CacheService.getScriptCache().remove('rides:meta');
}

/** Public ride without empty fields, to keep the list download small. */
function compactRide_(r) {
  const out = publicRide_(r);
  Object.keys(out).forEach((k) => {
    if (out[k] === '' || out[k] == null || k === 'createdAt') delete out[k];
  });
  return out;
}

// ---------- Auth ----------

function requireAdmin_(password) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('ADMIN_PASSWORD is not set in Script properties.');
  if (typeof password !== 'string' || password !== expected) {
    Utilities.sleep(800); // slow down guessing
    throw new Error('Incorrect password.');
  }
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
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold'); // added columns
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
  appendRide_(ride);
  return { ride: publicRide_(ride), editKey: ride.editKey };
}

function updateRide_(id, editKey, input) {
  const existing = readRides_().find((r) => r.id === id);
  if (!existing || existing.type !== 'rider' || !editKey || existing.editKey !== editKey) {
    throw new Error('Ride not found or you do not have permission to edit it.');
  }
  Object.assign(existing, validateRide_(input), { updatedAt: new Date().toISOString() });
  writeRow_(existing._row, existing);
  return { ride: publicRide_(existing) };
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
  const direction = oneOf_(r.direction, DIRECTIONS, 'direction');
  return {
    direction,
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
    matchBefore: offset_(r.matchBefore, DEFAULT_WINDOW[direction].before),
    matchAfter: offset_(r.matchAfter, DEFAULT_WINDOW[direction].after),
  };
}

function defaultWindow_(r) {
  return DEFAULT_WINDOW[r.direction] || DEFAULT_WINDOW.to;
}

function offset_(v, fallback) {
  // Blank (rides posted before windows existed) or invalid → the default.
  if (v === '' || v == null || MATCH_OFFSETS.indexOf(Number(v)) === -1) return String(fallback);
  return String(Number(v));
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
    // Public so each browser can check that two riders' flexible times overlap. Shuttles have none.
    matchBefore: r.type === 'rider' ? Number(offset_(r.matchBefore, defaultWindow_(r).before)) : null,
    matchAfter: r.type === 'rider' ? Number(offset_(r.matchAfter, defaultWindow_(r).after)) : null,
  };
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

/** Run once from the editor: creates the sheet tab and authorizes the script. */
function setup() {
  sheet_();
  Logger.log('Ready.');
}
