// Admin dashboard. The password is checked by the backend on every request;
// it is kept in sessionStorage only for this tab so you don't retype it.
(function () {
  const { DEMO, esc, minutesOf, fmtTime, isoToMDY, mdyToIso, nowMinutes, todayIso, placeOf, call } = window.CC;
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
    const res = await admin('adminLogin');
    try { sessionStorage.setItem(PW_KEY, pw); } catch (e) { /* storage unavailable */ }
    $('#loginCard').hidden = true;
    $('#dash').hidden = false;
    $('#logout').hidden = false;
    applySettings(res.settings, res.quota, res.nextRun);
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

  // ---------- settings ----------
  function applySettings(settings, quota, nextRun) {
    if (settings && nextRun !== undefined) {
      $('#nextRun').textContent = !settings.autoNotify ? 'Paused: no emails will be sent.'
        : nextRun ? `On. Next send: ${nextRun}.` : 'On. Sent on the hour, every hour.';
    }
    if (settings) {
      $('#autoNotify').checked = !!settings.autoNotify;
      $('#siteUrl').value = settings.siteUrl || '';
    }
    if (quota != null) $('#statQuota').textContent = quota;
  }

  $('#autoNotify').addEventListener('change', async (e) => {
    try {
      const res = await admin('adminSettings', { settings: { autoNotify: e.target.checked } });
      applySettings(res.settings, null, res.nextRun || '');
      toast(`Hourly emails ${res.settings.autoNotify ? 'on' : 'paused'}.`);
    } catch (ex) {
      e.target.checked = !e.target.checked;
      toast(ex.message, true);
    }
  });

  $('#saveSiteUrl').addEventListener('click', async () => {
    try {
      const res = await admin('adminSettings', { settings: { siteUrl: $('#siteUrl').value } });
      applySettings(res.settings);
      toast('Website link saved.');
    } catch (ex) {
      toast(ex.message, true);
    }
  });

  $('#sendMatches').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const res = await admin('adminSendMatches');
      $('#sendResult').textContent = res.recipients
        ? `Emailed ${res.recipients} rider${res.recipients === 1 ? '' : 's'} (BCC).`
        : `No new matches to email. ${res.subscribers} rider${res.subscribers === 1 ? ' has' : 's have'} Notify me on.`;
      if (res.ridersWithMatches > res.recipients) {
        $('#sendResult').textContent += ` ${res.ridersWithMatches - res.recipients} waiting: daily email limit reached.`;
      }
      if (res.quotaLeft != null) $('#statQuota').textContent = res.quotaLeft;
      await refresh();
    } catch (ex) {
      toast(ex.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send match emails now';
    }
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
      toast('Shuttle added. Riders nearby with Notify me on will hear about it at the top of the hour.');
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
    applySettings(res.settings, res.quota, res.nextRun);
    render();
  }

  function render() {
    const cutoff = nowMinutes() - 60;
    const upcoming = rides.filter((r) => minutesOf(r) >= cutoff);
    $('#statRides').textContent = upcoming.filter((r) => r.type === 'rider').length;
    $('#statShuttles').textContent = upcoming.filter((r) => r.type === 'shuttle').length;

    const list = ($('#showPast').checked ? rides : upcoming).slice().sort((a, b) => minutesOf(a) - minutesOf(b));
    if (!list.length) {
      $('#rideRows').innerHTML = '<tr><td colspan="7" class="empty">No rides yet.</td></tr>';
      return;
    }
    $('#rideRows').innerHTML = list.map((r) => {
      const past = minutesOf(r) < cutoff;
      const trip = r.direction === 'to' ? `Stanford → ${r.airport}` : `${r.airport} → Stanford`;
      const who = r.type === 'shuttle'
        ? '<span class="badge badge-shuttle">$5 Shuttle</span>'
        : `${esc(r.firstName)}${r.notify ? ` <span title="Notify me: ${r.notifyBefore} min before to ${r.notifyAfter} min after">🔔</span>` : ''}<div class="count">${esc(r.airline)}</div>`;
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
        <td>${r.type === 'rider' ? r.notifiedCount || 0 : ''}</td>
        <td><button class="btn btn-danger btn-sm" data-del="${esc(r.id)}">Delete</button></td>
      </tr>`;
    }).join('');
  }
  $('#showPast').addEventListener('change', render);

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
