/**
 * Synthetic data for load testing. Paste this file into the same Apps Script project as
 * Code.gs (File → + → Script, name it TestData), then run from the editor:
 *
 *   addTestRides()     adds 1000 fake upcoming rides in one write
 *   removeTestRides()  deletes every fake ride (ids start with "test-"), nothing else
 *
 * Fake rides are visible on the live site until removed. Emails use example.com and phone
 * numbers use the reserved 555-01xx range, so no real person can be contacted.
 */

const TEST_ID_PREFIX = 'test-';

function addTestRides() {
  addTestRides_(1000);
}

function addTestRides_(count) {
  const names = ['Alex', 'Maya', 'Jordan', 'Priya', 'Kai', 'Sofia', 'Ethan', 'Lena', 'Omar', 'Grace',
    'Noah', 'Ava', 'Diego', 'Mei', 'Lucas', 'Zara', 'Ben', 'Isla', 'Ravi', 'Chloe'];
  const airlines = ['United', 'Alaska', 'Delta', 'American', 'Southwest', 'JetBlue', 'Hawaiian', 'Frontier'];
  const dorms = LOCATIONS.filter((l) => l !== 'Other');
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const stamp = now.toISOString();

  const rows = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(now.getTime() + (1 + Math.floor(Math.random() * 60)) * 86400000);
    const date = Utilities.formatDate(day, TZ, 'yyyy-MM-dd');
    const time = pad(5 + Math.floor(Math.random() * 18)) + ':' + pad(Math.floor(Math.random() * 12) * 5);
    const direction = Math.random() < 0.55 ? 'to' : 'from';
    const shuttle = Math.random() < 0.03;
    const name = pick(names);
    const hasEmail = Math.random() < 0.85;
    const hasPhone = !hasEmail || Math.random() < 0.5;
    const ride = {
      id: TEST_ID_PREFIX + Utilities.getUuid(),
      createdAt: stamp,
      updatedAt: stamp,
      type: shuttle ? 'shuttle' : 'rider',
      direction,
      date,
      time,
      airport: pick(['SFO', 'SFO', 'SFO', 'SJC', 'OAK']), // SFO-heavy, like real demand
      airline: shuttle ? '' : pick(airlines),
      location: pick(dorms),
      locationOther: '',
      firstName: shuttle ? '$5 Shuttle' : name,
      email: !shuttle && hasEmail ? name.toLowerCase() + '.test' + i + '@example.com' : '',
      phone: !shuttle && hasPhone ? '650-555-01' + pad(i % 100) : '',
      notes: shuttle ? 'Test shuttle' : '',
      orderUrl: shuttle ? 'https://example.com/order' : '',
      editKey: shuttle ? '' : Utilities.getUuid(),
      matchBefore: shuttle ? '' : String(pick(MATCH_OFFSETS.slice(0, 7))),
      matchAfter: shuttle ? '' : String(pick(MATCH_OFFSETS.slice(0, 7))),
    };
    rows.push(HEADERS.map((h) => (ride[h] == null ? '' : String(ride[h]))));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const range = sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length);
    range.setNumberFormat('@');
    range.setValues(rows);
  } finally {
    invalidateListCache_();
    lock.releaseLock();
  }
  Logger.log('Added ' + rows.length + ' test rides. Total rows now: ' + (sheet_().getLastRow() - 1));
}

function removeTestRides() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    if (last < 2) return Logger.log('No rides.');
    const values = sh.getRange(2, 1, last - 1, HEADERS.length).getDisplayValues();
    const isTest = (row) => String(row[0]).indexOf(TEST_ID_PREFIX) === 0;
    const keep = values.filter((row) => row[0] && !isTest(row)); // real rides only (drops blank rows too)
    const removed = values.filter(isTest).length;
    // Rewrite the real rows in one go instead of deleting rows one by one (much faster).
    sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, HEADERS.length).setNumberFormat('@').setValues(keep);
    // Trim the now-empty rows (Sheets won't delete every row under the header, so keep one).
    const firstEmpty = Math.max(keep.length + 2, 3);
    if (last >= firstEmpty) sh.deleteRows(firstEmpty, last - firstEmpty + 1);
    Logger.log('Removed ' + removed + ' test rides. Real rides kept: ' + keep.length);
  } finally {
    invalidateListCache_();
    lock.releaseLock();
  }
}
