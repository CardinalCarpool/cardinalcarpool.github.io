// Shared constants, helpers and the backend client for Cardinal Carpool.
(function () {
  const AIRPORTS = ['SFO', 'SJC', 'OAK'];
  const LOCATIONS = [
    'Branner', 'EV', 'FloMo', 'GovCo', 'Lagunita', 'Lower Row', 'Stern', 'Toyon', 'Upper Row', 'Wilbur',
  ]; // "Other" is appended in the UI
  const AIRLINES = [
    'Alaska', 'American', 'Delta', 'Frontier', 'Hawaiian', 'JetBlue', 'Southwest', 'Spirit', 'United',
    'Air Canada', 'Air France', 'British Airways', 'Emirates', 'Japan Airlines', 'Lufthansa', 'Qantas',
  ];
  const MATCH_WINDOW_MIN = 30;
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
  const isMatch = (a, b) => a.id !== b.id && a.direction === b.direction && a.airport === b.airport &&
    Math.abs(minutesOf(a) - minutesOf(b)) <= MATCH_WINDOW_MIN;
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
  const DEMO_SETTINGS = 'cc_demo_settings';
  const DEMO_PW_SHA256 = '6904a419dd44d2a41326b38721bd1853494310db095f2196ea7b64692b356b9e';
  const demoRead = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; } };
  const demoWrite = (rides) => localStorage.setItem(DEMO_KEY, JSON.stringify(rides));
  const demoSettings = () => {
    try { return Object.assign({ autoNotify: true, siteUrl: '' }, JSON.parse(localStorage.getItem(DEMO_SETTINGS) || '{}')); }
    catch (e) { return { autoNotify: true, siteUrl: '' }; }
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function demoValidate(r) {
    if (!r.email && !r.phone) throw new Error('Please add an email or phone number.');
    if (!r.firstName) throw new Error('Please enter your first name.');
    return r;
  }
  function demoSendMatches(focusId) {
    const rides = demoRead();
    let candidates = rides.filter((r) => r.type === 'rider' && r.email);
    if (focusId) {
      const focus = rides.find((r) => r.id === focusId);
      candidates = candidates.filter((r) => r.id === focusId || isMatch(r, focus));
    }
    let emailsSent = 0;
    let ridersWithMatches = 0;
    candidates.forEach((rider) => {
      const already = rider.notified || [];
      const fresh = rides.filter((o) => isMatch(rider, o) && !already.includes(o.id));
      if (!fresh.length) return;
      ridersWithMatches++;
      emailsSent++;
      rider.notified = already.concat(fresh.map((o) => o.id));
      console.info(`[demo] Would email ${rider.email} about:`, fresh.map((f) => `${f.firstName} ${f.time}`));
    });
    demoWrite(rides);
    return { emailsSent, ridersWithMatches, quotaLeft: 100 };
  }
  async function demo(payload) {
    await new Promise((r) => setTimeout(r, 250));
    const rides = demoRead();
    const strip = ({ editKey, notified, ...pub }) => pub;
    const admin = async () => {
      if ((await sha256(payload.password || '')) !== DEMO_PW_SHA256) throw new Error('Incorrect password.');
    };
    switch (payload.action) {
      case 'list':
        return { rides: rides.filter((r) => minutesOf(r) >= nowMinutes() - 60).map(strip) };
      case 'add': {
        const ride = Object.assign(demoValidate({ ...payload.ride }), {
          id: uuid(), type: 'rider', editKey: uuid(), notified: [], createdAt: new Date().toISOString(),
        });
        rides.push(ride);
        demoWrite(rides);
        const emailed = demoSettings().autoNotify ? demoSendMatches(ride.id).emailsSent : 0;
        return { ride: strip(ride), editKey: ride.editKey, emailed };
      }
      case 'update': {
        const r = rides.find((x) => x.id === payload.id);
        if (!r || r.editKey !== payload.editKey) throw new Error('Ride not found or you do not have permission to edit it.');
        const changed = ['direction', 'date', 'time', 'airport'].some((k) => payload.ride[k] !== r[k]);
        Object.assign(r, demoValidate({ ...payload.ride }));
        if (changed) r.notified = [];
        demoWrite(rides);
        const emailed = changed && demoSettings().autoNotify ? demoSendMatches(r.id).emailsSent : 0;
        return { ride: strip(r), emailed };
      }
      case 'remove': {
        const r = rides.find((x) => x.id === payload.id);
        if (!r || r.editKey !== payload.editKey) throw new Error('Ride not found.');
        demoWrite(rides.filter((x) => x.id !== payload.id));
        return { removed: true };
      }
      case 'adminLogin':
        await admin();
        return { settings: demoSettings(), quota: 100 };
      case 'adminList':
        await admin();
        return {
          rides: rides.map((r) => ({ ...strip(r), notifiedCount: (r.notified || []).length })),
          settings: demoSettings(), quota: 100,
        };
      case 'adminAddShuttle': {
        await admin();
        const s = payload.shuttle;
        if (!/^https:\/\/\S{3,}$/.test(s.orderUrl || '')) throw new Error('Please enter the order form link (https://…).');
        const shuttle = {
          ...s, id: uuid(), type: 'shuttle', firstName: '$5 Shuttle', airline: '', email: '', phone: '',
          editKey: '', notified: [], createdAt: new Date().toISOString(),
        };
        rides.push(shuttle);
        demoWrite(rides);
        const emailed = demoSettings().autoNotify ? demoSendMatches(shuttle.id).emailsSent : 0;
        return { ride: strip(shuttle), emailed };
      }
      case 'adminDelete':
        await admin();
        demoWrite(rides.filter((x) => x.id !== payload.id));
        return { removed: true };
      case 'adminSendMatches':
        await admin();
        return demoSendMatches(null);
      case 'adminSettings': {
        await admin();
        const next = Object.assign(demoSettings(), payload.settings || {});
        localStorage.setItem(DEMO_SETTINGS, JSON.stringify(next));
        return { settings: next };
      }
      default:
        throw new Error('Unknown action.');
    }
  }

  const call = (payload) => (DEMO ? demo(payload) : remote(payload));

  window.CC = {
    AIRPORTS, LOCATIONS, AIRLINES, MATCH_WINDOW_MIN, CONTACT_EMAIL, DEMO,
    esc, pad, minutesOf, fmtTime, fmtMinutes, isoToMDY, mdyToIso, fmtDateLong, nowMinutes, todayIso,
    isMatch, placeOf, myRides, call,
  };
})();
