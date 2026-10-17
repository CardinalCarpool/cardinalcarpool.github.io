// Shared constants, helpers and the backend client for Cardinal Carpool.
(function () {
  const AIRPORTS = ['SFO', 'SJC', 'OAK'];
  const LOCATIONS = [
    'Branner', 'EV', 'FloMo', 'GovCo', 'Lagunita', 'Lower Row', 'Stern', 'Toyon', 'Upper Row', 'Wilbur',
  ]; // "Other" is appended in the UI
  const AIRLINES = [
    'Alaska', 'American', 'Delta', 'Frontier', 'Hawaiian', 'JetBlue', 'Southwest', 'United',
    'Air Canada', 'Air France', 'British Airways', 'Emirates', 'Japan Airlines', 'Lufthansa', 'Qantas',
    'Other',
  ];
  // Match window: rides from `before` minutes earlier to `after` minutes later than yours.
  // Each rider sets it per ride; it's stored with the ride so matches can be mutual.
  const MATCH_OFFSETS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270];
  const DEFAULT_MATCH_WINDOW = { to: { before: 60, after: 15 }, from: { before: 15, after: 60 } };
  const CONTACT_EMAIL = 'sdesai05@stanford.edu';

  const API_URL = (window.CC_CONFIG && window.CC_CONFIG.API_URL || '').trim();
  const DEMO = !API_URL;

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pad = (n) => String(n).padStart(2, '0');
  const minutesOf = (r) => {
    const [y, m, d] = r.date.split('-').map(Number);
    const [h, mi] = r.time.split(':').map(Number);
    return Date.UTC(y, m - 1, d, h, mi) / 60000;
  };
  const fmtTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${(h + 11) % 12 + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const fmtMinutes = (mins) => {
    if (mins >= 1440) return '11:59 PM';
    return fmtTime(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  };
  const isoToMDY = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}/${d}/${y}`;
  };
  const mdyToIso = (mdy) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy || '');
    if (!m) return null;
    const [, mm, dd, yyyy] = m.map(Number);
    const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
    return `${yyyy}-${pad(mm)}-${pad(dd)}`;
  };
  const fmtDateLong = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  };
  // "Now" as Pacific wall-clock minutes, comparable with minutesOf().
  const nowMinutes = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
    return minutesOf({ date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` });
  };
  const todayIso = () => {
    const mins = nowMinutes();
    const d = new Date(mins * 60000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  const sameTrip = (a, b) => a.id !== b.id && a.direction === b.direction && a.airport === b.airport;
  // Does `other` fall inside a fixed window around `mine`? (Used by the admin ±30 min export.)
  const isMatch = (mine, other, win) => {
    if (!sameTrip(mine, other)) return false;
    const diff = minutesOf(other) - minutesOf(mine);
    return diff >= -win.before && diff <= win.after;
  };
  // A rider's flexibility: how much earlier / later they could leave. Shuttles leave at a fixed time.
  const offsetOr = (v, fallback) => (v === '' || v == null || !MATCH_OFFSETS.includes(Number(v)) ? fallback : Number(v));
  const defaultWindow = (r) => DEFAULT_MATCH_WINDOW[r.direction] || DEFAULT_MATCH_WINDOW.to;
  const windowOf = (r) => (r.type === 'shuttle' ? { before: 0, after: 0 } : {
    before: offsetOr(r.matchBefore, defaultWindow(r).before),
    after: offsetOr(r.matchAfter, defaultWindow(r).after),
  });
  // The range of times (in minutes) both rides could leave, or null if there's none.
  const overlapOf = (a, b) => {
    if (!sameTrip(a, b)) return null;
    const wa = windowOf(a);
    const wb = windowOf(b);
    const start = Math.max(minutesOf(a) - wa.before, minutesOf(b) - wb.before);
    const end = Math.min(minutesOf(a) + wa.after, minutesOf(b) + wb.after);
    return start <= end ? { start, end } : null;
  };
  // A match: both riders' flexible times overlap, so there's a time that works for both.
  const isMutualMatch = (mine, other) => !!overlapOf(mine, other);
  // "8:30–9:00 AM" style label for an overlap.
  const fmtOverlap = (o) => {
    const t = (mins) => { const d = new Date(mins * 60000); return fmtTime(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`); };
    return o.start === o.end ? t(o.start) : `${t(o.start)}–${t(o.end)}`;
  };
  const placeOf = (r) => (r.location === 'Other' ? (r.locationOther || 'Other') : r.location);

  // ---------- "my rides" (edit keys kept in this browser) ----------
  const MINE_KEY = 'cc_my_rides';
  const myRides = {
    all() {
      try { return JSON.parse(localStorage.getItem(MINE_KEY) || '{}'); } catch (e) { return {}; }
    },
    save(id, editKey, ride) {
      const all = this.all();
      all[id] = { editKey, ride };
      try { localStorage.setItem(MINE_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
    },
    remove(id) {
      const all = this.all();
      delete all[id];
      try { localStorage.setItem(MINE_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
    },
    get(id) { return this.all()[id] || null; },
  };

  // ---------- remote backend ----------
  async function remote(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      // text/plain keeps this a "simple" request so Apps Script doesn't need CORS preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Server error (${res.status}). Please try again.`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  // ---------- demo backend (localStorage) ----------
  const DEMO_KEY = 'cc_demo_rides';
  const DEMO_PW_SHA256 = '6904a419dd44d2a41326b38721bd1853494310db095f2196ea7b64692b356b9e';
  const demoRead = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } };
  const demoWrite = (rides) => localStorage.setItem(DEMO_KEY, JSON.stringify(rides));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function demoValidate(r) {
    if (!r.email && !r.phone) throw new Error('Please add an email or phone number.');
    if (!r.firstName) throw new Error('Please enter your first name.');
    r.matchBefore = offsetOr(r.matchBefore, defaultWindow(r).before);
    r.matchAfter = offsetOr(r.matchAfter, defaultWindow(r).after);
    return r;
  }
  async function demo(payload) {
    await new Promise((r) => setTimeout(r, 250));
    const rides = demoRead();
    const strip = ({ editKey, ...pub }) => pub;
    const admin = async () => {
      if ((await sha256(payload.password || '')) !== DEMO_PW_SHA256) throw new Error('Incorrect password.');
    };
    switch (payload.action) {
      case 'list':
        return { rides: rides.filter((r) => minutesOf(r) >= nowMinutes() - 60).map(strip) };
      case 'add': {
        const now = new Date().toISOString();
        const ride = Object.assign(demoValidate({ ...payload.ride }), {
          id: uuid(), type: 'rider', editKey: uuid(), createdAt: now, updatedAt: now,
        });
        rides.push(ride);
        demoWrite(rides);
        return { ride: strip(ride), editKey: ride.editKey };
      }
      case 'update': {
        const r = rides.find((x) => x.id === payload.id);
        if (!r || r.editKey !== payload.editKey) throw new Error('Ride not found or you do not have permission to edit it.');
        Object.assign(r, demoValidate({ ...payload.ride }), { updatedAt: new Date().toISOString() });
        demoWrite(rides);
        return { ride: strip(r) };
      }
      case 'remove': {
        const r = rides.find((x) => x.id === payload.id);
        if (!r || r.editKey !== payload.editKey) throw new Error('Ride not found.');
        demoWrite(rides.filter((x) => x.id !== payload.id));
        return { removed: true };
      }
      case 'adminLogin':
        await admin();
        return {};
      case 'adminList':
        await admin();
        return { rides: rides.map(strip) };
      case 'adminAddShuttle': {
        await admin();
        const s = payload.shuttle;
        if (!/^https:\/\/\S{3,}$/.test(s.orderUrl || '')) throw new Error('Please enter the order form link (https://…).');
        const shuttle = {
          ...s, id: uuid(), type: 'shuttle', firstName: '$5 Shuttle', airline: '', email: '', phone: '',
          editKey: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        rides.push(shuttle);
        demoWrite(rides);
        return { ride: strip(shuttle) };
      }
      case 'adminDelete':
        await admin();
        demoWrite(rides.filter((x) => x.id !== payload.id));
        return { removed: true };
      default:
        throw new Error('Unknown action.');
    }
  }

  const call = (payload) => (DEMO ? demo(payload) : remote(payload));

  window.CC = {
    AIRPORTS, LOCATIONS, AIRLINES, MATCH_OFFSETS, DEFAULT_MATCH_WINDOW, CONTACT_EMAIL, DEMO,
    esc, pad, minutesOf, fmtTime, fmtMinutes, isoToMDY, mdyToIso, fmtDateLong, nowMinutes, todayIso,
    isMatch, isMutualMatch, overlapOf, fmtOverlap, windowOf, placeOf, myRides, call,
  };
})();
