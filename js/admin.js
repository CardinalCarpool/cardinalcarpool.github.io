// Admin dashboard. The password is checked by the backend on every request;
// it is kept in sessionStorage only for this tab so you don't retype it.
(function () {
  const { DEMO, esc, minutesOf, fmtTime, isoToMDY, mdyToIso, nowMinutes, todayIso, placeOf, isMatch, call } = window.CC;
  const { toast, initDateField, fillLocations } = window.UI;
  const $ = (sel) => document.querySelector(sel);
  const PW_KEY = 'cc_admin_pw';

  let password = '';
  let rides = [];

  if (DEMO) $('#demoNote').hidden = false;
  document.querySelectorAll('[data-date-field]').forEach(initDateField);
  fillLocations($('#sLocation'));

  const admin = (action, extra) => call(Object.assign({ action, password }, extra));

  // ---------- login ----------
  async function login(pw) {
    password = pw;
    await admin('adminLogin');
    try { sessionStorage.setItem(PW_KEY, pw); } catch (e) { /* storage unavailable */ }
    $('#loginCard').hidden = true;
    $('#dash').hidden = false;
    $('#logout').hidden = false;
    await refresh();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      await login($('#password').value);
    } catch (ex) {
      $('#loginError').textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logout').addEventListener('click', () => {
    try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* storage unavailable */ }
    location.reload();
  });

  // ---------- shuttle ----------
  const sForm = $('#shuttleForm');
  sForm.location.addEventListener('change', () => { $('#sOtherField').hidden = sForm.location.value !== 'Other'; });

  sForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#shuttleError');
    const date = mdyToIso(sForm.date.value.trim());
    const shuttle = {
      direction: sForm.direction.value,
      airport: sForm.airport.value,
      date,
      time: sForm.time.value,
      location: sForm.location.value,
      locationOther: sForm.location.value === 'Other' ? sForm.locationOther.value.trim() : '',
      orderUrl: sForm.orderUrl.value.trim(),
      notes: sForm.notes.value.trim(),
    };
    err.textContent =
      !date ? 'Enter the date as MM/DD/YYYY.' :
      date < todayIso() ? 'That date is in the past.' :
      !shuttle.time ? 'Enter a time.' :
      !shuttle.location ? 'Choose a location.' :
      shuttle.location === 'Other' && !shuttle.locationOther ? 'Say where for "Other".' :
      !/^https:\/\/\S{3,}$/.test(shuttle.orderUrl) ? 'Enter the order form link (starting with https://).' : '';
    if (err.textContent) return;

    const btn = $('#shuttleBtn');
    btn.disabled = true;
    try {
      const res = await admin('adminAddShuttle', { shuttle });
      toast('Shuttle added.');
      sForm.reset();
      $('#sOtherField').hidden = true;
      await refresh();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- table ----------
  async function refresh() {
    const res = await admin('adminList');
    rides = res.rides || [];
    render();
  }

  function render() {
    const cutoff = nowMinutes() - 60;
    const upcoming = rides.filter((r) => minutesOf(r) >= cutoff);
    $('#statRides').textContent = upcoming.filter((r) => r.type === 'rider').length;
    $('#statShuttles').textContent = upcoming.filter((r) => r.type === 'shuttle').length;

    const list = ($('#showPast').checked ? rides : upcoming).slice().sort((a, b) => minutesOf(a) - minutesOf(b));
    if (!list.length) {
      $('#rideRows').innerHTML = '<tr><td colspan="6" class="empty">No rides yet.</td></tr>';
      return;
    }
    $('#rideRows').innerHTML = list.map((r) => {
      const past = minutesOf(r) < cutoff;
      const trip = r.direction === 'to' ? `Stanford → ${r.airport}` : `${r.airport} → Stanford`;
      const who = r.type === 'shuttle'
        ? '<span class="badge badge-shuttle">$5 Shuttle</span>'
        : `${esc(r.firstName)}<div class="count">${esc(r.airline)}</div>`;
      const contact = r.type === 'shuttle'
        ? (r.orderUrl ? `<a href="${esc(r.orderUrl)}" target="_blank" rel="noopener">Order form</a>` : '') +
          (r.notes ? `<div class="count">${esc(r.notes)}</div>` : '')
        : [r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '', esc(r.phone || '')].filter(Boolean).join('<br>');
      return `<tr class="${past ? 'past' : ''}">
        <td><strong>${esc(isoToMDY(r.date))}</strong><div class="count">${esc(fmtTime(r.time))}</div></td>
        <td>${esc(trip)}</td>
        <td>${who}</td>
        <td>${esc(placeOf(r))}</td>
        <td style="overflow-wrap:anywhere">${contact}</td>
        <td><button class="btn btn-danger btn-sm" data-del="${esc(r.id)}">Delete</button></td>
      </tr>`;
    }).join('');
  }
  $('#showPast').addEventListener('change', render);

  // ---------- CSV exports (built here from the loaded rides) ----------
  const EXPORT_WINDOW = { before: 30, after: 30 };

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // Keep spreadsheets from treating text as a formula (phone numbers like +1 650… are fine).
    if (/^[=+\-@]/.test(s) && !/^\+?[\d\s().-]+$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadCsv(name, header, rows) {
    const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${todayIso()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const upcomingRides = () => rides.filter((r) => minutesOf(r) >= nowMinutes() - 60);
  const tripLabel = (r) => (r.direction === 'to' ? 'Leaving Stanford' : 'Returning to Stanford');
  const offsetText = (diff) => (diff === 0 ? 'at the same time'
    : `${Math.abs(diff)} minute${Math.abs(diff) === 1 ? '' : 's'} ${diff < 0 ? 'before' : 'after'}`);

  $('#exportEmails').addEventListener('click', () => {
    const byEmail = new Map();
    upcomingRides()
      .filter((r) => r.type === 'rider' && r.email)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      .forEach((r) => {
        const key = r.email.toLowerCase();
        const row = byEmail.get(key) || { firstName: r.firstName, email: r.email, trips: 0 };
        row.firstName = r.firstName; // most recent name wins
        row.trips++;
        byEmail.set(key, row);
      });
    const rows = [...byEmail.values()].map((r) => [r.firstName, r.email, r.trips]);
    if (!rows.length) { $('#exportResult').textContent = 'No emails to export yet.'; return; }
    downloadCsv('cardinal-carpool-emails', ['First Name', 'Email', 'Trips'], rows);
    $('#exportResult').textContent = `Exported ${rows.length} email${rows.length === 1 ? '' : 's'}.`;
  });

  $('#exportMatches').addEventListener('click', () => {
    const list = upcomingRides();
    const rows = [];
    list
      .filter((r) => r.type === 'rider' && r.email)
      .sort((a, b) => minutesOf(a) - minutesOf(b))
      .forEach((me) => {
        const matches = list
          .filter((o) => isMatch(me, o, EXPORT_WINDOW) && (o.type === 'shuttle' || o.email !== me.email))
          .sort((a, b) => minutesOf(a) - minutesOf(b));
        if (!matches.length) return;
        const first = matches[0]; // soonest (earliest) match
        const diff = minutesOf(first) - minutesOf(me);
        rows.push([
          me.firstName, me.email, tripLabel(me), me.airport, isoToMDY(me.date), fmtTime(me.time), placeOf(me),
          matches.length,
          offsetText(diff),
          first.type === 'shuttle' ? '$5 Shuttle' : first.firstName,
          fmtTime(first.time),
          first.type === 'shuttle' ? (first.orderUrl || '') : [first.email, first.phone].filter(Boolean).join(' / '),
          matches.map((m) => `${m.type === 'shuttle' ? '$5 Shuttle' : m.firstName} (${fmtTime(m.time)}, ${offsetText(minutesOf(m) - minutesOf(me))})`).join('; '),
        ]);
      });
    if (!rows.length) { $('#exportResult').textContent = 'No riders with a match within ±30 minutes yet.'; return; }
    downloadCsv('cardinal-carpool-matches', [
      'First Name', 'Email', 'Trip', 'Airport', 'Date', 'Time', 'Pickup/Drop-off',
      'Match Count', 'Soonest Match Offset', 'Soonest Match Name', 'Soonest Match Time', 'Soonest Match Contact', 'All Matches',
    ], rows);
    $('#exportResult').textContent = `Exported ${rows.length} trip${rows.length === 1 ? '' : 's'} with a match.`;
  });

  $('#rideRows').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const r = rides.find((x) => x.id === del.dataset.del);
    if (!confirm(`Delete ${r && r.type === 'shuttle' ? 'this shuttle' : `${r ? r.firstName + "'s" : 'this'} ride`}?`)) return;
    del.disabled = true;
    try {
      await admin('adminDelete', { id: del.dataset.del });
      toast('Deleted.');
      await refresh();
    } catch (ex) {
      toast(ex.message, true);
      del.disabled = false;
    }
  });

  // ---------- resume session ----------
  let saved = '';
  try { saved = sessionStorage.getItem(PW_KEY) || ''; } catch (e) { /* storage unavailable */ }
  if (saved) login(saved).catch(() => { try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ } });
})();
